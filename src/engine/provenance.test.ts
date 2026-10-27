import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  Source,
  Package,
  Artifact,
  ManagedInstallation,
  AssistantId,
  Scope,
} from '../domain/types';
import {
  readManifest,
  writeManifest,
  readState,
  writeState,
  toDesiredSource,
  fromDesiredSource,
  SCHEMA_VERSION,
} from '../domain/registry';
import { getAdapterWithHomeRoot } from '../adapters/registry';
import { getSourceResolver } from '../sources/registry';
import { planInstall } from './plan';
import * as planModule from './plan';
import { applyInstall } from './apply';
import { checkForUpstreamUpdate, checkDriftForAll, resolveInstallationSource } from './drift';
import { computePendingCounts } from './pendingCounts';
import { planUpdate } from './update';
import { runUpdates } from '../cli/commands';

// File-wide HOME sandbox so no code path reads or writes the real ~/.ai-swissknife
const realHome = process.env.HOME;
const realUserProfile = process.env.USERPROFILE;
let sandboxHome: string;

before(async () => {
  sandboxHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-swissknife-prov-sandbox-'));
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
});

after(async () => {
  for (const [key, value] of [
    ['HOME', realHome],
    ['USERPROFILE', realUserProfile],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (sandboxHome && fs.existsSync(sandboxHome)) {
    await fs.promises.rm(sandboxHome, { recursive: true, force: true });
  }
});

function runGitSync(args: string[], cwd: string): string {
  return child_process
    .execFileSync('git', args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
      },
    })
    .toString();
}

function initGitRepo(repoDir: string): void {
  fs.mkdirSync(repoDir, { recursive: true });
  runGitSync(['init', '-b', 'main'], repoDir);
  runGitSync(['config', 'user.name', 'Provenance Test'], repoDir);
  runGitSync(['config', 'user.email', 'provenance@test.local'], repoDir);
}

function commitAll(repoDir: string, message: string): string {
  runGitSync(['add', '.'], repoDir);
  runGitSync(['commit', '-m', message], repoDir);
  return runGitSync(['rev-parse', 'HEAD'], repoDir).trim();
}

function writeSkillFile(
  baseDir: string,
  relSkillDir: string,
  name: string,
  description: string,
  body: string
): string {
  const skillDir = path.join(baseDir, relSkillDir);
  fs.mkdirSync(skillDir, { recursive: true });
  const filePath = path.join(skillDir, 'SKILL.md');
  fs.writeFileSync(
    filePath,
    `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`,
    'utf-8'
  );
  return filePath;
}

