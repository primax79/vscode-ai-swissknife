import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { scanInstalledInventory, promoteObservedArtifact } from './discovery';
import { readState } from '../domain/registry';

describe('inventory discovery & promotion — scanInstalledInventory & promoteObservedArtifact', () => {
  let testTempDir: string;
  let testHomeDir: string;

  beforeEach(async () => {
    testTempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'disc-test-ws-'));
    testHomeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'disc-test-home-'));
  });

  afterEach(async () => {
    if (testTempDir && fs.existsSync(testTempDir)) {
      await fs.promises.rm(testTempDir, { recursive: true, force: true });
    }
    if (testHomeDir && fs.existsSync(testHomeDir)) {
      await fs.promises.rm(testHomeDir, { recursive: true, force: true });
    }
  });

  it('scans unmanaged skills and promotes them to ManagedInstallation', async () => {
    // Create an unmanaged skill manually inside .kilo/skills/manual-skill
    const manualSkillDir = path.join(testTempDir, '.kilo', 'skills', 'manual-skill');
    await fs.promises.mkdir(manualSkillDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(manualSkillDir, 'SKILL.md'),
      '---\nname: manual-skill\ndescription: Created manually\n---\n# Manual\n',
      'utf-8'
    );

    // Scan
    const inventory = await scanInstalledInventory('project', testTempDir, testHomeDir);
    assert.strictEqual(inventory.managed.length, 0);
    assert.strictEqual(inventory.observed.length, 1);

    const observed = inventory.observed[0];
    assert.strictEqual(observed.name, 'manual-skill');
    assert.strictEqual(observed.kind, 'skill');
    assert.strictEqual(observed.assistant, 'kilo-code');

    // Promote
    const promoted = await promoteObservedArtifact(observed, 'local-source', testHomeDir);
    assert.strictEqual(promoted.name, 'manual-skill');
    assert.ok(promoted.contentHash);

    // Verify in state.json
    const state = await readState('project', testTempDir, testHomeDir);
    assert.strictEqual(state.installations.length, 1);
    assert.strictEqual(state.installations[0].name, 'manual-skill');

    // Subsequent scan shows it as managed, not observed
    const secondScan = await scanInstalledInventory('project', testTempDir, testHomeDir);
    assert.strictEqual(secondScan.managed.length, 1);
    assert.strictEqual(secondScan.observed.length, 0);
  });
});
