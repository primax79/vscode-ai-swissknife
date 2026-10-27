import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  runGit,
  DEFAULT_GIT_ALLOW_PROTOCOL,
  validateGitUrl,
  validateGitRef,
  resolveAndValidateCacheDir,
} from './gitProcess';

function runGitSync(args: string[], cwd: string): string {
  return child_process
    .execFileSync('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
    .toString('utf-8');
}

describe('runGit', () => {
  let repoDir: string;

  before(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-swissknife-gitprocess-'));
    runGitSync(['init', '-b', 'main'], repoDir);
    runGitSync(['config', 'user.name', 'Tester'], repoDir);
    runGitSync(['config', 'user.email', 'test@example.com'], repoDir);
    fs.writeFileSync(path.join(repoDir, 'file.txt'), 'content');
    runGitSync(['add', '.'], repoDir);
    runGitSync(['commit', '-m', 'initial'], repoDir);
  });

  after(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('resolves with stdout for a successful command', async () => {
    const { stdout } = await runGit(['rev-parse', 'HEAD'], repoDir);
    assert.ok(/^[0-9a-f]{40}$/.test(stdout.trim()));
  });

  it('throws a descriptive error for a failing command, unaffected by the SSH/timeout hardening', async () => {
    await assert.rejects(
      () => runGit(['checkout', 'does-not-exist'], repoDir),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('Git command failed'));
        assert.ok(err.message.includes('checkout'));
        return true;
      }
    );
  });

  it('does not require SSH to be reachable for a purely local operation', async () => {
    // Regression guard for the SSH-hang fix: GIT_SSH_COMMAND is always set,
    // but a local-only command must never touch the network at all.
    const { stdout } = await runGit(['log', '-1', '--format=%H'], repoDir);
    assert.ok(stdout.trim().length > 0);
  });

  it('sets GIT_ALLOW_PROTOCOL to file:git:http:https:ssh on spawned process', async () => {
    assert.strictEqual(DEFAULT_GIT_ALLOW_PROTOCOL, 'file:git:http:https:ssh');
    // Verify disallowed protocols like ext:: are rejected by git
    await assert.rejects(
      () => runGit(['clone', '--', 'ext::sh -c true', path.join(repoDir, 'sub-ext')], repoDir),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes("transport 'ext' not allowed") ||
            err.message.includes('Git command failed')
        );
        return true;
      }
    );
  });
});

describe('validateGitUrl', () => {
  it('rejects empty or whitespace-only url', () => {
    assert.throws(() => validateGitUrl('git-custom', ''), /source\.url is required/);
    assert.throws(() => validateGitUrl('git-custom', '   '), /source\.url is required/);
    assert.throws(() => validateGitUrl('git-custom', undefined), /source\.url is required/);
  });

  it('rejects url starting with "-"', () => {
    assert.throws(() => validateGitUrl('git-custom', '--upload-pack=touch /tmp/pwn'), /must not start with "-"/);
    assert.throws(() => validateGitUrl('git-custom', '-oProxyCommand=calc'), /must not start with "-"/);
  });

  it('rejects url containing newlines or control characters', () => {
    assert.throws(() => validateGitUrl('git-custom', 'https://github.com/org/repo\nfoo'), /must not contain newlines/);
    assert.throws(() => validateGitUrl('git-custom', 'https://github.com/org/repo\rfoo'), /must not contain newlines/);
    assert.throws(() => validateGitUrl('git-custom', 'https://github.com/org/repo\0foo'), /must not contain newlines/);
  });

  it('rejects url with disallowed protocols', () => {
    assert.throws(() => validateGitUrl('git-custom', 'ext::sh -c calc'), /Git repository URL must use HTTPS/);
    assert.throws(() => validateGitUrl('git-custom', 'ftp://github.com/org/repo.git'), /Git repository URL must use HTTPS/);
  });

  it('accepts valid HTTPS, SSH, and SCP URLs', () => {
    assert.doesNotThrow(() => validateGitUrl('git-custom', 'https://github.com/org/repo.git'));
    assert.doesNotThrow(() => validateGitUrl('git-custom', 'ssh://git@github.com/org/repo.git'));
    assert.doesNotThrow(() => validateGitUrl('git-custom', 'git@github.com:org/repo.git'));
  });

  it('accepts safe absolute local filesystem paths for tests/local cloning', () => {
    assert.doesNotThrow(() => validateGitUrl('git-custom', '/var/folders/temp-repo'));
  });
});

