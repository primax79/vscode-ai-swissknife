import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { scanInstalledInventory, promoteObservedArtifact } from './discovery';
import { readState, writeManifest, SCHEMA_VERSION } from '../domain/registry';

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
    const manualSkillDir = path.join(testTempDir, '.kilo', 'skills', 'manual-skill');
    await fs.promises.mkdir(manualSkillDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(manualSkillDir, 'SKILL.md'),
      '---\nname: manual-skill\ndescription: Created manually\n---\n# Manual\n',
      'utf-8'
    );

    const inventory = await scanInstalledInventory('project', testTempDir, testHomeDir);
    assert.strictEqual(inventory.managed.length, 0);
    assert.strictEqual(inventory.observed.length, 1);

    const observed = inventory.observed[0];
    assert.strictEqual(observed.name, 'manual-skill');
    assert.strictEqual(observed.kind, 'skill');
    assert.strictEqual(observed.assistant, 'kilo-code');
    assert.strictEqual(observed.match?.status, 'unmatched');

    const promoted = await promoteObservedArtifact(observed, 'local-source', testHomeDir);
    assert.strictEqual(promoted.name, 'manual-skill');
    assert.ok(promoted.contentHash);

    const state = await readState('project', testTempDir, testHomeDir);
    assert.strictEqual(state.installations.length, 1);
    assert.strictEqual(state.installations[0].name, 'manual-skill');

    const secondScan = await scanInstalledInventory('project', testTempDir, testHomeDir);
    assert.strictEqual(secondScan.managed.length, 1);
    assert.strictEqual(secondScan.observed.length, 0);
  });

  it('identifies unmanaged artifact matching registered source and restores source provenance on promotion', async () => {
    // 1. Create a registered source folder
    const sourceFolder = path.join(testTempDir, 'upstream-repo');
    const sourceSkillDir = path.join(sourceFolder, 'shared-tool');
    await fs.promises.mkdir(sourceSkillDir, { recursive: true });
    const skillContent = '---\nname: shared-tool\ndescription: Shared tool v1\n---\n# Shared Tool\n';
    await fs.promises.writeFile(path.join(sourceSkillDir, 'SKILL.md'), skillContent, 'utf-8');

    // 2. Register source in manifest
    await writeManifest(
      'project',
      {
        schemaVersion: SCHEMA_VERSION,
        sources: [
          {
            id: 'team-toolkit',
            type: 'local-folder',
            scope: 'project',
            localPath: 'upstream-repo',
          },
        ],
        desiredInstallations: [],
      },
      testTempDir,
      testHomeDir
    );

    // 3. Create unmanaged copy on disk with identical content
    const unmanagedSkillDir = path.join(testTempDir, '.claude', 'skills', 'shared-tool');
    await fs.promises.mkdir(unmanagedSkillDir, { recursive: true });
    await fs.promises.writeFile(path.join(unmanagedSkillDir, 'SKILL.md'), skillContent, 'utf-8');

    // 4. Scan inventory
    const inventory = await scanInstalledInventory('project', testTempDir, testHomeDir);
    assert.strictEqual(inventory.observed.length, 1);

    const obs = inventory.observed[0];
    assert.strictEqual(obs.name, 'shared-tool');
    assert.strictEqual(obs.match?.status, 'identical');
    assert.strictEqual(obs.match?.sourceId, 'team-toolkit');

    // 5. Promote and verify provenance is attached
    const promoted = await promoteObservedArtifact(obs, undefined, testHomeDir);
    assert.strictEqual(promoted.sourceId, 'team-toolkit');
    assert.strictEqual(promoted.name, 'shared-tool');

    const state = await readState('project', testTempDir, testHomeDir);
    assert.strictEqual(state.installations.length, 1);
    assert.strictEqual(state.installations[0].sourceId, 'team-toolkit');
  });

  it('identifies unmanaged artifact differing from registered source', async () => {
    // 1. Create a registered source folder
    const sourceFolder = path.join(testTempDir, 'upstream-repo');
    const sourceSkillDir = path.join(sourceFolder, 'shared-tool');
    await fs.promises.mkdir(sourceSkillDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(sourceSkillDir, 'SKILL.md'),
      '---\nname: shared-tool\ndescription: Source v1\n---\n# Source\n',
      'utf-8'
    );

    // 2. Register source in manifest
    await writeManifest(
      'project',
      {
        schemaVersion: SCHEMA_VERSION,
        sources: [
          {
            id: 'team-toolkit',
            type: 'local-folder',
            scope: 'project',
            localPath: 'upstream-repo',
          },
        ],
        desiredInstallations: [],
      },
      testTempDir,
      testHomeDir
    );

    // 3. Create unmanaged copy on disk with modified content
    const unmanagedSkillDir = path.join(testTempDir, '.claude', 'skills', 'shared-tool');
    await fs.promises.mkdir(unmanagedSkillDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(unmanagedSkillDir, 'SKILL.md'),
      '---\nname: shared-tool\ndescription: Modified locally\n---\n# Modified\n',
      'utf-8'
    );

    // 4. Scan inventory
    const inventory = await scanInstalledInventory('project', testTempDir, testHomeDir);
    assert.strictEqual(inventory.observed.length, 1);

    const obs = inventory.observed[0];
    assert.strictEqual(obs.name, 'shared-tool');
    assert.strictEqual(obs.match?.status, 'different');
    assert.strictEqual(obs.match?.sourceId, 'team-toolkit');
  });
});
