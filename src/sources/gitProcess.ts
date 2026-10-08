import * as child_process from 'child_process';
import * as path from 'path';
import { promisify } from 'util';
import type { SourceType } from '../domain/types';
import { validateLocation } from './sourceDefaults';

const execFileAsync = promisify(child_process.execFile);

/** Hard cap on any single git invocation — a stuck network op (SSH auth hang,
 * dead remote) must fail loudly instead of hanging the resolver forever. */
const GIT_COMMAND_TIMEOUT_MS = 120_000;

/** Allowed protocols for git process invocation. */
export const DEFAULT_GIT_ALLOW_PROTOCOL = 'file:git:http:https:ssh';

function hasControlCharacters(val: string): boolean {
  for (let i = 0; i < val.length; i++) {
    const code = val.charCodeAt(i);
    if ((code >= 0 && code <= 31) || code === 127) {
      return true;
    }
  }
  return false;
}

/**
 * Validates a repository location URL before running any git command.
 * Reuses `validateLocation` from sourceDefaults, and rejects any URL
 * with leading dashes, newlines, or control characters.
 */
export function validateGitUrl(type: SourceType, url: string | undefined, sourceId?: string): void {
  if (!url || url.trim() === '') {
    const idMsg = sourceId ? ` for ${type} source "${sourceId}"` : ` for ${type} source`;
    throw new Error(`source.url is required${idMsg}`);
  }
  const trimmed = url.trim();
  if (trimmed.startsWith('-')) {
    throw new Error(`Invalid source URL "${url}": must not start with "-"`);
  }
  if (hasControlCharacters(trimmed)) {
    throw new Error(`Invalid source URL "${url}": must not contain newlines or control characters`);
  }
  const locationError = validateLocation(type, trimmed);
  if (locationError) {
    // If validateLocation failed (requires HTTPS/SSH for wizard),
    // allow safe absolute local filesystem paths used for test fixtures / local cloning.
    const isSafeLocalPath =
      path.isAbsolute(trimmed) &&
      !trimmed.startsWith('-') &&
      !hasControlCharacters(trimmed);
    if (!isSafeLocalPath) {
      throw new Error(`Invalid source URL "${url}": ${locationError}`);
    }
  }
}

/**
 * Validates git ref revisions (branch, tag, commit).
 * Non-empty, no leading '-', no whitespace, no control characters, no '..'.
 * Commit must additionally be a 7-40 hex string.
 */
export function validateGitRef(name: 'branch' | 'tag' | 'commit', value: string): void {
  if (!value || value.trim().length === 0) {
    throw new Error(`Git ${name} ref cannot be empty`);
  }
  if (value.startsWith('-')) {
    throw new Error(`Git ${name} ref "${value}" must not start with "-"`);
  }
  if (/\s/.test(value)) {
    throw new Error(`Git ${name} ref "${value}" must not contain whitespace`);
  }
  if (hasControlCharacters(value)) {
    throw new Error(`Git ${name} ref "${value}" must not contain control characters`);
  }
  if (value.includes('..')) {
    throw new Error(`Git ${name} ref "${value}" must not contain ".."`);
  }
  if (name === 'commit' && !/^[0-9a-f]{7,40}$/i.test(value)) {
    throw new Error(`Git commit ref "${value}" must be a 7-40 character hexadecimal hash`);
  }
}

/**
 * Validates and resolves cache directory target path for a source id.
 * Rejects empty, '.', '..', or ids with leading dots.
 * Asserts that resolved target directory is strictly contained within base cache directory.
 */
export function resolveAndValidateCacheDir(
  baseCacheDir: string,
  sourceId: string
): { targetDir: string; sanitizedId: string } {
  const sanitizedId = (sourceId ?? '').replace(/[^a-zA-Z0-9._-]/g, '_');
  if (
    sanitizedId === '' ||
    sanitizedId === '.' ||
    sanitizedId === '..' ||
    sanitizedId.startsWith('.')
  ) {
    throw new Error(
      `Invalid source id "${sourceId}": sanitized cache directory id "${sanitizedId}" is empty or starts with "."`
    );
  }

  const targetDir = path.join(baseCacheDir, sanitizedId);
  const resolvedTarget = path.resolve(targetDir);
  const resolvedBase = path.resolve(baseCacheDir);

  if (!resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw new Error(
      `Cache target directory "${resolvedTarget}" is not contained within base cache directory "${resolvedBase}"`
    );
  }

  return { targetDir, sanitizedId };
}

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
        GIT_ALLOW_PROTOCOL: DEFAULT_GIT_ALLOW_PROTOCOL,
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