describe('validateGitRef', () => {
  it('rejects empty refs', () => {
    assert.throws(() => validateGitRef('branch', ''), /cannot be empty/);
    assert.throws(() => validateGitRef('tag', '   '), /cannot be empty/);
    assert.throws(() => validateGitRef('commit', ''), /cannot be empty/);
  });

  it('rejects refs starting with "-"', () => {
    assert.throws(() => validateGitRef('branch', '-x'), /must not start with "-"/);
    assert.throws(() => validateGitRef('tag', '--tag-opt'), /must not start with "-"/);
    assert.throws(() => validateGitRef('commit', '-abc1234'), /must not start with "-"/);
  });

  it('rejects refs containing whitespace or control characters', () => {
    assert.throws(() => validateGitRef('branch', 'a b'), /must not contain whitespace/);
    assert.throws(() => validateGitRef('tag', 'v1 0'), /must not contain whitespace/);
    assert.throws(() => validateGitRef('branch', 'a\nb'), /must not contain whitespace/);
  });

  it('rejects refs containing ".."', () => {
    assert.throws(() => validateGitRef('branch', 'a..b'), /must not contain "\.\."/);
    assert.throws(() => validateGitRef('tag', 'v1..v2'), /must not contain "\.\."/);
    assert.throws(() => validateGitRef('commit', '..'), /must not contain "\.\."/);
  });

  it('validates commit hash format (7 to 40 hex chars)', () => {
    assert.throws(() => validateGitRef('commit', 'abc123'), /must be a 7-40 character hexadecimal hash/);
    assert.throws(() => validateGitRef('commit', 'not-a-hash'), /must be a 7-40 character hexadecimal hash/);
    assert.throws(() => validateGitRef('commit', '0123456789abcdef0123456789abcdef0123456789a'), /must be a 7-40 character hexadecimal hash/);

    assert.doesNotThrow(() => validateGitRef('commit', '0123456'));
    assert.doesNotThrow(() => validateGitRef('commit', '0123456789abcdef0123456789abcdef01234567'));
    assert.doesNotThrow(() => validateGitRef('commit', 'ABCDEF01234567'));
  });

  it('accepts valid branch and tag names', () => {
    assert.doesNotThrow(() => validateGitRef('branch', 'main'));
    assert.doesNotThrow(() => validateGitRef('branch', 'feature/new-ui'));
    assert.doesNotThrow(() => validateGitRef('tag', 'v1.0.0'));
  });
});

describe('resolveAndValidateCacheDir', () => {
  const tempBase = path.join(os.tmpdir(), 'cache-test-base');

  it('rejects empty, ".", "..", and leading dot ids', () => {
    assert.throws(() => resolveAndValidateCacheDir(tempBase, ''), /empty or starts with "\."/);
    assert.throws(() => resolveAndValidateCacheDir(tempBase, '.'), /empty or starts with "\."/);
    assert.throws(() => resolveAndValidateCacheDir(tempBase, '..'), /empty or starts with "\."/);
    assert.throws(() => resolveAndValidateCacheDir(tempBase, '.hidden'), /empty or starts with "\."/);
  });

  it('asserts targetDir is contained within baseCacheDir', () => {
    const { targetDir, sanitizedId } = resolveAndValidateCacheDir(tempBase, 'valid-source-id');
    assert.strictEqual(sanitizedId, 'valid-source-id');
    assert.strictEqual(targetDir, path.join(tempBase, 'valid-source-id'));
    assert.ok(path.resolve(targetDir).startsWith(path.resolve(tempBase) + path.sep));
  });

  it('keys cache directory by <sanitized id>-<short hash of location> when location is given', () => {
    const res1 = resolveAndValidateCacheDir(tempBase, 'same-id', 'https://github.com/org/repo-one.git');
    const res2 = resolveAndValidateCacheDir(tempBase, 'same-id', 'https://github.com/org/repo-two.git');

    assert.strictEqual(res1.sanitizedId, 'same-id');
    assert.strictEqual(res2.sanitizedId, 'same-id');
    assert.notStrictEqual(res1.targetDir, res2.targetDir);
    assert.match(path.basename(res1.targetDir), /^same-id-[0-9a-f]{8}$/);
    assert.match(path.basename(res2.targetDir), /^same-id-[0-9a-f]{8}$/);
  });

  it('reuses legacy cache directory (<sanitized id>) when its origin remote URL matches location, and uses new hashed dir when it does not', () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-legacy-reuse-'));
    try {
      const legacyCloneDir = path.join(cacheDir, 'shared-src');
      fs.mkdirSync(legacyCloneDir, { recursive: true });
      runGitSync(['init', '-b', 'main'], legacyCloneDir);
      runGitSync(['remote', 'add', 'origin', '/local/remotes/repo-a'], legacyCloneDir);

      // Matching location -> reuses legacyCloneDir
      const matching = resolveAndValidateCacheDir(cacheDir, 'shared-src', '/local/remotes/repo-a');
      assert.strictEqual(matching.targetDir, legacyCloneDir);

      // Different location -> does NOT reuse legacyCloneDir, returns hashed path
      const different = resolveAndValidateCacheDir(cacheDir, 'shared-src', '/local/remotes/repo-b');
      assert.notStrictEqual(different.targetDir, legacyCloneDir);
      assert.match(path.basename(different.targetDir), /^shared-src-[0-9a-f]{8}$/);
    } finally {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});
