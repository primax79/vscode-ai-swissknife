import * as fs from 'fs';
import * as path from 'path';
import { AsyncLocalStorage } from 'async_hooks';
import type { Scope } from './types';
import { statePath } from './registry';

/**
 * Typed error thrown when acquiring a state lock exceeds the timeout.
 */
export class StateLockTimeoutError extends Error {
  readonly code = 'STATE_LOCK_TIMEOUT';
  readonly lockPath: string;
  readonly timeoutMs: number;

  constructor(lockPath: string, timeoutMs: number, message?: string) {
    super(
      message ??
        `Timed out after ${timeoutMs}ms waiting to acquire state lock at "${lockPath}"`
    );
    this.name = 'StateLockTimeoutError';
    this.lockPath = lockPath;
    this.timeoutMs = timeoutMs;
    Object.setPrototypeOf(this, StateLockTimeoutError.prototype);
  }
}

/** Minimum age before a lock whose holder process is still alive is considered stale (pid reuse after a crash). */
export const ALIVE_HOLDER_STALE_MS = 5 * 60_000;

export interface StateLockOptions {
  /** Maximum time in milliseconds to wait for the lock before timing out. Default: 10000ms. */
  timeoutMs?: number;
  /** Age in milliseconds after which a lock file is considered stale. Default: 30000ms. */
  staleThresholdMs?: number;
  /** Base retry delay in milliseconds between acquisition attempts. Default: 25ms. */
  pollIntervalMs?: number;
}

export interface LockContent {
  pid: number;
  timestamp: number;
}

/**
 * Computes the absolute lock file path for a given scope.
 * Placed in the same directory as manifest.json and state.json.
 */
export function stateLockPath(
  scope: Scope,
  projectRoot?: string,
  homeRoot?: string
): string {
  const dir = path.dirname(statePath(scope, projectRoot, homeRoot));
  return path.resolve(dir, 'state.lock');
}

/** Formats PID and timestamp for writing into the lock file. */
export function formatLockContent(pid: number, timestamp: number): string {
  return `${pid}\n${timestamp}\n`;
}

/**
 * Parses lock file content, supporting both line-based format (pid\ntimestamp)
 * and JSON format ({"pid": ..., "timestamp": ...}) for resilience.
 */
export function parseLockContent(raw: string): LockContent | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    const pid = typeof parsed.pid === 'number' ? parsed.pid : parseInt(parsed.pid, 10);
    const ts =
      typeof parsed.timestamp === 'number'
        ? parsed.timestamp
        : typeof parsed.createdAt === 'number'
        ? parsed.createdAt
        : parseInt(parsed.timestamp || parsed.createdAt, 10);
    if (!isNaN(pid) && pid > 0) {
      return { pid, timestamp: isNaN(ts) ? 0 : ts };
    }
  } catch {
    // Not JSON; fall through to whitespace-separated format
  }

  const tokens = trimmed.split(/\s+/);
  if (tokens.length >= 1) {
    const pid = parseInt(tokens[0], 10);
    const ts = tokens.length >= 2 ? parseInt(tokens[1], 10) : 0;
    if (!isNaN(pid) && pid > 0) {
      return { pid, timestamp: isNaN(ts) ? 0 : ts };
    }
  }

  return null;
}

/**
 * Checks whether a process with the given PID is currently alive on the system.
 */
