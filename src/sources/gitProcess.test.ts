import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runGit } from './gitProcess';

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
});