describe('provenance & update detection — spec §6 acceptance cases', () => {
  let testWorkspaceDir: string;
  let testHomeDir: string;

  beforeEach(async () => {
    testWorkspaceDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'prov-test-ws-'));
    testHomeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'prov-test-home-'));
    process.env.HOME = testHomeDir;
    process.env.USERPROFILE = testHomeDir;
  });

  afterEach(async () => {
    process.env.HOME = sandboxHome;
    process.env.USERPROFILE = sandboxHome;
    if (testWorkspaceDir && fs.existsSync(testWorkspaceDir)) {
      await fs.promises.rm(testWorkspaceDir, { recursive: true, force: true });
    }
    if (testHomeDir && fs.existsSync(testHomeDir)) {
      await fs.promises.rm(testHomeDir, { recursive: true, force: true });
    }
  });

  async function resolveAndInstallSkill(params: {
    source: Source;
    skillName: string;
    artifactId?: string;
    assistant?: AssistantId;
    targetScope?: Scope;
  }): Promise<{ installation: ManagedInstallation; pkg: Package; artifact: Artifact }> {
    const {
      source,
      skillName,
      artifactId,
      assistant = 'claude-code',
      targetScope = 'project',
    } = params;

    const cacheDir = path.join(testHomeDir, '.ai-swissknife', 'cache', 'sources');
    const resolver = getSourceResolver(source.type);
    const resolution = await resolver.resolve(source, { homeRoot: testHomeDir, cacheDir });

    let foundPkg: Package | undefined;
    let foundArt: Artifact | undefined;
    for (const p of resolution.packages) {
      for (const a of p.artifacts) {
        if (artifactId ? a.id === artifactId : a.kind === 'skill' && a.name === skillName) {
          foundPkg = p;
          foundArt = a;
          break;
        }
      }
      if (foundArt) break;
    }
    assert.ok(foundPkg && foundArt, `Skill "${skillName}" must exist in resolved source "${source.id}"`);

    const adapter = getAdapterWithHomeRoot(assistant, testHomeDir);
    const prepared = await planInstall({
      source,
      pkg: foundPkg,
      artifact: foundArt,
      targetAdapter: adapter,
      targetScope,
      projectRoot: testWorkspaceDir,
      homeRoot: testHomeDir,
      resolverOpts: { cacheDir },
    });
    assert.strictEqual(prepared.supported, true, `planInstall must succeed: ${!prepared.supported ? prepared.plan.reason : ''}`);

    const outcome = await applyInstall(prepared, testHomeDir);
    assert.strictEqual(outcome.status, 'applied', 'applyInstall must succeed');
    if (outcome.status !== 'applied') {
      throw new Error('Install failed');
    }

    return { installation: outcome.installation, pkg: foundPkg, artifact: foundArt };
  }

  // Case 1: Install from a git source, check immediately: up-to-date (UI path and CLI path).
  // Observed wrong result on main:
  // (a) When a global source shares the same `sourceId` (even when not used for the install), UI paths
  //     (`DashboardPanel`, `computePendingCounts`, `checkDriftForAll` with merged `[global, project]` sources)
  //     and single-workspace CLI `runUpdates` pick the global source by first-id match and report `update-available`;
  // (b) When the remote advances between catalog load and install (spec §0.3 & §3.4), `planInstall` checks out
  //     the stale catalog commit (`pkg.version.commit`) instead of resolving at install time, so an immediate
  //     check right after install fetches the new commit and reports `update-available` instead of `up-to-date`.
  it('1a. install from a git source and check immediately -> up-to-date on both UI and CLI paths (source identity lookup)', async () => {
    const remoteRepoDir = path.join(testWorkspaceDir, 'remotes', 'git-origin-1a');
    initGitRepo(remoteRepoDir);
    writeSkillFile(remoteRepoDir, 'skills/alpha-skill', 'alpha-skill', 'Alpha v1', '# Alpha v1');
    const commit1 = commitAll(remoteRepoDir, 'Initial commit');

    // Also register a global local-folder source with the same id ('team-git') that has different content
    const globalCollisionFolder = path.join(testHomeDir, 'works', 'team-git');
    writeSkillFile(
      globalCollisionFolder,
      'skills/alpha-skill',
      'alpha-skill',
      'Alpha global ahead',
      '# Alpha global working copy'
    );
    const globalCollisionSource: Source = {
      id: 'team-git',
      type: 'local-folder',
      scope: 'global',
      localPath: globalCollisionFolder,
    };
    await writeManifest(
      'global',
      {
        schemaVersion: SCHEMA_VERSION,
        sources: [toDesiredSource(globalCollisionSource, undefined, testHomeDir)],
        desiredInstallations: [],
      },
      undefined,
      testHomeDir
    );

    const gitSource: Source = {
      id: 'team-git',
      type: 'git-custom',
      scope: 'project',
      projectPath: testWorkspaceDir,
      url: remoteRepoDir,
    };

    await writeManifest(
      'project',
      {
        schemaVersion: SCHEMA_VERSION,
        sources: [toDesiredSource(gitSource, testWorkspaceDir, testHomeDir)],
        desiredInstallations: [],
      },
      testWorkspaceDir,
      testHomeDir
    );

    const { installation } = await resolveAndInstallSkill({
      source: gitSource,
      skillName: 'alpha-skill',
      targetScope: 'project',
    });

    assert.deepStrictEqual(installation.source, {
      id: 'team-git',
      scope: 'workspace',
      type: 'git-custom',
      location: remoteRepoDir,
    });
    assert.strictEqual(installation.sourceId, 'team-git');
    assert.strictEqual(installation.sourceRevision?.commit, commit1);

    // UI path: checkDriftForAll & computePendingCounts
    const gManifest = await readManifest('global', undefined, testHomeDir);
    const pManifest = await readManifest('project', testWorkspaceDir, testHomeDir);
    const globalSources = gManifest.sources.map((d) => fromDesiredSource(d, undefined, testHomeDir));
    const workspaceSources = pManifest.sources.map((d) => fromDesiredSource(d, testWorkspaceDir, testHomeDir));

    const uiReports = await checkDriftForAll(
      [installation],
      { globalSources, workspaceSources },
      testHomeDir
    );
    assert.strictEqual(uiReports.length, 1);
    assert.strictEqual(
      uiReports[0].status,
      'up-to-date',
      'Immediate check after install must be up-to-date on UI path'
    );

    const pending = await computePendingCounts(testWorkspaceDir, testHomeDir);
    assert.strictEqual(pending.updatesAvailable, 0);

    // CLI path: runUpdates (single workspace and --roots multi-workspace)
    const cliUpdatesSingle = await runUpdates({
      home: testHomeDir,
      workspace: testWorkspaceDir,
    });
    assert.strictEqual(cliUpdatesSingle.length, 1);
    assert.strictEqual(cliUpdatesSingle[0].status, 'up-to-date');

    const cliUpdatesRoots = await runUpdates({
      home: testHomeDir,
      roots: [testWorkspaceDir],
    });
    assert.strictEqual(cliUpdatesRoots.length, 1);
    assert.strictEqual(cliUpdatesRoots[0].status, 'up-to-date');
  });

  it(
    '1b. install from a git source when remote advances between catalog load and install -> resolves at install time and is up-to-date',
    async () => {
      const remoteRepoDir = path.join(testWorkspaceDir, 'remotes', 'git-origin-1');
      initGitRepo(remoteRepoDir);
      writeSkillFile(remoteRepoDir, 'skills/alpha-skill', 'alpha-skill', 'Alpha v1', '# Alpha v1');
      commitAll(remoteRepoDir, 'Initial commit');

      const gitSource: Source = {
        id: 'team-git',
        type: 'git-custom',
        scope: 'project',
        projectPath: testWorkspaceDir,
        url: remoteRepoDir,
      };

      await writeManifest(
        'project',
        {
          schemaVersion: SCHEMA_VERSION,
          sources: [toDesiredSource(gitSource, testWorkspaceDir, testHomeDir)],
          desiredInstallations: [],
        },
        testWorkspaceDir,
        testHomeDir
      );

      // Step 1: Catalog load resolves the source at commit 1
      const cacheDir = path.join(testHomeDir, '.ai-swissknife', 'cache', 'sources');
      const resolver = getSourceResolver(gitSource.type);
      const catalogResolution = await resolver.resolve(gitSource, { homeRoot: testHomeDir, cacheDir });
      const catalogPkg = catalogResolution.packages[0];
      const catalogArt = catalogPkg.artifacts[0];

      // Remote moves before the user clicks Install (spec §0.3 & §3.4: install must resolve at install time)
      writeSkillFile(remoteRepoDir, 'skills/alpha-skill', 'alpha-skill', 'Alpha v2', '# Alpha v2 at install time');
      const installTimeCommit = commitAll(remoteRepoDir, 'Commit 2 before install');

      const adapter = getAdapterWithHomeRoot('claude-code', testHomeDir);
      const prepared = await planInstall({
        source: gitSource,
        pkg: catalogPkg,
        artifact: catalogArt,
        targetAdapter: adapter,
        targetScope: 'project',
        projectRoot: testWorkspaceDir,
        homeRoot: testHomeDir,
        resolverOpts: { cacheDir },
      });
      assert.strictEqual(prepared.supported, true);
      const outcome = await applyInstall(prepared, testHomeDir);
      assert.strictEqual(outcome.status, 'applied');
      if (outcome.status !== 'applied') throw new Error('Install failed');
      const installation = outcome.installation;

      // UI path: checkDriftForAll & computePendingCounts
      const gManifest = await readManifest('global', undefined, testHomeDir);
      const pManifest = await readManifest('project', testWorkspaceDir, testHomeDir);
      const mergedSources = [
        ...gManifest.sources.map((d) => fromDesiredSource(d, undefined, testHomeDir)),
        ...pManifest.sources.map((d) => fromDesiredSource(d, testWorkspaceDir, testHomeDir)),
      ];

      const uiReports = await checkDriftForAll([installation], mergedSources, testHomeDir);
      assert.strictEqual(uiReports.length, 1);
      assert.strictEqual(
        uiReports[0].status,
        'up-to-date',
        'Immediate check after install must be up-to-date on UI path'
      );
      assert.strictEqual(installation.sourceRevision?.commit, installTimeCommit);
      assert.ok(installation.sourceContentHash, 'Installation must record sourceContentHash');
      assert.strictEqual(installation.sourceContentHash, installation.contentHash);
      assert.strictEqual(uiReports[0].installedCommit, installTimeCommit);
      assert.strictEqual(uiReports[0].currentCommit, installTimeCommit);
      assert.strictEqual(uiReports[0].commitsBehind, 0);

      const pending = await computePendingCounts(testWorkspaceDir, testHomeDir);
      assert.strictEqual(pending.updatesAvailable, 0);

      // CLI path: runUpdates (single workspace and --roots multi-workspace)
      const cliUpdatesSingle = await runUpdates({
        home: testHomeDir,
        workspace: testWorkspaceDir,
      });
      assert.strictEqual(cliUpdatesSingle.length, 1);
      assert.strictEqual(cliUpdatesSingle[0].status, 'up-to-date');

      const cliUpdatesRoots = await runUpdates({
        home: testHomeDir,
        roots: [testWorkspaceDir],
      });
      assert.strictEqual(cliUpdatesRoots.length, 1);
      assert.strictEqual(cliUpdatesRoots[0].status, 'up-to-date');
    }
  );

  // Case 2: Same id as local-folder (global) and git (workspace), install from the git one:
  // check uses the git one, up-to-date; editing the local folder does not change it.
  // Observed wrong result on main: update-available on the Dashboard / checkDriftForAll / computePendingCounts
  // and single-workspace CLI `runUpdates` paths because they merge [globalSources, projectSources] and pick
  // the first source matching `sourceId` (the global local-folder working copy, which is ahead), while
  // `runUpdates({ roots })` checks project installations against project sources and reports `up-to-date` (CLI/UI disagreement).
  it(
    '2. same source id in global (local-folder) and workspace (git), installed from workspace git -> check uses git source (up-to-date) and ignores global local-folder edits',
    async () => {
      const sharedId = 'ai-orchestration';

      // Global local-folder source under testHomeDir with ahead/modified working copy
      const globalLocalFolder = path.join(testHomeDir, 'works', sharedId);
      writeSkillFile(
        globalLocalFolder,
        'skills/shared-skill',
        'shared-skill',
        'Ahead in global working copy',
        '# Global local folder ahead version'
      );
      const globalSource: Source = {
        id: sharedId,
        type: 'local-folder',
        scope: 'global',
        localPath: globalLocalFolder,
      };
      await writeManifest(
        'global',
        {
          schemaVersion: SCHEMA_VERSION,
          sources: [toDesiredSource(globalSource, undefined, testHomeDir)],
          desiredInstallations: [],
        },
        undefined,
        testHomeDir
      );

      // Workspace git-marketplace source with the same id at v1
      const remoteRepoDir = path.join(testWorkspaceDir, 'remotes', sharedId);
      initGitRepo(remoteRepoDir);
      writeSkillFile(
        remoteRepoDir,
        'plugins/core/skills/shared-skill',
        'shared-skill',
        'Committed git v1',
        '# Git committed v1'
      );
      fs.mkdirSync(path.join(remoteRepoDir, '.claude-plugin'), { recursive: true });
      fs.writeFileSync(
        path.join(remoteRepoDir, '.claude-plugin', 'marketplace.json'),
        JSON.stringify({
          plugins: [{ name: 'core', source: 'plugins/core', version: '1.0.0' }],
        }),
        'utf-8'
      );
      commitAll(remoteRepoDir, 'Commit v1 in git marketplace');

      const workspaceGitSource: Source = {
        id: sharedId,
        type: 'git-marketplace',
        scope: 'project',
        projectPath: testWorkspaceDir,
        url: remoteRepoDir,
      };
      await writeManifest(
        'project',
        {
          schemaVersion: SCHEMA_VERSION,
          sources: [toDesiredSource(workspaceGitSource, testWorkspaceDir, testHomeDir)],
          desiredInstallations: [],
        },
        testWorkspaceDir,
        testHomeDir
      );

      // Install from the workspace git source
      const { installation } = await resolveAndInstallSkill({
        source: workspaceGitSource,
        skillName: 'shared-skill',
        targetScope: 'project',
      });

      assert.deepStrictEqual(installation.source, {
        id: sharedId,
        scope: 'workspace',
        type: 'git-marketplace',
        location: remoteRepoDir,
      });

      // Edit the global local-folder further
      writeSkillFile(
        globalLocalFolder,
        'skills/shared-skill',
        'shared-skill',
        'Edited again in global local folder',
        '# Edited local working copy'
      );

      // Dashboard / UI path (resolveInstallationSource & checkDriftForAll)
      const gManifest = await readManifest('global', undefined, testHomeDir);
      const pManifest = await readManifest('project', testWorkspaceDir, testHomeDir);
      const globalSources = gManifest.sources.map((d) => fromDesiredSource(d, undefined, testHomeDir));
      const workspaceSources = pManifest.sources.map((d) => fromDesiredSource(d, testWorkspaceDir, testHomeDir));
      const dashboardMergedSources: Source[] = [...globalSources, ...workspaceSources];

      const resolved = resolveInstallationSource(installation, { globalSources, workspaceSources });
      assert.ok('source' in resolved, 'resolveInstallationSource must find the workspace source');
      if ('source' in resolved) {
        assert.strictEqual(resolved.source.scope, 'project');
        assert.strictEqual(resolved.source.type, 'git-marketplace');
      }

      const driftReports = await checkDriftForAll([installation], dashboardMergedSources, testHomeDir);
      assert.strictEqual(driftReports.length, 1);
      assert.strictEqual(
        driftReports[0].status,
        'up-to-date',
        'Dashboard / checkDriftForAll must resolve against workspace git source, not global local-folder'
      );

      const pending = await computePendingCounts(testWorkspaceDir, testHomeDir);
      assert.strictEqual(
        pending.updatesAvailable,
        0,
        'computePendingCounts must report 0 updates available'
      );

      // CLI single-workspace path (src/cli/commands.ts:479-536)
      const cliSingle = await runUpdates({
        home: testHomeDir,
        workspace: testWorkspaceDir,
      });
      assert.strictEqual(cliSingle.length, 1);
      assert.strictEqual(cliSingle[0].status, 'up-to-date');

      // CLI multi-root path (src/cli/commands.ts:397-474)
      const cliRoots = await runUpdates({
        home: testHomeDir,
        roots: [testWorkspaceDir],
      });
      assert.strictEqual(cliRoots.length, 1);
      assert.strictEqual(cliRoots[0].status, 'up-to-date');
      assert.strictEqual(
        driftReports[0].status,
        cliSingle[0].status,
        'Dashboard and CLI single-workspace paths must give the same state'
      );
      assert.strictEqual(
        cliSingle[0].status,
        cliRoots[0].status,
        'CLI single-workspace and --roots paths must agree with Dashboard'
      );

      // Also verify that if workspace source is removed from workspace manifest while global source with same id remains,
      // resolveInstallationSource returns unavailable with a hint (never silently falling back to global source).
      const missingRes = resolveInstallationSource(installation, {
        globalSources,
        workspaceSources: [],
      });
      assert.ok('unavailable' in missingRes, 'Must be unavailable when workspace source is gone');
      if ('unavailable' in missingRes) {
        assert.ok(missingRes.hint && missingRes.hint.includes('global'), 'Must include hint about same-id source in global scope');
      }
    }
  );

  // Case 3: Local-folder git source with an uncommitted edit: default up-to-date (committed HEAD);
  // with readWorkingTree, update-available with dirty shown.
  // Observed wrong result on main: localFolder.ts reads the live working tree unconditionally and records
  // no sourceRevision commit or dirty flag, so an uncommitted edit in the source folder makes checkForUpstreamUpdate
  // return `update-available` instead of `up-to-date` (committed HEAD).
  it(
    '3. local-folder git source with an uncommitted edit -> default up-to-date (reads committed HEAD); with readWorkingTree: true -> update-available with dirty shown',
    async () => {
      const localGitFolder = path.join(testWorkspaceDir, 'local-git-source');
      initGitRepo(localGitFolder);
      writeSkillFile(
        localGitFolder,
        'skills/folder-skill',
        'folder-skill',
        'Committed description',
        '# Committed body at HEAD'
      );
      const headCommit = commitAll(localGitFolder, 'Initial commit in local folder repo');

      const sourceDefault: Source = {
        id: 'local-git',
        type: 'local-folder',
        scope: 'project',
        projectPath: testWorkspaceDir,
        localPath: localGitFolder,
      };

      const { installation } = await resolveAndInstallSkill({
        source: sourceDefault,
        skillName: 'folder-skill',
      });

      // Make an uncommitted edit in the local git folder's working tree
      writeSkillFile(
        localGitFolder,
        'skills/folder-skill',
        'folder-skill',
        'Uncommitted description edit',
        '# Dirty uncommitted body in working tree'
      );

      // Default behaviour: local-folder git source is read at committed HEAD -> up-to-date
      const defaultReport = await checkForUpstreamUpdate(installation, sourceDefault, testHomeDir);
      assert.strictEqual(
        defaultReport.status,
        'up-to-date',
        'Default local-folder git source check must compare against committed HEAD and report up-to-date'
      );
      assert.strictEqual(
        installation.sourceRevision?.commit,
        headCommit,
        'Installation from a git local-folder must record sourceRevision.commit'
      );

      // With readWorkingTree: true, uncommitted edit is read -> update-available with dirty flag
      const sourceWorkingTree = {
        ...sourceDefault,
        readWorkingTree: true,
      } as Source & { readWorkingTree: boolean };

      const dirtyReport = await checkForUpstreamUpdate(installation, sourceWorkingTree, testHomeDir);
      assert.strictEqual(
        dirtyReport.status,
        'update-available',
        'With readWorkingTree: true, uncommitted edit must be reported as update-available'
      );
      const hasDirtyIndication =
        Boolean((dirtyReport as unknown as { dirty?: boolean }).dirty) ||
        Boolean((dirtyReport.installation.sourceRevision as unknown as { dirty?: boolean })?.dirty) ||
        Boolean(dirtyReport.details && /dirty|uncommitted|working tree/i.test(dirtyReport.details));
      assert.strictEqual(hasDirtyIndication, true, 'Dirty working tree state must be recorded/shown');
    }
  );

  // Case 4: Commit in the source that does not touch the item: up-to-date, commits shown as different.
  // Observed wrong result on main: status is `up-to-date`, but `DriftReport` does not record or expose
  // the installed commit vs the source's new HEAD commit (and does not store `sourceContentHash`), so
  // the different commits are not shown on the report.
  it(
    '4. commit in git source that does not touch the installed skill -> up-to-date with installed and current commits shown as different',
    async () => {
      const remoteRepoDir = path.join(testWorkspaceDir, 'remotes', 'git-untouched');
      initGitRepo(remoteRepoDir);
      writeSkillFile(remoteRepoDir, 'skills/skill-kept', 'skill-kept', 'Kept v1', '# Kept body');
      writeSkillFile(remoteRepoDir, 'skills/skill-other', 'skill-other', 'Other v1', '# Other body v1');
      const commit1 = commitAll(remoteRepoDir, 'Commit 1: initial skills');

      const gitSource: Source = {
        id: 'src-untouched',
        type: 'git-custom',
        scope: 'project',
        projectPath: testWorkspaceDir,
        url: remoteRepoDir,
      };

      const { installation } = await resolveAndInstallSkill({
        source: gitSource,
        skillName: 'skill-kept',
      });
      assert.strictEqual(installation.sourceRevision?.commit, commit1);
      assert.ok(installation.sourceContentHash, 'Installation must record sourceContentHash');
      assert.strictEqual(installation.sourceContentHash, installation.contentHash);

      // Advance upstream repo with a commit that only touches skill-other
      writeSkillFile(remoteRepoDir, 'skills/skill-other', 'skill-other', 'Other v2', '# Other body v2');
      const commit2 = commitAll(remoteRepoDir, 'Commit 2: touch only skill-other');
      assert.notStrictEqual(commit1, commit2);

      const report = await checkForUpstreamUpdate(installation, gitSource, testHomeDir) as unknown as Record<string, unknown>;
      assert.strictEqual(report.status, 'up-to-date');

      // Spec §2 & §6.4: commits shown as different on the status report / evidence
      const reportedInstalledCommit =
        (report.installedCommit as string | undefined) ??
        ((report.installedRevision as { commit?: string } | undefined)?.commit) ??
        (typeof report.installedRevision === 'string' ? report.installedRevision : undefined);
      const reportedCurrentCommit =
        (report.currentCommit as string | undefined) ??
        (report.sourceCommit as string | undefined) ??
        ((report.sourceRevision as { commit?: string } | undefined)?.commit) ??
        (typeof report.currentRevision === 'string' ? report.currentRevision : undefined);

      assert.strictEqual(reportedInstalledCommit, commit1, 'Report must expose the installed commit');
      assert.strictEqual(reportedCurrentCommit, commit2, 'Report must expose the new upstream commit');
      assert.notStrictEqual(reportedInstalledCommit, reportedCurrentCommit);
      assert.strictEqual(report.commitsBehind, 1, 'Report must expose commitsBehind = 1');
    }
  );

  it(
    '4b. fast path when current source commit == sourceRevision.commit and not dirty -> no resolveAndTranslate call',
    async () => {
      const remoteRepoDir = path.join(testWorkspaceDir, 'remotes', 'git-fastpath');
      initGitRepo(remoteRepoDir);
      writeSkillFile(remoteRepoDir, 'skills/fast-skill', 'fast-skill', 'Fast v1', '# Fast body');
      const commit1 = commitAll(remoteRepoDir, 'Commit 1');

      const gitSource: Source = {
        id: 'src-fastpath',
        type: 'git-custom',
        scope: 'project',
        projectPath: testWorkspaceDir,
        url: remoteRepoDir,
      };

      const { installation } = await resolveAndInstallSkill({
        source: gitSource,
        skillName: 'fast-skill',
      });
      assert.strictEqual(installation.sourceRevision?.commit, commit1);

      let translateCalls = 0;
      const origResolveAndTranslate = planModule.resolveAndTranslate;
      (planModule as { resolveAndTranslate: typeof planModule.resolveAndTranslate }).resolveAndTranslate =
        async (...args) => {
          translateCalls++;
          return origResolveAndTranslate(...args);
        };

      try {
        const fastReport = await checkForUpstreamUpdate(installation, gitSource, testHomeDir);
        assert.strictEqual(fastReport.status, 'up-to-date');
        assert.strictEqual(fastReport.installedCommit, commit1);
        assert.strictEqual(fastReport.currentCommit, commit1);
        assert.strictEqual(fastReport.commitsBehind, 0);
        assert.strictEqual(
          translateCalls,
          0,
          'Fast path must not call resolveAndTranslate when commit is unchanged and not dirty'
        );
      } finally {
        (planModule as { resolveAndTranslate: typeof planModule.resolveAndTranslate }).resolveAndTranslate =
          origResolveAndTranslate;
      }
    }
  );

  // Case 5: Commit that changes the item: update-available; after Update: up-to-date, new commit recorded.
  it('5. commit that changes the item -> update-available; after Update -> up-to-date with new commit recorded', async () => {
    const remoteRepoDir = path.join(testWorkspaceDir, 'remotes', 'git-changed');
    initGitRepo(remoteRepoDir);
    writeSkillFile(remoteRepoDir, 'skills/evolving-skill', 'evolving-skill', 'Version 1', '# Body v1');
    const commit1 = commitAll(remoteRepoDir, 'Commit 1');

    const gitSource: Source = {
      id: 'src-evolving',
      type: 'git-custom',
      scope: 'project',
      projectPath: testWorkspaceDir,
      url: remoteRepoDir,
    };

    const { installation } = await resolveAndInstallSkill({
      source: gitSource,
      skillName: 'evolving-skill',
    });
    assert.strictEqual(installation.sourceRevision?.commit, commit1);

    // Commit 2 modifies evolving-skill
    writeSkillFile(remoteRepoDir, 'skills/evolving-skill', 'evolving-skill', 'Version 2', '# Body v2 updated');
    const commit2 = commitAll(remoteRepoDir, 'Commit 2: update evolving-skill');
    assert.notStrictEqual(commit1, commit2);

    const checkBefore = await checkForUpstreamUpdate(installation, gitSource, testHomeDir);
    assert.strictEqual(checkBefore.status, 'update-available');

    // Plan and apply update
    const preparedUpdate = await planUpdate(installation, gitSource, {
      homeRoot: testHomeDir,
      projectRoot: testWorkspaceDir,
    });
    assert.strictEqual(preparedUpdate.supported, true);
    const updateOutcome = await applyInstall(preparedUpdate, testHomeDir);
    assert.strictEqual(updateOutcome.status, 'applied');
    if (updateOutcome.status !== 'applied') return;

    const updatedInst = updateOutcome.installation;
    assert.strictEqual(updatedInst.sourceRevision?.commit, commit2, 'Updated installation must record commit2');

    const checkAfter = await checkForUpstreamUpdate(updatedInst, gitSource, testHomeDir);
    assert.strictEqual(checkAfter.status, 'up-to-date');
  });

  // Case 6: Two plugins with a same-name skill: each installation compared with its own artifact.
  // Observed wrong result on main: when plugin-a is removed or its skill is renamed while plugin-b still has
  // a skill with the same name (`shared-name`), `checkForUpstreamUpdate` (`src/engine/drift.ts:318-325`) falls
  // back to `art.kind === installation.kind && art.name === installation.name`, matching plugin-b's artifact
  // crosswise and reporting `update-available` instead of `source-unavailable`. Furthermore, `gitMarketplace.ts:392-408`
  // `resolveArtifactContent` resolves `pathId = "plugin-a:skill:shared-name"` (artifactId has `:skill:` segment
  // while `pkg.id` is `mkt-two-plugins:plugin-a`), so even when both plugins exist, `resolveArtifactContent`
  // fails the candidate lookup and `walkSkill` picks the first `shared-name` directory in the repo (plugin-a's)
  // for plugin-b as well!
  it(
    '6. two plugins in a marketplace with a same-name skill -> each installation is compared strictly with its own artifact',
    async () => {
      const remoteRepoDir = path.join(testWorkspaceDir, 'remotes', 'mkt-same-name');
      initGitRepo(remoteRepoDir);

      writeSkillFile(
        remoteRepoDir,
        'plugins/plugin-a/skills/shared-name',
        'shared-name',
        'Skill from plugin A',
        '# Plugin A implementation v1'
      );
      writeSkillFile(
        remoteRepoDir,
        'plugins/plugin-b/skills/shared-name',
        'shared-name',
        'Skill from plugin B',
        '# Plugin B completely different implementation v1'
      );
      fs.mkdirSync(path.join(remoteRepoDir, '.claude-plugin'), { recursive: true });
      fs.writeFileSync(
        path.join(remoteRepoDir, '.claude-plugin', 'marketplace.json'),
        JSON.stringify({
          plugins: [
            { name: 'plugin-a', source: 'plugins/plugin-a', version: '1.0.0' },
            { name: 'plugin-b', source: 'plugins/plugin-b', version: '1.0.0' },
          ],
        }),
        'utf-8'
      );
      commitAll(remoteRepoDir, 'Initial marketplace with two plugins having shared-name skill');

      const mktSource: Source = {
        id: 'mkt-two-plugins',
        type: 'git-marketplace',
        scope: 'project',
        projectPath: testWorkspaceDir,
        url: remoteRepoDir,
      };

      // Install plugin-a's skill into claude-code and plugin-b's skill into kilo-code
      const { installation: instA } = await resolveAndInstallSkill({
        source: mktSource,
        skillName: 'shared-name',
        artifactId: 'mkt-two-plugins:plugin-a:skill:shared-name',
        assistant: 'claude-code',
      });
      const { installation: instB } = await resolveAndInstallSkill({
        source: mktSource,
        skillName: 'shared-name',
        artifactId: 'mkt-two-plugins:plugin-b:skill:shared-name',
        assistant: 'kilo-code',
      });

      assert.notStrictEqual(
        instA.contentHash,
        instB.contentHash,
        'plugin-a and plugin-b skills have different bodies and must not collide during content resolution'
      );

      // Modify ONLY plugin-b's skill in a new commit
      writeSkillFile(
        remoteRepoDir,
        'plugins/plugin-b/skills/shared-name',
        'shared-name',
        'Skill from plugin B v2',
        '# Plugin B updated in v2'
      );
      commitAll(remoteRepoDir, 'Update only plugin-b shared-name skill');

      const reportA = await checkForUpstreamUpdate(instA, mktSource, testHomeDir);
      const reportB = await checkForUpstreamUpdate(instB, mktSource, testHomeDir);

      assert.strictEqual(reportA.status, 'up-to-date', 'instA (plugin-a) was not touched and must be up-to-date');
      assert.strictEqual(reportB.status, 'update-available', 'instB (plugin-b) was modified and must be update-available');

      // Now remove plugin-a's skill from the marketplace while plugin-b still has `shared-name`
      fs.rmSync(path.join(remoteRepoDir, 'plugins/plugin-a/skills/shared-name'), { recursive: true, force: true });
      commitAll(remoteRepoDir, 'Remove shared-name from plugin-a');

      const reportAAfterRemoval = await checkForUpstreamUpdate(instA, mktSource, testHomeDir);
      assert.strictEqual(
        reportAAfterRemoval.status as string,
        'source-unavailable',
        'instA must not fall back to plugin-b skill by name; must report source-unavailable'
      );
      assert.strictEqual(
        reportAAfterRemoval.reason,
        'artifact mkt-two-plugins:plugin-a:skill:shared-name no longer in source',
        'Report must carry exact missing-artifact reason'
      );
      assert.strictEqual(
        reportAAfterRemoval.hint,
        'same name found: mkt-two-plugins:plugin-b:skill:shared-name',
        'Report must carry same-name hint pointing to plugin-b artifact id'
      );
      assert.ok(
        reportAAfterRemoval.details?.includes('artifact mkt-two-plugins:plugin-a:skill:shared-name no longer in source') &&
          reportAAfterRemoval.details?.includes('same name found: mkt-two-plugins:plugin-b:skill:shared-name'),
        `Details must include reason and hint, got: ${reportAAfterRemoval.details}`
      );

      // planUpdate on instA must also refuse with reason + hint (never falling back to plugin-b)
      const plannedA = await planUpdate(instA, mktSource, {
        homeRoot: testHomeDir,
        projectRoot: testWorkspaceDir,
      });
      assert.strictEqual(plannedA.supported, false);
      if (!plannedA.supported) {
        assert.ok(
          plannedA.plan.reason.includes('artifact mkt-two-plugins:plugin-a:skill:shared-name no longer in source'),
          `planUpdate reason must report missing artifact id, got: ${plannedA.plan.reason}`
        );
        assert.ok(
          plannedA.plan.reason.includes('same name found: mkt-two-plugins:plugin-b:skill:shared-name'),
          `planUpdate reason must include same-name hint, got: ${plannedA.plan.reason}`
        );
      }

      // Deterministic id-shape conversion: an old installation with local-folder path-based artifactId
      // (`<sourceId>:plugins/<plugin>/skills/<name>:<name>`) for the same plugin (`plugin-b`) is matched deterministically,
      // while one for removed `plugin-a` is rejected with source-unavailable + hint.
      const legacyShapeInstB: ManagedInstallation = {
        ...instB,
        packageId: 'mkt-two-plugins:plugins/plugin-b/skills/shared-name',
        artifactId: 'mkt-two-plugins:plugins/plugin-b/skills/shared-name:shared-name',
      };
      const reportLegacyB = await checkForUpstreamUpdate(legacyShapeInstB, mktSource, testHomeDir);
      assert.strictEqual(reportLegacyB.status, 'update-available');
      assert.ok(
        reportLegacyB.details?.includes('id-shape conversion'),
        `Converted id-shape match must note the conversion, got: ${reportLegacyB.details}`
      );

      const legacyShapeInstA: ManagedInstallation = {
        ...instA,
        packageId: 'mkt-two-plugins:plugins/plugin-a/skills/shared-name',
        artifactId: 'mkt-two-plugins:plugins/plugin-a/skills/shared-name:shared-name',
      };
      const reportLegacyA = await checkForUpstreamUpdate(legacyShapeInstA, mktSource, testHomeDir);
      assert.strictEqual(reportLegacyA.status, 'source-unavailable');
      assert.strictEqual(
        reportLegacyA.hint,
        'same name found: mkt-two-plugins:plugin-b:skill:shared-name'
      );
    }
  );

  // Case 7: Content changed with unchanged plugin version (2026-10-08 note §7): detected.
  it('7. content changed in git-marketplace plugin with unchanged plugin version in marketplace.json -> update-available detected', async () => {
    const remoteRepoDir = path.join(testWorkspaceDir, 'remotes', 'mkt-unbumped');
    initGitRepo(remoteRepoDir);

    writeSkillFile(
      remoteRepoDir,
      'plugins/toolkit/skills/doc-skill',
      'doc-skill',
      'Doc skill v1',
      '# Documentation standard v1'
    );
    fs.mkdirSync(path.join(remoteRepoDir, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(
      path.join(remoteRepoDir, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({
        plugins: [
          {
            name: 'toolkit',
            source: 'plugins/toolkit',
            version: '1.2.0',
          },
        ],
      }),
      'utf-8'
    );
    commitAll(remoteRepoDir, 'Initial release 1.2.0');

    const mktSource: Source = {
      id: 'gcube-mkt',
      type: 'git-marketplace',
      scope: 'project',
      projectPath: testWorkspaceDir,
      url: remoteRepoDir,
    };

    const { installation } = await resolveAndInstallSkill({
      source: mktSource,
      skillName: 'doc-skill',
    });

    const initialCheck = await checkForUpstreamUpdate(installation, mktSource, testHomeDir);
    assert.strictEqual(initialCheck.status, 'up-to-date');

    // Change SKILL.md content in a new commit WITHOUT bumping version '1.2.0' in marketplace.json
    writeSkillFile(
      remoteRepoDir,
      'plugins/toolkit/skills/doc-skill',
      'doc-skill',
      'Doc skill v1 with hotfix',
      '# Documentation standard v1 — hotfix applied without version bump'
    );
    commitAll(remoteRepoDir, 'Hotfix skill content without bumping plugin version');

    const afterHotfixCheck = await checkForUpstreamUpdate(installation, mktSource, testHomeDir);
    assert.strictEqual(
      afterHotfixCheck.status,
      'update-available',
      'Content change must be detected even when marketplace plugin version is unchanged'
    );
  });

  // Case 8: Old state file: migrated or provenance-unknown, never a false update-available.
  // Observed wrong result on main: no migration or `provenance-unknown` state exists; an installation record
  // from an old `state.json` (with bare `sourceId` and no `source` / `sourceRevision` / `sourceContentHash`)
  // is matched against the first source with that `sourceId` and reports a false `update-available` whenever
  // that source's current content differs from `contentHash`.
  it(
    '8. old state.json record (bare sourceId, no provenance object) -> migrated when uniquely matched or marked provenance-unknown, never a false update-available',
    { todo: 'fixed by 49.6' },
    async () => {
      const sharedId = 'legacy-source';

      // Create two sources with the same id in global and project scopes, neither matching the old installation hash
      const globalFolder = path.join(testHomeDir, 'legacy-global');
      writeSkillFile(globalFolder, 'skills/legacy-skill', 'legacy-skill', 'Global version', '# Global content v2');
      const globalSource: Source = {
        id: sharedId,
        type: 'local-folder',
        scope: 'global',
        localPath: globalFolder,
      };
      await writeManifest(
        'global',
        {
          schemaVersion: SCHEMA_VERSION,
          sources: [toDesiredSource(globalSource, undefined, testHomeDir)],
          desiredInstallations: [],
        },
        undefined,
        testHomeDir
      );

      const remoteRepoDir = path.join(testWorkspaceDir, 'remotes', 'legacy-git');
      initGitRepo(remoteRepoDir);
      writeSkillFile(remoteRepoDir, 'skills/legacy-skill', 'legacy-skill', 'Git version', '# Git content v3');
      commitAll(remoteRepoDir, 'Git commit');
      const projectSource: Source = {
        id: sharedId,
        type: 'git-custom',
        scope: 'project',
        projectPath: testWorkspaceDir,
        url: remoteRepoDir,
      };
      await writeManifest(
        'project',
        {
          schemaVersion: SCHEMA_VERSION,
          sources: [toDesiredSource(projectSource, testWorkspaceDir, testHomeDir)],
          desiredInstallations: [],
        },
        testWorkspaceDir,
        testHomeDir
      );

      // Install a skill first so files exist on disk, then strip provenance fields to simulate an old state.json
      const tempOriginFolder = path.join(testWorkspaceDir, 'temp-origin');
      writeSkillFile(
        tempOriginFolder,
        'skills/legacy-skill',
        'legacy-skill',
        'Original v1 installed long ago',
        '# Original v1 content'
      );
      const tempOriginSource: Source = {
        id: sharedId,
        type: 'local-folder',
        scope: 'project',
        projectPath: testWorkspaceDir,
        localPath: tempOriginFolder,
      };
      const { installation: rawInstalled } = await resolveAndInstallSkill({
        source: tempOriginSource,
        skillName: 'legacy-skill',
      });

      // Write old-format installation (only bare sourceId and contentHash, no source or sourceRevision)
      const legacyInstallation: ManagedInstallation = {
        assistant: rawInstalled.assistant,
        scope: rawInstalled.scope,
        projectPath: rawInstalled.projectPath,
        kind: rawInstalled.kind,
        name: rawInstalled.name,
        path: rawInstalled.path,
        sourceId: sharedId,
        installedAt: '2026-09-01T00:00:00.000Z',
        contentHash: rawInstalled.contentHash,
      };
      await writeState(
        'project',
        {
          schemaVersion: SCHEMA_VERSION,
          installations: [legacyInstallation],
        },
        testWorkspaceDir,
        testHomeDir
      );

      const stateLoaded = await readState('project', testWorkspaceDir, testHomeDir);
      const loadedInst = stateLoaded.installations[0];

      const reports = await checkDriftForAll(
        [loadedInst],
        [globalSource, projectSource],
        testHomeDir
      );
      assert.strictEqual(reports.length, 1);
      assert.notStrictEqual(
        reports[0].status,
        'update-available',
        'Ambiguous legacy installation must never produce a false update-available'
      );
      assert.strictEqual(
        reports[0].status as string,
        'provenance-unknown',
        'Ambiguous legacy installation that cannot be uniquely attributed must be marked provenance-unknown'
      );
    }
  );
});