export function isPidAlive(pid: number): boolean {
  if (typeof pid !== 'number' || isNaN(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') {
      return false;
    }
    if (code === 'EPERM') {
      return true;
    }
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Tracks the set of canonical lock paths currently held by the active
 * async call chain. Used for in-process re-entrancy detection so nested
 * calls from the same process execution context execute immediately without
 * deadlocking.
 */
const heldLocksStorage = new AsyncLocalStorage<Set<string>>();

interface InProcessWaiter {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * In-process lock manager per canonical lock path. Serializes concurrent
 * asynchronous tasks within the current Node process and enforces timeouts.
 */
class InProcessLockManager {
  private activeLocks = new Set<string>();
  private waiters = new Map<string, InProcessWaiter[]>();

  async acquire(canonicalPath: string, timeoutMs: number, startTime: number): Promise<void> {
    if (!this.activeLocks.has(canonicalPath)) {
      this.activeLocks.add(canonicalPath);
      return;
    }

    const elapsed = Date.now() - startTime;
    const remaining = timeoutMs - elapsed;
    if (remaining <= 0) {
      throw new StateLockTimeoutError(canonicalPath, timeoutMs);
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const queue = this.waiters.get(canonicalPath);
        if (queue) {
          const idx = queue.findIndex((w) => w.timer === timer);
          if (idx !== -1) queue.splice(idx, 1);
          if (queue.length === 0) this.waiters.delete(canonicalPath);
        }
        reject(new StateLockTimeoutError(canonicalPath, timeoutMs));
      }, remaining);

      const waiter: InProcessWaiter = { resolve, reject, timer };
      let queue = this.waiters.get(canonicalPath);
      if (!queue) {
        queue = [];
        this.waiters.set(canonicalPath, queue);
      }
      queue.push(waiter);
    });
  }

  release(canonicalPath: string): void {
    const queue = this.waiters.get(canonicalPath);
    if (queue && queue.length > 0) {
      const nextWaiter = queue.shift()!;
      clearTimeout(nextWaiter.timer);
      if (queue.length === 0) {
        this.waiters.delete(canonicalPath);
      }
      // Transfer ownership to next waiter
      nextWaiter.resolve();
    } else {
      this.activeLocks.delete(canonicalPath);
    }
  }
}

const inProcessLockManager = new InProcessLockManager();

/**
 * Inspects an existing lock file on disk and removes it if it is stale
 * (either the recorded PID is dead or its age exceeds staleThresholdMs).
 */
async function tryTakeoverStaleLock(
  lockPath: string,
  staleThresholdMs: number
): Promise<boolean> {
  try {
    const raw = await fs.promises.readFile(lockPath, 'utf-8');
    const parsed = parseLockContent(raw);
    const stat = await fs.promises.stat(lockPath).catch(() => null);

    const timestamp =
      parsed && parsed.timestamp > 0
        ? parsed.timestamp
        : stat
        ? stat.mtimeMs
        : 0;

    const pid = parsed?.pid;
    const hasPid = typeof pid === 'number' && pid > 0;
    const isDeadPid = hasPid && !isPidAlive(pid);
    // A lock held by a LIVE process is only taken over after a much longer age
    // (the pid may have been reused after a crash): taking it at the normal
    // threshold would let a second writer in while a slow holder is still running.
    const ageThresholdMs = hasPid && !isDeadPid ? Math.max(staleThresholdMs, ALIVE_HOLDER_STALE_MS) : staleThresholdMs;
    const isExpired = Date.now() - timestamp > ageThresholdMs;

    if (isDeadPid || isExpired) {
      // Stale lock detected. Re-verify content before unlinking to avoid
      // unlinking a lock that was refreshed by a legitimate holder.
      const currentRaw = await fs.promises.readFile(lockPath, 'utf-8').catch(() => null);
      if (currentRaw === raw) {
        try {
          await fs.promises.unlink(lockPath);
          return true;
        } catch (unlinkErr: unknown) {
          if ((unlinkErr as NodeJS.ErrnoException).code === 'ENOENT') {
            return true;
          }
          throw unlinkErr;
        }
      }
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return true;
    }
  }
  return false;
}

/**
 * Retries acquiring the exclusive cross-process lock file next to manifest/state
 * until timeoutMs elapses.
 */
async function acquireFileLock(
  lockPath: string,
  timeoutMs: number,
  staleThresholdMs: number,
  pollIntervalMs: number,
  startTime: number
): Promise<void> {
  const parentDir = path.dirname(lockPath);
  await fs.promises.mkdir(parentDir, { recursive: true });

  const content = formatLockContent(process.pid, Date.now());
  let attempt = 0;
  let acquired = false;

  while (!acquired) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= timeoutMs) {
      throw new StateLockTimeoutError(lockPath, timeoutMs);
    }

    try {
      await fs.promises.writeFile(lockPath, content, { flag: 'wx' });
      acquired = true;
      return;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        throw err;
      }
    }

    // Lock file already exists. Check for stale lock.
    const tookOver = await tryTakeoverStaleLock(lockPath, staleThresholdMs);
    if (tookOver) {
      continue;
    }

    attempt++;
    const baseDelay = Math.min(pollIntervalMs * Math.pow(1.2, attempt), 150);
    const jitter = Math.random() * 15;
    const delay = Math.floor(baseDelay + jitter);

    const remaining = timeoutMs - (Date.now() - startTime);
    if (remaining <= 0) {
      throw new StateLockTimeoutError(lockPath, timeoutMs);
    }

    await sleep(Math.min(delay, remaining));
  }
}

