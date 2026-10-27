import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Source, ResolvedArtifact } from '../domain/types';
import type { CanonicalSkill, CanonicalCommand, CanonicalMcpServer } from '../adapters/types';
import type { SourceResolution } from './types';
import {
  resolveLocalFolder,
  resolveArtifactContent,
  localFolderResolver,
  UntrackedArtifactError,
} from './localFolder';
import { getAdapterWithHomeRoot } from '../adapters/registry';
import { planInstall } from '../engine/plan';
import { applyInstall } from '../engine/apply';
import { checkForUpstreamUpdate } from '../engine/drift';

function getFixturesRoot(): string {
  const candidateOut = path.join(__dirname, '__fixtures__');
  if (fs.existsSync(candidateOut)) return candidateOut;
  return path.resolve(__dirname, '../../src/sources/__fixtures__');
}

describe('localFolder — resolveLocalFolder with committed fixtures', () => {
  const fixturesRoot = getFixturesRoot();
  const rootSkillPath = path.join(fixturesRoot, 'root-skill');
  const nestedSkillsPath = path.join(fixturesRoot, 'nested-skills');
  const mixedPath = path.join(fixturesRoot, 'mixed');

  it('resolves root-skill fixture to 1 package with 0 diagnostics', async () => {
    const source: Source = {
      id: 'src-root',
      type: 'local-folder',
      scope: 'project',
      localPath: rootSkillPath,
    };

    const resolution: SourceResolution = await resolveLocalFolder(source);
    assert.strictEqual(resolution.packages.length, 1);
    assert.strictEqual(resolution.diagnostics.length, 0);

    const pkg = resolution.packages[0];
    assert.strictEqual(pkg.sourceId, 'src-root');
    assert.strictEqual(pkg.nativeFormat, 'claude-skill');
    assert.strictEqual(pkg.artifacts.length, 1);

    const artifact = pkg.artifacts[0];
    assert.strictEqual(artifact.kind, 'skill');
    assert.strictEqual(artifact.name, 'root-skill');
    assert.strictEqual(artifact.packageId, pkg.id);
  });

  it('resolves nested-skills fixture to 2 packages deterministically', async () => {
    const source: Source = {
      id: 'src-nested',
      type: 'local-folder',
      scope: 'project',
      localPath: nestedSkillsPath,
    };

    const resolution1 = await resolveLocalFolder(source);
    const resolution2 = await resolveLocalFolder(source);

    assert.strictEqual(resolution1.packages.length, 2);
    assert.strictEqual(resolution2.packages.length, 2);
    assert.strictEqual(resolution1.diagnostics.length, 0);

    for (let i = 0; i < resolution1.packages.length; i++) {
      assert.strictEqual(resolution1.packages[i].id, resolution2.packages[i].id);
      assert.strictEqual(
        resolution1.packages[i].artifacts[0].id,
        resolution2.packages[i].artifacts[0].id
      );
    }
  });

  it('resolves mixed fixture including a skill with no explicit name in frontmatter', async () => {
    const source: Source = {
      id: 'src-mixed',
      type: 'local-folder',
      scope: 'project',
      localPath: mixedPath,
    };

    const resolution = await resolveLocalFolder(source);
    assert.strictEqual(resolution.packages.length, 2);
    // The mixed fixture's "malformed-skill" only omits `name` in frontmatter,
    // which falls back to the directory name — not diagnostic-worthy.
    assert.strictEqual(resolution.diagnostics.length, 0);
  });

  it('resolves fixtures root containing skills, agents, and commands', async () => {
    const source: Source = {
      id: 'src-all',
      type: 'local-folder',
      scope: 'project',
      localPath: fixturesRoot,
    };

    const resolution = await resolveLocalFolder(source);
    const agentPkg = resolution.packages.find((p) => p.artifacts[0].kind === 'agent');
    assert.ok(agentPkg);
    assert.strictEqual(agentPkg.artifacts[0].name, 'code-reviewer');

    const cmdPkg = resolution.packages.find((p) => p.artifacts[0].kind === 'command');
    assert.ok(cmdPkg);
    assert.strictEqual(cmdPkg.artifacts[0].name, 'review');

    const resolved = (await resolveArtifactContent(
      source,
      cmdPkg,
      cmdPkg.artifacts[0]
    )) as ResolvedArtifact<CanonicalCommand>;

    assert.strictEqual(resolved.content.name, 'review');
    assert.strictEqual(resolved.content.agent, 'code-reviewer');
  });

  it('resolves MCP server from mcp.json in local folder', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'local-mcp-'));
    try {
      await fs.promises.writeFile(
        path.join(tempDir, 'mcp.json'),
        JSON.stringify({
          mcpServers: {
            'github-mcp': {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-github'],
              description: 'GitHub MCP Server',
            },
          },
        }),
        'utf-8'
      );

      const source: Source = {
        id: 'src-local-mcp',
        type: 'local-folder',
        scope: 'project',
        localPath: tempDir,
      };

      const resolution = await resolveLocalFolder(source);
      assert.strictEqual(resolution.packages.length, 1);
      const pkg = resolution.packages[0];
      assert.strictEqual(pkg.artifacts[0].kind, 'mcp-server');
      assert.strictEqual(pkg.artifacts[0].name, 'github-mcp');

      const resolved = (await resolveArtifactContent(
        source,
        pkg,
        pkg.artifacts[0]
      )) as ResolvedArtifact<CanonicalMcpServer>;

      assert.strictEqual(resolved.content.id, 'github-mcp');
      assert.strictEqual(resolved.content.command, 'npx');
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('returns empty packages and diagnostics when source has no localPath or path does not exist', async () => {
    const emptySource: Source = {
      id: 'src-empty',
      type: 'local-folder',
      scope: 'global',
    };
    const resEmpty = await resolveLocalFolder(emptySource);
    assert.deepStrictEqual(resEmpty, { packages: [], diagnostics: [] });

    const nonExistentSource: Source = {
      id: 'src-nonexistent',
      type: 'local-folder',
      scope: 'global',
      localPath: path.join(fixturesRoot, 'nonexistent-' + Date.now()),
    };
    const resNonExistent = await resolveLocalFolder(nonExistentSource);
    assert.deepStrictEqual(resNonExistent, { packages: [], diagnostics: [] });
  });

  it('resolveArtifactContent resolves CanonicalSkill with auxiliary files without casts', async () => {
    const source: Source = {
      id: 'src-nested',
      type: 'local-folder',
      scope: 'project',
      localPath: nestedSkillsPath,
    };

    const resolution = await resolveLocalFolder(source);
    const skillBPkg = resolution.packages.find((p) => p.artifacts[0].name === 'nested-skill-b');
    assert.ok(skillBPkg);
    const artifact = skillBPkg.artifacts[0];

    const resolved = (await resolveArtifactContent(
      source,
      skillBPkg,
      artifact
    )) as ResolvedArtifact<CanonicalSkill>;
    assert.strictEqual(resolved.artifact.id, artifact.id);
    assert.strictEqual(resolved.content.name, 'nested-skill-b');
    assert.strictEqual(resolved.content.description, 'Second nested skill fixture with auxiliary script');
    assert.strictEqual(resolved.content.files.length, 1);
    assert.strictEqual(resolved.content.files[0].path, 'scripts/helper.sh');
  });

  it('exposes localFolderResolver conforming to SourceResolver', () => {
    assert.strictEqual(localFolderResolver.type, 'local-folder');
    assert.strictEqual(localFolderResolver.displayName, 'Local folder');
    assert.strictEqual(localFolderResolver.iconThemeId, 'folder');
    assert.strictEqual(localFolderResolver.resolve, resolveLocalFolder);
    assert.strictEqual(localFolderResolver.resolveArtifactContent, resolveArtifactContent);
  });

  it('git local-folder records commit and per-artifact dirty, reads HEAD by default, and reports untracked artifact as source-unavailable with hint', async () => {
    const tempBase = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'local-git-49-4-'));

    function runGitSync(args: string[], cwd: string): string {
      return child_process
        .execFileSync('git', args, {
          cwd,
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: '0',
            GIT_CONFIG_GLOBAL: path.join(tempBase, '.gitconfig'),
            GIT_CONFIG_NOSYSTEM: '1',
          },
        })
        .toString();
    }

    try {
      const repoDir = path.join(tempBase, 'repo');
      const wsDir = path.join(tempBase, 'ws');
      const homeDir = path.join(tempBase, 'home');
      await fs.promises.mkdir(repoDir, { recursive: true });
      await fs.promises.mkdir(wsDir, { recursive: true });
      await fs.promises.mkdir(homeDir, { recursive: true });

      runGitSync(['init', '-b', 'main'], repoDir);
      runGitSync(['config', 'user.name', 'Test User'], repoDir);
      runGitSync(['config', 'user.email', 'test@example.com'], repoDir);

      // Create two skills (skill-clean with executable script, skill-edited)
      const skillCleanDir = path.join(repoDir, 'skills', 'skill-clean');
      const skillEditedDir = path.join(repoDir, 'skills', 'skill-edited');
      await fs.promises.mkdir(path.join(skillCleanDir, 'scripts'), { recursive: true });
      await fs.promises.mkdir(skillEditedDir, { recursive: true });

      await fs.promises.writeFile(
        path.join(skillCleanDir, 'SKILL.md'),
        '---\nname: skill-clean\ndescription: Clean skill\n---\n# Clean v1\n',
        'utf-8'
      );
      const scriptPath = path.join(skillCleanDir, 'scripts', 'run.sh');
      await fs.promises.writeFile(scriptPath, '#!/bin/sh\necho clean\n', 'utf-8');
      await fs.promises.chmod(scriptPath, 0o755);

      await fs.promises.writeFile(
        path.join(skillEditedDir, 'SKILL.md'),
        '---\nname: skill-edited\ndescription: Committed desc\n---\n# Committed body\n',
        'utf-8'
      );

      runGitSync(['add', '.'], repoDir);
      runGitSync(['commit', '-m', 'Initial commit'], repoDir);
      const headSha = runGitSync(['rev-parse', 'HEAD'], repoDir).trim();

      // Modify skill-edited and add an untracked skill-untracked
      await fs.promises.writeFile(
        path.join(skillEditedDir, 'SKILL.md'),
        '---\nname: skill-edited\ndescription: Dirty desc\n---\n# Dirty body\n',
        'utf-8'
      );
      const skillUntrackedDir = path.join(repoDir, 'skills', 'skill-untracked');
      await fs.promises.mkdir(skillUntrackedDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(skillUntrackedDir, 'SKILL.md'),
        '---\nname: skill-untracked\ndescription: Untracked skill\n---\n# Untracked body\n',
        'utf-8'
      );

      const sourceDefault: Source = {
        id: 'git-local',
        type: 'local-folder',
        scope: 'project',
        projectPath: wsDir,
        localPath: repoDir,
      };

      const resolution = await resolveLocalFolder(sourceDefault);
      const pkgClean = resolution.packages.find((p) => p.artifacts[0]?.name === 'skill-clean');
      const pkgEdited = resolution.packages.find((p) => p.artifacts[0]?.name === 'skill-edited');
      const pkgUntracked = resolution.packages.find((p) => p.artifacts[0]?.name === 'skill-untracked');

      assert.ok(pkgClean && pkgEdited && pkgUntracked);
      // 1. Only the artifact's own path counts for dirty
      assert.deepStrictEqual(pkgClean.version, {
        commit: headSha,
        requestedRef: 'HEAD',
        dirty: false,
      });
      assert.deepStrictEqual(pkgEdited.version, {
        commit: headSha,
        requestedRef: 'HEAD',
        dirty: true,
      });
      assert.deepStrictEqual(pkgUntracked.version, {
        commit: headSha,
        requestedRef: 'HEAD',
        dirty: true,
      });

      // 2. Default content resolution reads committed HEAD and preserves ls-tree file mode
      const cleanResolved = (await resolveArtifactContent(
        sourceDefault,
        pkgClean,
        pkgClean.artifacts[0]
      )) as ResolvedArtifact<CanonicalSkill>;
      assert.strictEqual(cleanResolved.content.files.length, 1);
      assert.strictEqual(cleanResolved.content.files[0].mode, 0o100755);

      const editedHeadResolved = (await resolveArtifactContent(
        sourceDefault,
        pkgEdited,
        pkgEdited.artifacts[0]
      )) as ResolvedArtifact<CanonicalSkill>;
      assert.strictEqual(editedHeadResolved.content.description, 'Committed desc');
      assert.ok(editedHeadResolved.content.body.includes('# Committed body'));

      // With readWorkingTree: true, reads working tree and records dirty on install
      const sourceWT: Source = { ...sourceDefault, readWorkingTree: true };
      const editedWTResolved = (await resolveArtifactContent(
        sourceWT,
        pkgEdited,
        pkgEdited.artifacts[0]
      )) as ResolvedArtifact<CanonicalSkill>;
      assert.strictEqual(editedWTResolved.content.description, 'Dirty desc');
      assert.ok(editedWTResolved.content.body.includes('# Dirty body'));

      const adapter = getAdapterWithHomeRoot('claude-code', homeDir)!;
      const preparedWT = await planInstall({
        source: sourceWT,
        pkg: pkgEdited,
        artifact: pkgEdited.artifacts[0],
        targetAdapter: adapter,
        targetScope: 'project',
        projectRoot: wsDir,
        homeRoot: homeDir,
      });
      assert.strictEqual(preparedWT.supported, true);
      const outcomeWT = await applyInstall(preparedWT, homeDir);
      assert.strictEqual(outcomeWT.status, 'applied');
      if (outcomeWT.status === 'applied') {
        assert.deepStrictEqual(outcomeWT.installation.sourceRevision, {
          commit: headSha,
          requestedRef: 'HEAD',
          dirty: true,
        });
      }

      // 5. Untracked artifact with default settings -> UntrackedArtifactError & source-unavailable with hint
      const expectedHint = `not committed in ${repoDir}; commit it or set readWorkingTree`;
      await assert.rejects(
        () => resolveArtifactContent(sourceDefault, pkgUntracked, pkgUntracked.artifacts[0]),
        (err: unknown) =>
          err instanceof UntrackedArtifactError && err.hint === expectedHint
      );

      // Install untracked skill using readWorkingTree: true, then check drift with default settings
      const preparedUntracked = await planInstall({
        source: sourceWT,
        pkg: pkgUntracked,
        artifact: pkgUntracked.artifacts[0],
        targetAdapter: adapter,
        targetScope: 'project',
        projectRoot: wsDir,
        homeRoot: homeDir,
      });
      const outcomeUntracked = await applyInstall(preparedUntracked, homeDir);
      assert.strictEqual(outcomeUntracked.status, 'applied');
      if (outcomeUntracked.status === 'applied') {
        const untrackedDrift = await checkForUpstreamUpdate(
          outcomeUntracked.installation,
          sourceDefault,
          homeDir
        );
        assert.strictEqual(untrackedDrift.status, 'source-unavailable');
        assert.strictEqual(untrackedDrift.hint, expectedHint);
      }
    } finally {
      await fs.promises.rm(tempBase, { recursive: true, force: true });
    }
  });
});

