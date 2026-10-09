import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { runDescribe } from './definitions';

const execFileAsync = promisify(execFile);
const cliPath = path.resolve(__dirname, '../../dist/cli.js');

function snapshotDirectory(dir: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(dir)) return map;

  function traverse(current: string) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relPath = path.relative(dir, fullPath);
      if (entry.isDirectory()) {
        traverse(fullPath);
      } else if (entry.isFile()) {
        const content = fs.readFileSync(fullPath);
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        map.set(relPath, hash);
      }
    }
  }

  traverse(dir);
  return map;
}

function assertSnapshotsEqual(before: Map<string, string>, after: Map<string, string>) {
  assert.strictEqual(
    after.size,
    before.size,
    `File count changed: before had ${before.size}, after has ${after.size}`
  );
  for (const [file, hash] of before.entries()) {
    assert.strictEqual(
      after.get(file),
      hash,
      `File ${file} changed or missing after read-only command`
    );
  }
}

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const res = await execFileAsync(process.execPath, [cliPath, ...args]);
    return { stdout: res.stdout, stderr: res.stderr, code: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      code: typeof err.code === 'number' ? err.code : 1,
    };
  }
}

describe('CLI multi-root scanning (Task 48.1)', () => {
  let tempHome: string;
  let tempRootA: string;
  let tempRootB: string;

  beforeEach(async () => {
    tempHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cli-roots-home-'));
    tempRootA = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cli-root-a-'));
    tempRootB = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cli-root-b-'));

    // Global skill
    const globalSkillDir = path.join(tempHome, '.claude', 'skills', 'global-skill');
    await fs.promises.mkdir(globalSkillDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(globalSkillDir, 'SKILL.md'),
      '---\nname: global-skill\ndescription: Global skill\n---\nGlobal content\n'
    );

    // Workspace A skill
    const wsASkillDir = path.join(tempRootA, '.claude', 'skills', 'skill-a');
    await fs.promises.mkdir(wsASkillDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(wsASkillDir, 'SKILL.md'),
      '---\nname: skill-a\ndescription: Workspace A skill\n---\nContent A\n'
    );

    // Workspace B skill
    const wsBSkillDir = path.join(tempRootB, '.kilo', 'skills', 'skill-b');
    await fs.promises.mkdir(wsBSkillDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(wsBSkillDir, 'SKILL.md'),
      '---\nname: skill-b\ndescription: Workspace B skill\n---\nContent B\n'
    );
  });

  afterEach(async () => {
    await fs.promises.rm(tempHome, { recursive: true, force: true });
    await fs.promises.rm(tempRootA, { recursive: true, force: true });
    await fs.promises.rm(tempRootB, { recursive: true, force: true });
  });

  it('describe lists the new options on installed, updates, and item', () => {
    const descriptions = runDescribe();

    for (const cmdName of ['installed', 'updates', 'item']) {
      const desc = descriptions.find((d) => d.name === cmdName);
      assert.ok(desc, `Command ${cmdName} should exist in describe`);
      const flagNames = desc.options.map((o) => o.flags);
      assert.ok(flagNames.some((f) => f.includes('--roots')));
      assert.ok(flagNames.some((f) => f.includes('--max-depth')));
      assert.ok(flagNames.some((f) => f.includes('--ignore')));
      assert.ok(flagNames.some((f) => f.includes('--extra-ignore')));
    }
  });

  it('installed --roots a b aggregates two workspaces and Global once with workspace tags and suffixed keys only in multi-workspace case', async () => {
    const beforeA = snapshotDirectory(tempRootA);
    const beforeB = snapshotDirectory(tempRootB);
    const beforeHome = snapshotDirectory(tempHome);

    const res = await runCli([
      '--home',
      tempHome,
      'installed',
      '--roots',
      tempRootA,
      tempRootB,
    ]);

    assert.strictEqual(res.code, 0, `Command failed: ${res.stderr}`);
    const parsed = JSON.parse(res.stdout);

    // With --roots, output has workspaces, skipped, items
    assert.ok(!Array.isArray(parsed), 'Output with --roots must be an object');
    assert.ok(Array.isArray(parsed.workspaces));
    assert.ok(Array.isArray(parsed.skipped));
    assert.ok(Array.isArray(parsed.items));
    assert.strictEqual(parsed.workspaces.length, 2);

    // Global skill appears once with workspace: null and no key suffix
    const globalItems = parsed.items.filter((i: any) => i.name === 'global-skill');
    assert.strictEqual(globalItems.length, 1);
    assert.strictEqual(globalItems[0].workspace, null);
    assert.strictEqual(globalItems[0].key, 'claude-code:global:skill:global-skill');

    // In multi-workspace case, project item keys are suffixed with @<folder>
    const folderA = path.basename(tempRootA);
    const folderB = path.basename(tempRootB);

    const itemA = parsed.items.find((i: any) => i.name === 'skill-a');
    assert.ok(itemA);
    assert.strictEqual(itemA.workspace, path.resolve(tempRootA));
    assert.strictEqual(itemA.key, `claude-code:project:skill:skill-a@${folderA}`);

    const itemB = parsed.items.find((i: any) => i.name === 'skill-b');
    assert.ok(itemB);
    assert.strictEqual(itemB.workspace, path.resolve(tempRootB));
    assert.strictEqual(itemB.key, `kilo-code:project:skill:skill-b@${folderB}`);

    // Read-only guarantee: temp trees are byte-identical
    assertSnapshotsEqual(beforeA, snapshotDirectory(tempRootA));
    assertSnapshotsEqual(beforeB, snapshotDirectory(tempRootB));
    assertSnapshotsEqual(beforeHome, snapshotDirectory(tempHome));
  });

  it('single workspace scan with --roots wsA does NOT suffix keys', async () => {
    const res = await runCli([
      '--home',
      tempHome,
      'installed',
      '--roots',
      tempRootA,
    ]);

    assert.strictEqual(res.code, 0, `Command failed: ${res.stderr}`);
    const parsed = JSON.parse(res.stdout);

    assert.strictEqual(parsed.workspaces.length, 1);
    const itemA = parsed.items.find((i: any) => i.name === 'skill-a');
    assert.ok(itemA);
    assert.strictEqual(itemA.workspace, path.resolve(tempRootA));
    assert.strictEqual(itemA.key, 'claude-code:project:skill:skill-a');
  });

  it('single --workspace usage and output shape are unchanged', async () => {
    const res = await runCli([
      '--home',
      tempHome,
      '--workspace',
      tempRootA,
      'installed',
    ]);

    assert.strictEqual(res.code, 0, `Command failed: ${res.stderr}`);
    const parsed = JSON.parse(res.stdout);

    // Existing output shape: an Array
    assert.ok(Array.isArray(parsed));
    const itemA = parsed.find((i: any) => i.name === 'skill-a');
    assert.ok(itemA);
    assert.strictEqual(itemA.workspace, path.resolve(tempRootA));
    assert.strictEqual(itemA.key, 'claude-code:project:skill:skill-a');

    const globalItem = parsed.find((i: any) => i.name === 'global-skill');
    assert.ok(globalItem);
    assert.strictEqual(globalItem.workspace, null);
  });

  it('item resolves workspace-suffixed key when --roots is used', async () => {
    const folderA = path.basename(tempRootA);
    const suffixedKey = `claude-code:project:skill:skill-a@${folderA}`;

    const res = await runCli([
      '--home',
      tempHome,
      'item',
      suffixedKey,
      '--roots',
      tempRootA,
      tempRootB,
    ]);

    assert.strictEqual(res.code, 0, `Command failed: ${res.stderr}`);
    const parsed = JSON.parse(res.stdout);
    assert.strictEqual(parsed.key, suffixedKey);
    assert.strictEqual(parsed.name, 'skill-a');
    assert.strictEqual(parsed.workspace, path.resolve(tempRootA));
  });
});
