import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Source, ResolvedArtifact } from '../domain/types';
import type { CanonicalSkill, CanonicalAgent, CanonicalCommand } from '../adapters/types';
import type { SourceResolution } from './types';
import { resolveGitCustom, resolveArtifactContent, gitCustomMutex } from './gitCustom';

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

function getFixturesRoot(): string {
  const candidateOut = path.join(__dirname, '__fixtures__');
  if (fs.existsSync(candidateOut)) return candidateOut;
  return path.resolve(__dirname, '../../src/sources/__fixtures__');
}

describe('gitCustom — resolveGitCustom with committed fixtures in dynamic repository', () => {
  let tempBase: string;
  let remoteRepoDir: string;
  let cacheBaseDir: string;
  let initialCommitHash: string;
  let secondCommitHash: string;

  const fixturesRoot = getFixturesRoot();

  before(() => {
    tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'git-custom-test-'));
    remoteRepoDir = path.join(tempBase, 'remote-repo');
    cacheBaseDir = path.join(tempBase, 'cache');

    fs.mkdirSync(remoteRepoDir, { recursive: true });
    fs.mkdirSync(cacheBaseDir, { recursive: true });

    // Initialize real git repository
    runGitSync(['init', '-b', 'main'], remoteRepoDir);
    runGitSync(['config', 'user.name', 'Test Engineer'], remoteRepoDir);
    runGitSync(['config', 'user.email', 'engineer@test.local'], remoteRepoDir);

    // Commit 1: add root-skill
    const rootFixture = path.join(fixturesRoot, 'root-skill');
    const destRoot = path.join(remoteRepoDir, 'skills', 'root-skill');
    fs.cpSync(rootFixture, destRoot, { recursive: true });

    runGitSync(['add', '.'], remoteRepoDir);
    runGitSync(['commit', '-m', 'Add root skill'], remoteRepoDir);
    initialCommitHash = runGitSync(['rev-parse', 'HEAD'], remoteRepoDir).trim();
    runGitSync(['tag', 'v1.0.0'], remoteRepoDir);

    // Commit 2: add nested-skills, agent, and command
    const nestedFixture = path.join(fixturesRoot, 'nested-skills');
    const destNested = path.join(remoteRepoDir, 'skills', 'nested');
    fs.cpSync(nestedFixture, destNested, { recursive: true });

    const agentsFixture = path.join(fixturesRoot, 'agents');
    const destAgents = path.join(remoteRepoDir, 'agents');
    fs.cpSync(agentsFixture, destAgents, { recursive: true });

    const commandsFixture = path.join(fixturesRoot, 'commands');
    const destCommands = path.join(remoteRepoDir, 'commands');
    fs.cpSync(commandsFixture, destCommands, { recursive: true });

    runGitSync(['add', '.'], remoteRepoDir);
    runGitSync(['commit', '-m', 'Add nested skills, agents, and commands'], remoteRepoDir);
    secondCommitHash = runGitSync(['rev-parse', 'HEAD'], remoteRepoDir).trim();
    runGitSync(['tag', 'v2.0.0'], remoteRepoDir);

    // Branch feature-skills: add mixed skills
    runGitSync(['checkout', '-b', 'feature-skills'], remoteRepoDir);
    const mixedFixture = path.join(fixturesRoot, 'mixed');
    const destMixed = path.join(remoteRepoDir, 'skills', 'mixed');
    fs.cpSync(mixedFixture, destMixed, { recursive: true });

    runGitSync(['add', '.'], remoteRepoDir);
    runGitSync(['commit', '-m', 'Add mixed skills on branch'], remoteRepoDir);

    // Switch back to default branch (main)
    runGitSync(['checkout', 'main'], remoteRepoDir);
  });

  after(() => {
    if (tempBase && fs.existsSync(tempBase)) {
      fs.rmSync(tempBase, { recursive: true, force: true });
    }
  });

  it('resolves default branch to packages (skills, agents, commands) on latest main commit', async () => {
    const source: Source = {
      id: 'src-test-default',
      type: 'git-custom',
      scope: 'project',
      url: remoteRepoDir,
    };

    const resolution: SourceResolution = await resolveGitCustom(source, { cacheDir: cacheBaseDir });
    // 1 root skill + 2 nested skills + 1 agent + 1 command = 5 packages
    assert.strictEqual(resolution.packages.length, 5);
    assert.strictEqual(resolution.diagnostics.length, 0);

    const names = resolution.packages.map((p) => p.artifacts[0].name);
    assert.ok(names.includes('root-skill'));
    assert.ok(names.includes('nested-skill-a'));
    assert.ok(names.includes('nested-skill-b'));
    assert.ok(names.includes('code-reviewer'));
    assert.ok(names.includes('review'));

    const cmdPkg = resolution.packages.find((p) => p.artifacts[0].name === 'review');
    assert.ok(cmdPkg);
    assert.strictEqual(cmdPkg.artifacts[0].kind, 'command');
  });

  it('resolves a specific tag pin (v1.0.0) with exact ResolvedRevision', async () => {
    const source: Source = {
      id: 'src-test-tag-v1',
      type: 'git-custom',
      scope: 'project',
      url: remoteRepoDir,
      tag: 'v1.0.0',
    };

    const resolution = await resolveGitCustom(source, { cacheDir: cacheBaseDir });
    assert.strictEqual(resolution.packages.length, 1);
    assert.strictEqual(resolution.packages[0].artifacts[0].name, 'root-skill');
    assert.deepStrictEqual(resolution.packages[0].version, {
      commit: initialCommitHash,
      requestedRef: 'v1.0.0',
    });
  });

  it('resolves a specific tag pin (v2.0.0) and commit pin for second commit', async () => {
    const sourceTag: Source = {
      id: 'src-test-tag-v2',
      type: 'git-custom',
      scope: 'project',
      url: remoteRepoDir,
      tag: 'v2.0.0',
    };
    const resTag = await resolveGitCustom(sourceTag, { cacheDir: cacheBaseDir });
    assert.strictEqual(resTag.packages.length, 5);
    assert.deepStrictEqual(resTag.packages[0].version, {
      commit: secondCommitHash,
      requestedRef: 'v2.0.0',
    });

    const sourceCommit: Source = {
      id: 'src-test-commit-second',
      type: 'git-custom',
      scope: 'project',
      url: remoteRepoDir,
      commit: secondCommitHash,
    };
    const resCommit = await resolveGitCustom(sourceCommit, { cacheDir: cacheBaseDir });
    assert.strictEqual(resCommit.packages.length, 5);
    assert.deepStrictEqual(resCommit.packages[0].version, {
      commit: secondCommitHash,
      requestedRef: secondCommitHash,
    });
  });

  it('resolves branch pin carrying both valid packages and detection diagnostics', async () => {
    const source: Source = {
      id: 'src-test-branch-feature',
      type: 'git-custom',
      scope: 'project',
      url: remoteRepoDir,
      branch: 'feature-skills',
    };

    const resolution = await resolveGitCustom(source, { cacheDir: cacheBaseDir });
    // 5 from main + 2 from mixed = 7
    assert.strictEqual(resolution.packages.length, 7);
    assert.strictEqual(resolution.diagnostics.length, 1);
    assert.strictEqual(resolution.diagnostics[0].code, 'invalid-frontmatter');
    assert.strictEqual(resolution.packages[0].version?.requestedRef, 'feature-skills');
  });

  it('runs concurrent resolveGitCustom calls on different refs with deterministic results', async () => {
    const sourceV1: Source = {
      id: 'src-test-concurrent',
      type: 'git-custom',
      scope: 'project',
      url: remoteRepoDir,
      tag: 'v1.0.0',
    };
    const sourceV2: Source = {
      id: 'src-test-concurrent',
      type: 'git-custom',
      scope: 'project',
      url: remoteRepoDir,
      tag: 'v2.0.0',
    };

    const [res1, res2] = await Promise.all([
      resolveGitCustom(sourceV1, { cacheDir: cacheBaseDir }),
      resolveGitCustom(sourceV2, { cacheDir: cacheBaseDir }),
    ]);

    assert.strictEqual(res1.packages.length, 1);
    assert.strictEqual(res2.packages.length, 5);
    assert.strictEqual(res1.packages[0].version?.commit, initialCommitHash);
    assert.strictEqual(res2.packages[0].version?.commit, secondCommitHash);
  });

  it('resolveArtifactContent resolves CanonicalSkill with auxiliary files without casts', async () => {
    const source: Source = {
      id: 'src-test-content',
      type: 'git-custom',
      scope: 'project',
      url: remoteRepoDir,
      tag: 'v2.0.0',
    };

    const resolution = await resolveGitCustom(source, { cacheDir: cacheBaseDir });
    const pkg = resolution.packages.find((p) => p.artifacts[0].name === 'nested-skill-b');
    assert.ok(pkg);
    const artifact = pkg.artifacts[0];

    const resolved = (await resolveArtifactContent(
      source,
      pkg,
      artifact,
      { cacheDir: cacheBaseDir }
    )) as ResolvedArtifact<CanonicalSkill>;

    assert.strictEqual(resolved.artifact.id, artifact.id);
    assert.strictEqual(resolved.content.name, 'nested-skill-b');
    assert.strictEqual(resolved.content.files.length, 1);
    assert.strictEqual(resolved.content.files[0].path, 'scripts/helper.sh');
  });

  it('resolveArtifactContent resolves CanonicalAgent from git repository', async () => {
    const source: Source = {
      id: 'src-test-agent',
      type: 'git-custom',
      scope: 'project',
      url: remoteRepoDir,
      tag: 'v2.0.0',
    };

    const resolution = await resolveGitCustom(source, { cacheDir: cacheBaseDir });
    const pkg = resolution.packages.find((p) => p.artifacts[0].name === 'code-reviewer');
    assert.ok(pkg);
    const artifact = pkg.artifacts[0];

    const resolved = (await resolveArtifactContent(
      source,
      pkg,
      artifact,
      { cacheDir: cacheBaseDir }
    )) as ResolvedArtifact<CanonicalAgent>;

    assert.strictEqual(resolved.artifact.id, artifact.id);
    assert.strictEqual(resolved.content.name, 'code-reviewer');
    assert.ok(resolved.content.tools.includes('read'));
  });

  it('resolveArtifactContent resolves CanonicalCommand from git repository', async () => {
    const source: Source = {
      id: 'src-test-cmd',
      type: 'git-custom',
      scope: 'project',
      url: remoteRepoDir,
      tag: 'v2.0.0',
    };

    const resolution = await resolveGitCustom(source, { cacheDir: cacheBaseDir });
    const pkg = resolution.packages.find((p) => p.artifacts[0].name === 'review');
    assert.ok(pkg);
    const artifact = pkg.artifacts[0];

    const resolved = (await resolveArtifactContent(
      source,
      pkg,
      artifact,
      { cacheDir: cacheBaseDir }
    )) as ResolvedArtifact<CanonicalCommand>;

    assert.strictEqual(resolved.artifact.id, artifact.id);
    assert.strictEqual(resolved.content.name, 'review');
    assert.strictEqual(resolved.content.agent, 'code-reviewer');
  });

  it('interleaves resolveGitCustom and resolveArtifactContent proving lock protects checkout plus read', async () => {
    const sourceV1: Source = {
      id: 'src-test-interleave',
      type: 'git-custom',
      scope: 'project',
      url: remoteRepoDir,
      tag: 'v1.0.0',
    };

    const resV1 = await resolveGitCustom(sourceV1, { cacheDir: cacheBaseDir });
    const pkgV1 = resV1.packages[0];
    const artifactV1 = pkgV1.artifacts[0];

    const sourceBranch: Source = {
      id: 'src-test-interleave',
      type: 'git-custom',
      scope: 'project',
      url: remoteRepoDir,
      branch: 'feature-skills',
    };

    const [resolvedContent, branchResolution] = await Promise.all([
      resolveArtifactContent(sourceV1, pkgV1, artifactV1, { cacheDir: cacheBaseDir }),
      resolveGitCustom(sourceBranch, { cacheDir: cacheBaseDir }),
    ]);

    assert.strictEqual(resolvedContent.content.name, 'root-skill');
    assert.strictEqual(branchResolution.packages.length, 7);
  });

  it('proves gitCustomMutex serializes access to target directory', async () => {
    const target = path.join(cacheBaseDir, 'mutex-test');
    const sequence: number[] = [];
    await Promise.all([
      gitCustomMutex.runExclusive(target, async () => {
        sequence.push(1);
        await new Promise((r) => setTimeout(r, 50));
        sequence.push(2);
      }),
      gitCustomMutex.runExclusive(target, async () => {
        sequence.push(3);
        await new Promise((r) => setTimeout(r, 10));
        sequence.push(4);
      }),
    ]);
    assert.deepStrictEqual(sequence, [1, 2, 3, 4]);
  });

  it('throws a clear error for a nonexistent git repository path', async () => {
    const nonexistentSource: Source = {
      id: 'src-test-nonexistent',
      type: 'git-custom',
      scope: 'project',
      url: path.join(tempBase, 'does-not-exist-' + Date.now()),
    };

    await assert.rejects(
      async () => {
        await resolveGitCustom(nonexistentSource, { cacheDir: cacheBaseDir });
      },
      (err: Error) => {
        assert.ok(err.message.includes('Git command failed'));
        return true;
      }
    );
  });

  it('throws a clear error when source.url is missing or empty', async () => {
    const sourceNoUrl: Source = {
      id: 'src-test-no-url',
      type: 'git-custom',
      scope: 'project',
    };

    await assert.rejects(
      async () => {
        await resolveGitCustom(sourceNoUrl, { cacheDir: cacheBaseDir });
      },
      /source\.url is required/
    );
  });
});