/**
 * Releases the cross-process lock file if it belongs to the current PID.
 */
async function releaseFileLock(lockPath: string): Promise<void> {
  try {
    const raw = await fs.promises.readFile(lockPath, 'utf-8');
    const parsed = parseLockContent(raw);
    if (parsed && parsed.pid === process.pid) {
      await fs.promises.unlink(lockPath);
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    // Swallow non-ENOENT release errors to avoid clobbering fn's error or result
  }
}

/**
 * Executes `fn` within an exclusive cross-process and in-process lock for the given scope.
 *
 * - Lock file is placed next to manifest.json and state.json with exclusive `wx` creation.
 * - Lock contents contain current PID and creation timestamp.
 * - Retries with backoff and jitter up to `options.timeoutMs` (defaults to 10s).
 * - Stale locks (dead PID or age > `options.staleThresholdMs`, defaults to 30s) are taken over.
 * - Released in `finally` unconditionally.
 * - Re-entrancy behavior: Nested calls within the same asynchronous call chain detect
 *   that the lock is already held and execute immediately without re-acquiring or deadlocking.
 */
export async function withStateLock<T>(
  scope: Scope,
  fn: () => Promise<T>,
  options?: StateLockOptions
): Promise<T>;
export async function withStateLock<T>(
  scope: Scope,
  projectRoot: string | undefined,
  fn: () => Promise<T>,
  options?: StateLockOptions
): Promise<T>;
export async function withStateLock<T>(
  scope: Scope,
  projectRoot: string | undefined,
  homeRoot: string | undefined,
  fn: () => Promise<T>,
  options?: StateLockOptions
): Promise<T>;
export async function withStateLock<T>(
  scope: Scope,
  arg2: string | undefined | (() => Promise<T>),
  arg3?: string | undefined | (() => Promise<T>) | StateLockOptions,
  arg4?: (() => Promise<T>) | StateLockOptions,
  arg5?: StateLockOptions
): Promise<T> {
  let projectRoot: string | undefined;
  let homeRoot: string | undefined;
  let fn: () => Promise<T>;
  let options: StateLockOptions | undefined;

  if (typeof arg2 === 'function') {
    projectRoot = undefined;
    homeRoot = undefined;
    fn = arg2;
    options = arg3 as StateLockOptions | undefined;
  } else if (typeof arg3 === 'function') {
    projectRoot = arg2;
    homeRoot = undefined;
    fn = arg3;
    options = arg4 as StateLockOptions | undefined;
  } else if (typeof arg4 === 'function') {
    projectRoot = arg2;
    homeRoot = arg3 as string | undefined;
    fn = arg4;
    options = arg5;
  } else {
    throw new Error('withStateLock: missing function argument');
  }

  const timeoutMs = options?.timeoutMs ?? 10_000;
  const staleThresholdMs = options?.staleThresholdMs ?? 30_000;
  const pollIntervalMs = options?.pollIntervalMs ?? 25;

  const canonicalPath = stateLockPath(scope, projectRoot, homeRoot);
  const startTime = Date.now();

  // In-process re-entrancy check: if the current async execution chain already
  // holds this lock, execute fn directly without re-acquiring or deadlocking.
  const held = heldLocksStorage.getStore();
  if (held && held.has(canonicalPath)) {
    return await fn();
  }

  // Serialize with other concurrent operations in the same process
  await inProcessLockManager.acquire(canonicalPath, timeoutMs, startTime);
  try {
    // Acquire the exclusive cross-process lock file on disk
    await acquireFileLock(
      canonicalPath,
      timeoutMs,
      staleThresholdMs,
      pollIntervalMs,
      startTime
    );
    try {
      const currentHeld = heldLocksStorage.getStore();
      const nextHeld = new Set(currentHeld ? currentHeld : []);
      nextHeld.add(canonicalPath);
      return await heldLocksStorage.run(nextHeld, () => fn());
    } finally {
      await releaseFileLock(canonicalPath);
    }
  } finally {
    inProcessLockManager.release(canonicalPath);
  }
}
