import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  findWorkspaces,
  scanInventoryAcrossRoots,
  isWorkspace,
  matchesIgnore,
  DEFAULT_IGNORE,
} from './scanRoots';

describe('scanRoots engine (Task 48.1)', () => {
  let tempTree: string;

  beforeEach(async () => {
    tempTree = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'scan-roots-test-'));
  });

  afterEach(async () => {
    // Restore permissions in case chmod 000 was set
    const unreadable = path.join(tempTree, 'unreadable-dir');
    if (fs.existsSync(unreadable)) {
      try {
        fs.chmodSync(unreadable, 0o755);
      } catch {
        // ignore
      }
    }
    await fs.promises.rm(tempTree, { recursive: true, force: true });
  });

  it('matchesIgnore handles single-segment and path segment pair rules', () => {
    assert.strictEqual(matchesIgnore('/path/to/node_modules', 'node_modules'), true);
    assert.strictEqual(matchesIgnore('/path/to/my-repo', 'node_modules'), false);
    assert.strictEqual(
      matchesIgnore('/path/to/.kilo/worktrees', '.kilo/worktrees'),
      true
    );
    assert.strictEqual(
      matchesIgnore('/path/to/other/worktrees', '.kilo/worktrees'),
      false
    );
  });

  it('workspaces at depths 1, 2, 4 found; depth 5 not found unless maxDepth 5', async () => {
    // Depth 1: tempTree/ws-d1/.claude
    const wsD1 = path.join(tempTree, 'ws-d1');
    await fs.promises.mkdir(path.join(wsD1, '.claude'), { recursive: true });

    // Depth 2: tempTree/d1/ws-d2/.kilo
    const wsD2 = path.join(tempTree, 'd1', 'ws-d2');
    await fs.promises.mkdir(path.join(wsD2, '.kilo', 'skills'), { recursive: true });

    // Depth 4: tempTree/l1/l2/l3/ws-d4/.vscode/ai-swissknife
    const wsD4 = path.join(tempTree, 'l1', 'l2', 'l3', 'ws-d4');
    await fs.promises.mkdir(path.join(wsD4, '.vscode', 'ai-swissknife'), {
      recursive: true,
    });

    // Depth 5: tempTree/m1/m2/m3/m4/ws-d5/.ai-swissknife
    const wsD5 = path.join(tempTree, 'm1', 'm2', 'm3', 'm4', 'ws-d5');
    await fs.promises.mkdir(path.join(wsD5, '.ai-swissknife'), { recursive: true });

    // With default maxDepth 4
    const resDefault = await findWorkspaces([tempTree]);
    assert.ok(resDefault.workspaces.includes(wsD1), 'depth 1 should be found');
    assert.ok(resDefault.workspaces.includes(wsD2), 'depth 2 should be found');
    assert.ok(resDefault.workspaces.includes(wsD4), 'depth 4 should be found');
    assert.strictEqual(
      resDefault.workspaces.includes(wsD5),
      false,
      'depth 5 should NOT be found with default maxDepth 4'
    );

    // With maxDepth 5
    const res5 = await findWorkspaces([tempTree], { maxDepth: 5 });
    assert.ok(res5.workspaces.includes(wsD1));
    assert.ok(res5.workspaces.includes(wsD2));
    assert.ok(res5.workspaces.includes(wsD4));
    assert.ok(
      res5.workspaces.includes(wsD5),
      'depth 5 should be found with maxDepth 5'
    );
  });

  it('skips node_modules/x/.claude, .kilo/worktrees/y/.kilo, _attic/z/.claude, old/w/.kilo', async () => {
    // node_modules/x/.claude
    const nodeModulesX = path.join(tempTree, 'node_modules', 'x');
    await fs.promises.mkdir(path.join(nodeModulesX, '.claude'), { recursive: true });

    // .kilo/worktrees/y/.kilo
    const kiloY = path.join(tempTree, '.kilo', 'worktrees', 'y');
    await fs.promises.mkdir(path.join(kiloY, '.kilo', 'skills'), { recursive: true });

    // _attic/z/.claude
    const atticZ = path.join(tempTree, '_attic', 'z');
    await fs.promises.mkdir(path.join(atticZ, '.claude'), { recursive: true });

    // old/w/.kilo
    const oldW = path.join(tempTree, 'old', 'w');
    await fs.promises.mkdir(path.join(oldW, '.kilo', 'skills'), { recursive: true });

    const res = await findWorkspaces([tempTree]);
    assert.strictEqual(res.workspaces.length, 0);
  });

  it('does not follow symlinks to a workspace', async () => {
    const realWs = path.join(tempTree, 'real-ws');
    await fs.promises.mkdir(path.join(realWs, '.claude'), { recursive: true });

    const symlinkWs = path.join(tempTree, 'symlink-ws');
    await fs.promises.symlink(realWs, symlinkWs);

    const res = await findWorkspaces([tempTree]);
    assert.ok(res.workspaces.includes(realWs));
    assert.strictEqual(
      res.workspaces.includes(symlinkWs),
      false,
      'symlink to workspace must not be in workspaces'
    );
  });

  it('lists an unreadable directory (chmod 000) in skipped without failing', async () => {
    const unreadable = path.join(tempTree, 'unreadable-dir');
    await fs.promises.mkdir(unreadable, { mode: 0o000 });

    const res = await findWorkspaces([tempTree]);
    assert.ok(Array.isArray(res.skipped));
    const foundSkipped = res.skipped.find((s) => s.path === unreadable);
    assert.ok(foundSkipped, 'unreadable directory should be recorded in skipped');
    assert.ok(foundSkipped.reason, 'reason should be present');
    assert.strictEqual(res.workspaces.includes(unreadable), false);
  });

  it('--ignore replaces defaults and --extra-ignore adds to defaults', async () => {
    // old/w/.kilo (normally skipped by default)
    const oldW = path.join(tempTree, 'old', 'w');
    await fs.promises.mkdir(path.join(oldW, '.kilo', 'skills'), { recursive: true });

    // custom-ignored/c/.claude
    const customC = path.join(tempTree, 'custom-ignored', 'c');
    await fs.promises.mkdir(path.join(customC, '.claude'), { recursive: true });

    // When ignore replaces defaults: only custom-ignored is skipped, old is not skipped
    const resReplace = await findWorkspaces([tempTree], {
      ignore: ['custom-ignored'],
    });
    assert.ok(
      resReplace.workspaces.includes(oldW),
      'old/w should be found when ignore replaces defaults'
    );
    assert.strictEqual(
      resReplace.workspaces.includes(customC),
      false,
      'custom-ignored should be skipped'
    );

    // When extraIgnore adds to defaults: both old and custom-ignored are skipped
    const resAdd = await findWorkspaces([tempTree], {
      extraIgnore: ['custom-ignored'],
    });
    assert.strictEqual(resAdd.workspaces.includes(oldW), false);
    assert.strictEqual(resAdd.workspaces.includes(customC), false);
  });

  it('regression 48.1b (a): a tree located under a directory literally named .kilo/worktrees/x still finds its workspaces', async () => {
    const treeUnderKilo = path.join(tempTree, '.kilo', 'worktrees', 'x');
    const wsA = path.join(treeUnderKilo, 'projA');
    const wsB = path.join(treeUnderKilo, 'projB');
    await fs.promises.mkdir(path.join(wsA, '.claude', 'skills', 'sa'), { recursive: true });
    await fs.promises.mkdir(path.join(wsB, '.kilo', 'skills', 'sb'), { recursive: true });

    const res = await findWorkspaces([treeUnderKilo]);
    assert.strictEqual(res.workspaces.length, 2);
    assert.ok(res.workspaces.includes(wsA));
    assert.ok(res.workspaces.includes(wsB));
  });

  it('regression 48.1b (b): a tree located under a directory named old or node_modules still finds its workspaces', async () => {
    const treeUnderOld = path.join(tempTree, 'old', 'my-tree');
    const treeUnderNodeModules = path.join(tempTree, 'node_modules', 'my-tree');
    const wsOld = path.join(treeUnderOld, 'proj-old');
    const wsNm = path.join(treeUnderNodeModules, 'proj-nm');
    await fs.promises.mkdir(path.join(wsOld, '.claude'), { recursive: true });
    await fs.promises.mkdir(path.join(wsNm, '.kilo', 'skills'), { recursive: true });

    const resOld = await findWorkspaces([treeUnderOld]);
    assert.strictEqual(resOld.workspaces.length, 1);
    assert.ok(resOld.workspaces.includes(wsOld));

    const resNm = await findWorkspaces([treeUnderNodeModules]);
    assert.strictEqual(resNm.workspaces.length, 1);
    assert.ok(resNm.workspaces.includes(wsNm));
  });

  it('regression 48.1b (d): a root whose own name is in the ignore list is still scanned', async () => {
    const oldRoot = path.join(tempTree, 'old');
    const wsInOld = path.join(oldRoot, 'my-proj');
    await fs.promises.mkdir(path.join(wsInOld, '.claude'), { recursive: true });

    const res = await findWorkspaces([oldRoot]);
    assert.strictEqual(res.workspaces.length, 1);
    assert.ok(res.workspaces.includes(wsInOld));

    const nmRoot = path.join(tempTree, 'node_modules');
    const wsInNm = path.join(nmRoot, 'my-proj-nm');
    await fs.promises.mkdir(path.join(wsInNm, '.claude'), { recursive: true });

    const resNm = await findWorkspaces([nmRoot]);
    assert.strictEqual(resNm.workspaces.length, 1);
    assert.ok(resNm.workspaces.includes(wsInNm));
  });
});
