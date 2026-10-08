import { describe, it, before, after, mock } from 'node:test';
import * as assert from 'node:assert';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Source } from '../domain/types';
import { resolveGitSingleItem } from './gitSingleItem';
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

describe('gitSingleItem — hardening (44.1)', () => {
  let tempBase: string;
  let remoteRepoDir: string;
  let cacheBaseDir: string;

  before(async () => {
    tempBase = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'git-single-harden-test-'));
    remoteRepoDir = path.join(tempBase, 'remote-repo');
    cacheBaseDir = path.join(tempBase, 'cache');

    await fs.promises.mkdir(remoteRepoDir, { recursive: true });
    await fs.promises.mkdir(cacheBaseDir, { recursive: true });

    runGitSync(['init', '-b', 'main'], remoteRepoDir);
    runGitSync(['config', 'user.name', 'Tester'], remoteRepoDir);
    runGitSync(['config', 'user.email', 'tester@test.local'], remoteRepoDir);

    await fs.promises.writeFile(
      path.join(remoteRepoDir, 'SKILL.md'),
      '---\nname: single-skill\ndescription: Test single skill\n---\n# Single Skill\n',
      'utf-8'
    );
    runGitSync(['add', '.'], remoteRepoDir);
    runGitSync(['commit', '-m', 'Initial commit'], remoteRepoDir);
  });

  after(async () => {
    if (tempBase && fs.existsSync(tempBase)) {
      await fs.promises.rm(tempBase, { recursive: true, force: true });
    }
  });

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
          id: 'src-single-bad-url',
          type: 'git-single-item',
          scope: 'project',
          url: badUrl,
        };
        await assert.rejects(
          async () => {
            await resolveGitSingleItem(source, { cacheDir: cacheBaseDir });
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
          id: 'src-single-bad-branch',
          type: 'git-single-item',
          scope: 'project',
          url: remoteRepoDir,
          branch: badRef,
        };
        await assert.rejects(
          async () => {
            await resolveGitSingleItem(sourceBranch, { cacheDir: cacheBaseDir });
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
          id: 'src-single-bad-tag',
          type: 'git-single-item',
          scope: 'project',
          url: remoteRepoDir,
          tag: badRef,
        };
        await assert.rejects(
          async () => {
            await resolveGitSingleItem(sourceTag, { cacheDir: cacheBaseDir });
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
          id: 'src-single-bad-commit',
          type: 'git-single-item',
          scope: 'project',
          url: remoteRepoDir,
          commit: badRef,
        };
        await assert.rejects(
          async () => {
            await resolveGitSingleItem(sourceCommit, { cacheDir: cacheBaseDir });
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
    await fs.promises.mkdir(sentinelDir, { recursive: true });
    await fs.promises.writeFile(sentinelFile, 'sentinel content', 'utf-8');

    const badIds = ['.', '..', '', '.hidden'];

    for (const badId of badIds) {
      const source: Source = {
        id: badId,
        type: 'git-single-item',
        scope: 'project',
        url: remoteRepoDir,
      };

      await assert.rejects(
        async () => {
          await resolveGitSingleItem(source, { cacheDir: cacheBaseDir });
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
});
