import * as child_process from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(child_process.execFile);

/** Hard cap on any single git invocation — a stuck network op (SSH auth hang,
 * dead remote) must fail loudly instead of hanging the resolver forever. */
const GIT_COMMAND_TIMEOUT_MS = 120_000;

/**
 * Runs `git <args>`, safe against the classic silent-hang failure mode: no
 * SSH_AUTH_SOCK (e.g. VS Code launched from the GUI, not a shell) leaves
 * ssh with no agent to ask, so a passphrase-protected key falls back to a
 * prompt with no TTY to answer it — it just hangs forever with no error.
 * BatchMode=yes makes ssh fail fast instead of prompting; ConnectTimeout
 * bounds the handshake phase specifically. GIT_TERMINAL_PROMPT covers the
 * equivalent HTTPS-credential-prompt case. The execFile `timeout` is the
 * backstop for everything else (dead remote, stalled transfer).
 */
export async function runGit(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync('git', args, {
      cwd,
      timeout: GIT_COMMAND_TIMEOUT_MS,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_SSH_COMMAND: `${process.env.GIT_SSH_COMMAND ?? 'ssh'} -o BatchMode=yes -o ConnectTimeout=15`,
      },
    });
  } catch (err: unknown) {
    const error = err as Error & { stdout?: string; stderr?: string; code?: number; killed?: boolean; signal?: string };
    const timedOut = error.killed && error.signal === 'SIGTERM';
    const stderr = timedOut
      ? `: timed out after ${GIT_COMMAND_TIMEOUT_MS / 1000}s (stuck network operation?)`
      : error.stderr
      ? `: ${error.stderr.trim()}`
      : error.message
      ? `: ${error.message}`
      : '';
    throw new Error(`Git command failed [git ${args.join(' ')}]${stderr}`);
  }
}
