import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import {
  withStateLock,
  stateLockPath,
  StateLockTimeoutError,
  formatLockContent,
  parseLockContent,
  isPidAlive,
} from './stateLock';
import { manifestPath } from './registry';

describe('stateLock (cross-process & in-process lock)', () => {
  let testTempDir: string;
  let testHomeDir: string;

  beforeEach(async () => {
    testTempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-swissknife-lock-test-ws-'));
    testHomeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-swissknife-lock-test-home-'));
  });

  afterEach(async () => {
    if (testTempDir && fs.existsSync(testTempDir)) {
      await fs.promises.rm(testTempDir, { recursive: true, force: true });
    }
    if (testHomeDir && fs.existsSync(testHomeDir)) {
      await fs.promises.rm(testHomeDir, { recursive: true, force: true });
    }
  });

  describe('lock path resolution', () => {
    it('resolves correct lock paths for project and global scopes next to manifest/state', () => {
      const projLock = stateLockPath('project', testTempDir);
      assert.strictEqual(
        projLock,
        path.resolve(testTempDir, '.vscode', 'ai-swissknife', 'state.lock')
      );

      const globalLock = stateLockPath('global', undefined, testHomeDir);
      assert.strictEqual(
        globalLock,
        path.resolve(testHomeDir, '.ai-swissknife', 'state.lock')
      );
    });

    it('throws when projectRoot is omitted for project scope', () => {
      assert.throws(() => stateLockPath('project'), /projectRoot is required/);
    });
  });

  describe('lock content parsing and pid alive checking', () => {
    it('formats and parses line-separated lock content', () => {
      const content = formatLockContent(12345, 9999999);
      const parsed = parseLockContent(content);
      assert.ok(parsed);
      assert.strictEqual(parsed.pid, 12345);
      assert.strictEqual(parsed.timestamp, 9999999);
    });

    it('parses JSON formatted lock content', () => {
      const content = JSON.stringify({ pid: 54321, timestamp: 8888888 });
      const parsed = parseLockContent(content);
      assert.ok(parsed);
      assert.strictEqual(parsed.pid, 54321);
      assert.strictEqual(parsed.timestamp, 8888888);
    });

    it('isPidAlive correctly reports current process as alive and non-existent pid as dead', () => {
      assert.strictEqual(isPidAlive(process.pid), true);
      // Process with negative or 0 pid is never alive
      assert.strictEqual(isPidAlive(0), false);
      assert.strictEqual(isPidAlive(-1), false);
    });
  });

  describe('(1) in-process concurrency: parallel increments of counter in temp manifest', () => {
    it('demonstrates that unlocked parallel read-modify-write deterministically loses updates', async () => {
      const manifestFile = manifestPath('project', testTempDir);
      await fs.promises.mkdir(path.dirname(manifestFile), { recursive: true });
      await fs.promises.writeFile(
        manifestFile,
        JSON.stringify({ schemaVersion: 1, sources: [], desiredInstallations: [], counter: 0 }),
        'utf-8'
      );

      const N = 10;
      // Without locking: each parallel task reads the file, introduces a small async pause,
      // and writes back. Because all N tasks read counter = 0 concurrently during the pause,
      // all write counter = 1, deterministically losing N - 1 updates.
      await Promise.all(
        Array.from({ length: N }, async () => {
          const raw = JSON.parse(await fs.promises.readFile(manifestFile, 'utf-8'));
          const current = raw.counter ?? 0;
          await new Promise((resolve) => setTimeout(resolve, 15));
          raw.counter = current + 1;
          await fs.promises.writeFile(manifestFile, JSON.stringify(raw), 'utf-8');
        })
      );

      const finalRaw = JSON.parse(await fs.promises.readFile(manifestFile, 'utf-8'));
      // Without locking, the counter is far below N (typically 1)
      assert.ok(
        finalRaw.counter < N,
        `Expected unlocked counter to be less than ${N} due to lost updates, got ${finalRaw.counter}`
      );
    });

    it('N parallel read-modify-write increments with withStateLock end with the exact sum N', async () => {
      const manifestFile = manifestPath('project', testTempDir);
      await fs.promises.mkdir(path.dirname(manifestFile), { recursive: true });
      await fs.promises.writeFile(
        manifestFile,
        JSON.stringify({ schemaVersion: 1, sources: [], desiredInstallations: [], counter: 0 }),
        'utf-8'
      );

      const N = 20;
      await Promise.all(
        Array.from({ length: N }, async () => {
          await withStateLock('project', testTempDir, async () => {
            const raw = JSON.parse(await fs.promises.readFile(manifestFile, 'utf-8'));
            const current = raw.counter ?? 0;
            // Introduce jitter to stress test concurrency
            await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 5)));
            raw.counter = current + 1;
            await fs.promises.writeFile(manifestFile, JSON.stringify(raw), 'utf-8');
          });
        })
      );

      const finalRaw = JSON.parse(await fs.promises.readFile(manifestFile, 'utf-8'));
      assert.strictEqual(
        finalRaw.counter,
        N,
        `Expected locked counter to be exactly ${N}, got ${finalRaw.counter}`
      );

      // Verify lock file was cleanly released
      assert.strictEqual(fs.existsSync(stateLockPath('project', testTempDir)), false);
    });
  });

  describe('(2) cross-process concurrency: two spawned node child processes hammering temp manifest', () => {
    it('two spawned child processes hammering the same temp manifest end with the exact total', async () => {
      const manifestFile = manifestPath('project', testTempDir);
      await fs.promises.mkdir(path.dirname(manifestFile), { recursive: true });
      await fs.promises.writeFile(
        manifestFile,
        JSON.stringify({ schemaVersion: 1, sources: [], desiredInstallations: [], counter: 0 }),
        'utf-8'
      );

      const stateLockModulePath = path.resolve(__dirname, 'stateLock');
      const incrementsPerWorker = 20;
      const expectedTotal = incrementsPerWorker * 2;

      function spawnWorker(_workerId: string): Promise<{ code: number; stdout: string; stderr: string }> {
        return new Promise((resolve) => {
          const script = `
            const fs = require('fs');
            const path = require('path');
            const { withStateLock } = require(${JSON.stringify(stateLockModulePath)});

            async function run() {
              const projectRoot = ${JSON.stringify(testTempDir)};
              const manifestPath = path.join(projectRoot, '.vscode', 'ai-swissknife', 'manifest.json');
              const count = ${incrementsPerWorker};

              for (let i = 0; i < count; i++) {
                await withStateLock('project', projectRoot, async () => {
                  const raw = JSON.parse(await fs.promises.readFile(manifestPath, 'utf-8'));
                  const current = raw.counter || 0;
                  // Small async delay while holding the lock
                  await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 4) + 1));
                  raw.counter = current + 1;
                  await fs.promises.writeFile(manifestPath, JSON.stringify(raw), 'utf-8');
                });
              }
            }

            run().then(() => process.exit(0)).catch((err) => {
              console.error(err);
              process.exit(1);
            });
          `;

          const child = spawn(process.execPath, ['-e', script], {
            stdio: ['pipe', 'pipe', 'pipe'],
          });

          let stdout = '';
          let stderr = '';
          child.stdout.on('data', (d) => { stdout += d.toString(); });
          child.stderr.on('data', (d) => { stderr += d.toString(); });
          child.on('close', (code) => {
            resolve({ code: code ?? -1, stdout, stderr });
          });
        });
      }

      // Spawn both workers concurrently
      const [worker1, worker2] = await Promise.all([
        spawnWorker('worker-1'),
        spawnWorker('worker-2'),
      ]);

      assert.strictEqual(worker1.code, 0, `Worker 1 failed: ${worker1.stderr}`);
      assert.strictEqual(worker2.code, 0, `Worker 2 failed: ${worker2.stderr}`);

      const finalRaw = JSON.parse(await fs.promises.readFile(manifestFile, 'utf-8'));
      assert.strictEqual(
        finalRaw.counter,
        expectedTotal,
        `Expected cross-process total to be ${expectedTotal}, got ${finalRaw.counter}`
      );

      // Verify lock file was cleanly released on disk
      assert.strictEqual(fs.existsSync(stateLockPath('project', testTempDir)), false);
    });
  });

  describe('(3) stale-lock takeover: dead pid', () => {
    it('takes over a stale lock whose recorded pid is dead', async () => {
      const lockPath = stateLockPath('project', testTempDir);
      await fs.promises.mkdir(path.dirname(lockPath), { recursive: true });

      // Spawn a process that immediately terminates to obtain a guaranteed dead PID
      const tempProc = spawn(process.execPath, ['-e', 'process.exit(0)']);
      await new Promise((resolve) => tempProc.on('exit', resolve));
      const deadPid = tempProc.pid!;
      assert.strictEqual(isPidAlive(deadPid), false, 'Expected spawned temp pid to be dead');

      // Write stale lock file with recent timestamp but dead PID
      await fs.promises.writeFile(lockPath, formatLockContent(deadPid, Date.now()), 'utf-8');
      assert.strictEqual(fs.existsSync(lockPath), true);

      // withStateLock should recognize the dead PID, take over the lock, and execute
      let executed = false;
      const result = await withStateLock('project', testTempDir, async () => {
        executed = true;
        return 'takeover-success';
      });

      assert.strictEqual(executed, true);
      assert.strictEqual(result, 'takeover-success');
      // Lock file must be released after completion
      assert.strictEqual(fs.existsSync(lockPath), false);
    });

    it('takes over a stale lock whose age exceeds staleThresholdMs even if pid is alive', async () => {
      const lockPath = stateLockPath('project', testTempDir);
      await fs.promises.mkdir(path.dirname(lockPath), { recursive: true });

      // Write lock file with current process PID, but created 100 seconds ago
      const expiredTimestamp = Date.now() - 100_000;
      await fs.promises.writeFile(lockPath, formatLockContent(process.pid, expiredTimestamp), 'utf-8');

      let executed = false;
      const result = await withStateLock(
        'project',
        testTempDir,
        async () => {
          executed = true;
          return 'expired-takeover-success';
        },
        { staleThresholdMs: 500 }
      );

      assert.strictEqual(executed, true);
      assert.strictEqual(result, 'expired-takeover-success');
      assert.strictEqual(fs.existsSync(lockPath), false);
    });
  });

  describe('(4) exception handling: lock release in finally', () => {
    it('releases the lock file when fn throws an exception', async () => {
      const lockPath = stateLockPath('project', testTempDir);

      await assert.rejects(
        withStateLock('project', testTempDir, async () => {
          assert.strictEqual(fs.existsSync(lockPath), true, 'Lock file should exist while fn runs');
          throw new Error('boom in locked operation');
        }),
        /boom in locked operation/
      );

      // Lock file must be unlinked in finally
      assert.strictEqual(fs.existsSync(lockPath), false, 'Lock file must be unlinked after throw');

      // A subsequent lock acquisition must succeed immediately
      const subsequentResult = await withStateLock('project', testTempDir, async () => {
        return 'subsequent-ok';
      });
      assert.strictEqual(subsequentResult, 'subsequent-ok');
    });
  });

  describe('(5) timeout behavior: typed StateLockTimeoutError', () => {
    it('raises typed StateLockTimeoutError when lock cannot be acquired within timeout', async () => {
      const lockPath = stateLockPath('project', testTempDir);
      await fs.promises.mkdir(path.dirname(lockPath), { recursive: true });

      // Spawn a child process that holds the lock file and keeps running
      const holderScript = `
        const fs = require('fs');
        const lockPath = ${JSON.stringify(lockPath)};
        fs.writeFileSync(lockPath, process.pid + '\\n' + Date.now() + '\\n');
        // Keep alive until signaled
        setInterval(() => {}, 1000);
      `;
      const holder = spawn(process.execPath, ['-e', holderScript], {
        stdio: 'inherit',
      });

      // Wait until the child creates the lock file
      for (let i = 0; i < 50; i++) {
        if (fs.existsSync(lockPath)) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.strictEqual(fs.existsSync(lockPath), true);

      try {
        await assert.rejects(
          withStateLock('project', testTempDir, async () => {}, { timeoutMs: 150, pollIntervalMs: 20 }),
          (err: unknown) => {
            assert.ok(err instanceof StateLockTimeoutError, 'Expected StateLockTimeoutError');
            assert.strictEqual((err as StateLockTimeoutError).code, 'STATE_LOCK_TIMEOUT');
            assert.strictEqual((err as StateLockTimeoutError).lockPath, lockPath);
            assert.strictEqual((err as StateLockTimeoutError).timeoutMs, 150);
            return true;
          }
        );
      } finally {
        holder.kill('SIGKILL');
        await new Promise((r) => holder.on('close', r));
        try {
          await fs.promises.unlink(lockPath);
        } catch (_err) {
          // ignore
        }
      }
    });

    it('raises typed StateLockTimeoutError when in-process wait exceeds timeout', async () => {
      const lockPath = stateLockPath('project', testTempDir);

      let releaseHolder!: () => void;
      const holderBlocker = new Promise<void>((resolve) => {
        releaseHolder = resolve;
      });

      // Start an in-process holder that stays locked
      const holderPromise = withStateLock('project', testTempDir, async () => {
        await holderBlocker;
      });

      // Wait a tick for holder to acquire
      await new Promise((r) => setTimeout(r, 30));

      try {
        // Sibling call in same process with short timeout must timeout in in-process queue
        await assert.rejects(
          withStateLock('project', testTempDir, async () => {}, { timeoutMs: 60 }),
          (err: unknown) => {
            assert.ok(err instanceof StateLockTimeoutError);
            assert.strictEqual((err as StateLockTimeoutError).code, 'STATE_LOCK_TIMEOUT');
            assert.strictEqual((err as StateLockTimeoutError).lockPath, lockPath);
            assert.strictEqual((err as StateLockTimeoutError).timeoutMs, 60);
            return true;
          }
        );
      } finally {
        releaseHolder();
        await holderPromise;
      }
    });
  });

  describe('in-process re-entrancy guard', () => {
    it('allows nested calls within the same async call chain without deadlocking', async () => {
      let outerStarted = false;
      let innerStarted = false;
      let innerFinished = false;
      let outerFinished = false;

      const result = await withStateLock('project', testTempDir, async () => {
        outerStarted = true;

        // Nested call on same scope and projectRoot
        const innerResult = await withStateLock('project', testTempDir, async () => {
          innerStarted = true;
          innerFinished = true;
          return 'nested-value';
        });

        outerFinished = true;
        return `outer-got-${innerResult}`;
      });

      assert.strictEqual(outerStarted, true);
      assert.strictEqual(innerStarted, true);
      assert.strictEqual(innerFinished, true);
      assert.strictEqual(outerFinished, true);
      assert.strictEqual(result, 'outer-got-nested-value');

      // Lock file released
      assert.strictEqual(fs.existsSync(stateLockPath('project', testTempDir)), false);
    });
  });

  describe('global scope locking', () => {
    it('locks and releases global scope state.lock under homeRoot', async () => {
      const globalLock = stateLockPath('global', undefined, testHomeDir);
      assert.strictEqual(fs.existsSync(globalLock), false);

      let ran = false;
      const res = await withStateLock('global', undefined, testHomeDir, async () => {
        ran = true;
        assert.strictEqual(fs.existsSync(globalLock), true);
        return 42;
      });

      assert.strictEqual(ran, true);
      assert.strictEqual(res, 42);
      assert.strictEqual(fs.existsSync(globalLock), false);
    });
  });
});
