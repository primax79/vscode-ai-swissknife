import { describe, it, before, after, mock } from 'node:test';
import * as assert from 'node:assert';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Source, ResolvedArtifact } from '../domain/types';
import type { CanonicalSkill, CanonicalAgent, CanonicalCommand } from '../adapters/types';
import type { SourceResolution } from './types';
import { resolveGitCustom, resolveArtifactContent, gitCustomMutex, gitCustomResolver } from './gitCustom';
import * as gitProcessModule from './gitProcess';

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

  it('resolves branch pin carrying valid packages including a skill with no explicit name', async () => {
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
    // The mixed fixture's "malformed-skill" only omits `name` in frontmatter,
    // which falls back to the directory name — not diagnostic-worthy.
    assert.strictEqual(resolution.diagnostics.length, 0);
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

    assert.strictEqual((resolvedContent.content as CanonicalSkill).name, 'root-skill');
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

  describe('hardening — url, ref, and id validation (44.1)', () => {
    it('rejects malicious or invalid URLs before git runs without calling runGit', async () => {
      const invalidUrls = [
        '--upload-pack=touch /tmp/pwn',
        '-oProxyCommand=calc',
        'ext::sh -c touch /tmp/pwn',
        'https://github.com/org/repo\nfoo',
      ];

      for (const badUrl of invalidUrls) {
        const runGitSpy = mock.method(gitProcessModule, 'runGit');
        try {
          const source: Source = {
            id: 'src-test-bad-url',
            type: 'git-custom',
            scope: 'project',
            url: badUrl,
          };
          await assert.rejects(
            async () => {
              await resolveGitCustom(source, { cacheDir: cacheBaseDir });
            },
            (err: Error) => {
              assert.ok(
                err.message.includes('Invalid source URL') ||
                  err.message.includes('Git repository URL must use HTTPS')
              );
              return true;
            }
          );
          assert.strictEqual(
            runGitSpy.mock.calls.length,
            0,
            `runGit should not have been called for URL "${badUrl}"`
          );
        } finally {
          runGitSpy.mock.restore();
        }
      }
    });

    it('rejects invalid refs (-x, a..b, a b) before git runs without calling runGit', async () => {
      const invalidRefs = ['-x', 'a..b', 'a b'];

      for (const badRef of invalidRefs) {
        // Test branch
        const branchSpy = mock.method(gitProcessModule, 'runGit');
        try {
          const sourceBranch: Source = {
            id: 'src-test-bad-ref-branch',
            type: 'git-custom',
            scope: 'project',
            url: remoteRepoDir,
            branch: badRef,
          };
          await assert.rejects(
            async () => {
              await resolveGitCustom(sourceBranch, { cacheDir: cacheBaseDir });
            },
            (err: Error) => {
              assert.ok(err.message.includes('Git branch ref'));
              return true;
            }
          );
          assert.strictEqual(
            branchSpy.mock.calls.length,
            0,
            `runGit should not be called for bad branch ref "${badRef}"`
          );
        } finally {
          branchSpy.mock.restore();
        }

        // Test tag
        const tagSpy = mock.method(gitProcessModule, 'runGit');
        try {
          const sourceTag: Source = {
            id: 'src-test-bad-ref-tag',
            type: 'git-custom',
            scope: 'project',
            url: remoteRepoDir,
            tag: badRef,
          };
          await assert.rejects(
            async () => {
              await resolveGitCustom(sourceTag, { cacheDir: cacheBaseDir });
            },
            (err: Error) => {
              assert.ok(err.message.includes('Git tag ref'));
              return true;
            }
          );
          assert.strictEqual(
            tagSpy.mock.calls.length,
            0,
            `runGit should not be called for bad tag ref "${badRef}"`
          );
        } finally {
          tagSpy.mock.restore();
        }

        // Test commit
        const commitSpy = mock.method(gitProcessModule, 'runGit');
        try {
          const sourceCommit: Source = {
            id: 'src-test-bad-ref-commit',
            type: 'git-custom',
            scope: 'project',
            url: remoteRepoDir,
            commit: badRef,
          };
          await assert.rejects(
            async () => {
              await resolveGitCustom(sourceCommit, { cacheDir: cacheBaseDir });
            },
            (err: Error) => {
              assert.ok(err.message.includes('Git commit ref'));
              return true;
            }
          );
          assert.strictEqual(
            commitSpy.mock.calls.length,
            0,
            `runGit should not be called for bad commit ref "${badRef}"`
          );
        } finally {
          commitSpy.mock.restore();
        }
      }
    });

    it('rejects ids ".", "..", and empty without removing sentinel cache directory contents', async () => {
      const sentinelDir = path.join(cacheBaseDir, 'sentinel-dir');
      const sentinelFile = path.join(sentinelDir, 'sentinel.txt');
      fs.mkdirSync(sentinelDir, { recursive: true });
      fs.writeFileSync(sentinelFile, 'sentinel content', 'utf-8');

      const badIds = ['.', '..', '', '.hidden'];

      for (const badId of badIds) {
        const source: Source = {
          id: badId,
          type: 'git-custom',
          scope: 'project',
          url: remoteRepoDir,
        };

        await assert.rejects(
          async () => {
            await resolveGitCustom(source, { cacheDir: cacheBaseDir });
          },
          /Invalid source id/
        );

        assert.ok(
          fs.existsSync(sentinelFile),
          `Sentinel file must still exist after rejecting id "${badId}"`
        );
        assert.ok(
          fs.existsSync(sentinelDir),
          `Sentinel dir must still exist after rejecting id "${badId}"`
        );
      }
    });

    it('accepts valid https, ssh, and scp URLs and invokes git clone with -- separator', async () => {
      const validUrls = [
        'https://github.com/org/repo.git',
        'ssh://git@github.com/org/repo.git',
        'git@github.com:org/repo.git',
      ];

      for (const validUrl of validUrls) {
        const runGitSpy = mock.method(gitProcessModule, 'runGit', async (args: string[], _cwd?: string) => {
          if (args[0] === 'clone') {
            const target = args[3];
            if (target) {
              fs.mkdirSync(path.join(target, '.git'), { recursive: true });
            }
            return { stdout: '', stderr: '' };
          }
          if (args[0] === 'rev-parse') {
            return { stdout: '0123456789abcdef0123456789abcdef01234567\n', stderr: '' };
          }
          if (args[0] === 'symbolic-ref' || args[0] === 'branch') {
            return { stdout: 'main\n', stderr: '' };
          }
          return { stdout: '', stderr: '' };
        });

        try {
          const source: Source = {
            id: 'src-valid-url-test',
            type: 'git-custom',
            scope: 'project',
            url: validUrl,
          };
          const tempCache = path.join(cacheBaseDir, 'valid-url-cache-' + Math.random().toString(36).slice(2));
          await resolveGitCustom(source, { cacheDir: tempCache });

          const cloneCall = runGitSpy.mock.calls.find((call) => call.arguments[0]?.[0] === 'clone');
          assert.ok(cloneCall, `clone should have been called for URL "${validUrl}"`);
          assert.deepStrictEqual(
            cloneCall.arguments[0]?.slice(0, 3),
            ['clone', '--', validUrl],
            `clone command must use "--" separator before URL`
          );
        } finally {
          runGitSpy.mock.restore();
        }
      }
    });
  });

  it('exposes gitCustomResolver conforming to SourceResolver', () => {
    assert.strictEqual(gitCustomResolver.type, 'git-custom');
    assert.strictEqual(gitCustomResolver.displayName, 'Git (custom)');
    assert.strictEqual(gitCustomResolver.iconThemeId, 'repo');
    assert.strictEqual(gitCustomResolver.resolve, resolveGitCustom);
    assert.strictEqual(gitCustomResolver.resolveArtifactContent, resolveArtifactContent);
  });
});

