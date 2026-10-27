import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { scanInstalledInventory, promoteObservedArtifact } from './discovery';
import { readState, writeState, writeManifest, SCHEMA_VERSION } from '../domain/registry';
import type { ObservedArtifact } from '../domain/types';

describe('inventory discovery & promotion — scanInstalledInventory & promoteObservedArtifact', () => {
  let testTempDir: string;
  let testHomeDir: string;
  let origGitConfigGlobal: string | undefined;
  let origGitConfigNoSystem: string | undefined;

  beforeEach(async () => {
    testTempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'disc-test-ws-'));
    testHomeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'disc-test-home-'));
    origGitConfigGlobal = process.env.GIT_CONFIG_GLOBAL;
    origGitConfigNoSystem = process.env.GIT_CONFIG_NOSYSTEM;
    process.env.GIT_CONFIG_GLOBAL = path.join(testHomeDir, '.gitconfig');
    process.env.GIT_CONFIG_NOSYSTEM = '1';
  });

  afterEach(async () => {
    if (origGitConfigGlobal === undefined) {
      delete process.env.GIT_CONFIG_GLOBAL;
    } else {
      process.env.GIT_CONFIG_GLOBAL = origGitConfigGlobal;
    }
    if (origGitConfigNoSystem === undefined) {
      delete process.env.GIT_CONFIG_NOSYSTEM;
    } else {
      process.env.GIT_CONFIG_NOSYSTEM = origGitConfigNoSystem;
    }
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

    const promoted = await promoteObservedArtifact(observed, { sourceId: 'local-source' }, testHomeDir);
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
    const promoted = await promoteObservedArtifact(obs, obs.candidates![0], testHomeDir);
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
    assert.strictEqual(obs.candidates?.length, 1);
    assert.strictEqual(obs.candidates?.[0].status, 'different');
  });

  it('collects multiple identical candidates and does not break on first hit', async () => {
    const source1Folder = path.join(testTempDir, 'upstream-repo-1');
    await fs.promises.mkdir(path.join(source1Folder, 'shared-tool'), { recursive: true });
    await fs.promises.writeFile(
      path.join(source1Folder, 'shared-tool', 'SKILL.md'),
      '---\nname: shared-tool\ndescription: Shared tool\n---\n# Identical\n',
      'utf-8'
    );

    const source2Folder = path.join(testTempDir, 'upstream-repo-2');
    await fs.promises.mkdir(path.join(source2Folder, 'shared-tool'), { recursive: true });
    await fs.promises.writeFile(
      path.join(source2Folder, 'shared-tool', 'SKILL.md'),
      '---\nname: shared-tool\ndescription: Shared tool\n---\n# Identical\n',
      'utf-8'
    );

    await writeManifest(
      'project',
      {
        schemaVersion: SCHEMA_VERSION,
        sources: [
          { id: 'source-1', type: 'local-folder', scope: 'project', localPath: 'upstream-repo-1' },
          { id: 'source-2', type: 'local-folder', scope: 'project', localPath: 'upstream-repo-2' },
        ],
        desiredInstallations: [],
      },
      testTempDir,
      testHomeDir
    );

    const unmanagedSkillDir = path.join(testTempDir, '.claude', 'skills', 'shared-tool');
    await fs.promises.mkdir(unmanagedSkillDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(unmanagedSkillDir, 'SKILL.md'),
      '---\nname: shared-tool\ndescription: Shared tool\n---\n# Identical\n',
      'utf-8'
    );

    const inventory = await scanInstalledInventory('project', testTempDir, testHomeDir);
    assert.strictEqual(inventory.observed.length, 1);
    const obs = inventory.observed[0];

    assert.strictEqual(obs.candidates?.length, 2);
    assert.strictEqual(obs.candidates?.[0].sourceId, 'source-1');
    assert.strictEqual(obs.candidates?.[0].status, 'identical');
    assert.strictEqual(obs.candidates?.[1].sourceId, 'source-2');
    assert.strictEqual(obs.candidates?.[1].status, 'identical');

    // re-derived match is the first identical
    assert.strictEqual(obs.match?.sourceId, 'source-1');
    assert.strictEqual(obs.match?.status, 'identical');
  });

  it('collects multiple different candidates and assigns match correctly', async () => {
    const source1Folder = path.join(testTempDir, 'upstream-repo-1');
    await fs.promises.mkdir(path.join(source1Folder, 'shared-tool'), { recursive: true });
    await fs.promises.writeFile(
      path.join(source1Folder, 'shared-tool', 'SKILL.md'),
      '---\nname: shared-tool\ndescription: Shared tool 1\n---\n# Different 1\n',
      'utf-8'
    );

    const source2Folder = path.join(testTempDir, 'upstream-repo-2');
    await fs.promises.mkdir(path.join(source2Folder, 'shared-tool'), { recursive: true });
    await fs.promises.writeFile(
      path.join(source2Folder, 'shared-tool', 'SKILL.md'),
      '---\nname: shared-tool\ndescription: Shared tool 2\n---\n# Different 2\n',
      'utf-8'
    );

    await writeManifest(
      'project',
      {
        schemaVersion: SCHEMA_VERSION,
        sources: [
          { id: 'source-1', type: 'local-folder', scope: 'project', localPath: 'upstream-repo-1' },
          { id: 'source-2', type: 'local-folder', scope: 'project', localPath: 'upstream-repo-2' },
        ],
        desiredInstallations: [],
      },
      testTempDir,
      testHomeDir
    );

    const unmanagedSkillDir = path.join(testTempDir, '.claude', 'skills', 'shared-tool');
    await fs.promises.mkdir(unmanagedSkillDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(unmanagedSkillDir, 'SKILL.md'),
      '---\nname: shared-tool\ndescription: Modified locally\n---\n# Local\n',
      'utf-8'
    );

    const inventory = await scanInstalledInventory('project', testTempDir, testHomeDir);
    assert.strictEqual(inventory.observed.length, 1);
    const obs = inventory.observed[0];

    assert.strictEqual(obs.candidates?.length, 2);
    assert.strictEqual(obs.candidates?.[0].sourceId, 'source-1');
    assert.strictEqual(obs.candidates?.[0].status, 'different');
    assert.strictEqual(obs.candidates?.[1].sourceId, 'source-2');
    assert.strictEqual(obs.candidates?.[1].status, 'different');

    // re-derived match is the first candidate when none are identical
    assert.strictEqual(obs.match?.sourceId, 'source-1');
    assert.strictEqual(obs.match?.status, 'different');
  });

  it('attempts to resolve git-single-item and remote-url sources', async () => {
    // we use a remote-url with file:// protocol to avoid actual network in tests
    const localRemoteFile = path.join(testTempDir, 'remote-tool.md');
    await fs.promises.writeFile(
      localRemoteFile,
      '---\nname: remote-tool\ndescription: Remote tool\n---\n# Remote\n',
      'utf-8'
    );

    await writeManifest(
      'project',
      {
        schemaVersion: SCHEMA_VERSION,
        sources: [
          {
            id: 'remote-source-1',
            type: 'remote-url',
            scope: 'project',
            url: `file://${localRemoteFile}`
          },
        ],
        desiredInstallations: [],
      },
      testTempDir,
      testHomeDir
    );

    const unmanagedSkillDir = path.join(testTempDir, '.claude', 'skills', 'remote-tool');
    await fs.promises.mkdir(unmanagedSkillDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(unmanagedSkillDir, 'SKILL.md'),
      '---\nname: remote-tool\ndescription: Remote tool\n---\n# Remote\n',
      'utf-8'
    );

    const inventory = await scanInstalledInventory('project', testTempDir, testHomeDir);
    assert.strictEqual(inventory.observed.length, 1);
    const obs = inventory.observed[0];

    assert.strictEqual(obs.candidates?.length, 1);
    assert.strictEqual(obs.candidates?.[0].sourceId, 'remote-source-1');
  });

  // Task 43.3 tests
  it('scans disabled unmanaged skill, agent, and command returning observed with disabled: true and correct metadata', async () => {
    // 1. Unmanaged disabled skill under .kilo/_disabled/skills/my-skill
    const disabledSkillDir = path.join(testTempDir, '.kilo', '_disabled', 'skills', 'dis-skill');
    await fs.promises.mkdir(disabledSkillDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(disabledSkillDir, 'SKILL.md'),
      '---\nname: dis-skill\ndescription: Disabled skill\n---\nBody\n',
      'utf-8'
    );

    // 2. Unmanaged disabled agent under .kilo/_disabled/agents/dis-agent.md
    const disabledAgentsDir = path.join(testTempDir, '.kilo', '_disabled', 'agents');
    await fs.promises.mkdir(disabledAgentsDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(disabledAgentsDir, 'dis-agent.md'),
      '---\nname: dis-agent\ndescription: Disabled agent\n---\nInstructions\n',
      'utf-8'
    );

    // 3. Unmanaged disabled command under .kilo/_disabled/command/dis-cmd.md
    const disabledCmdsDir = path.join(testTempDir, '.kilo', '_disabled', 'command');
    await fs.promises.mkdir(disabledCmdsDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(disabledCmdsDir, 'dis-cmd.md'),
      '---\ndescription: Disabled command\n---\nCommand prompt\n',
      'utf-8'
    );

    const inventory = await scanInstalledInventory('project', testTempDir, testHomeDir);
    assert.strictEqual(inventory.managed.length, 0);
    assert.strictEqual(inventory.observed.length, 3);

    const skillObs = inventory.observed.find((o) => o.name === 'dis-skill')!;
    assert.ok(skillObs);
    assert.strictEqual(skillObs.kind, 'skill');
    assert.strictEqual(skillObs.assistant, 'kilo-code');
    assert.strictEqual(skillObs.scope, 'project');
    assert.strictEqual(skillObs.disabled, true);
    assert.ok(skillObs.contentHash);

    const agentObs = inventory.observed.find((o) => o.name === 'dis-agent')!;
    assert.ok(agentObs);
    assert.strictEqual(agentObs.kind, 'agent');
    assert.strictEqual(agentObs.assistant, 'kilo-code');
    assert.strictEqual(agentObs.scope, 'project');
    assert.strictEqual(agentObs.disabled, true);
    assert.ok(agentObs.contentHash);

    const cmdObs = inventory.observed.find((o) => o.name === 'dis-cmd')!;
    assert.ok(cmdObs);
    assert.strictEqual(cmdObs.kind, 'command');
    assert.strictEqual(cmdObs.assistant, 'kilo-code');
    assert.strictEqual(cmdObs.scope, 'project');
    assert.strictEqual(cmdObs.disabled, true);
    assert.ok(cmdObs.contentHash);
  });

  it('managed disabled installation appears once as managed and is not duplicated as observed', async () => {
    const disabledSkillDir = path.join(testTempDir, '.kilo', '_disabled', 'skills', 'managed-dis-skill');
    await fs.promises.mkdir(disabledSkillDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(disabledSkillDir, 'SKILL.md'),
      '---\nname: managed-dis-skill\ndescription: Managed disabled skill\n---\nBody\n',
      'utf-8'
    );

    // Save as managed disabled in state.json
    const state = await readState('project', testTempDir, testHomeDir);
    state.installations.push({
      assistant: 'kilo-code',
      scope: 'project',
      projectPath: testTempDir,
      kind: 'skill',
      name: 'managed-dis-skill',
      path: disabledSkillDir,
      installedAt: new Date().toISOString(),
      disabled: true,
    });
    await writeState('project', state, testTempDir, testHomeDir);

    const inventory = await scanInstalledInventory('project', testTempDir, testHomeDir);
    assert.strictEqual(inventory.managed.length, 1);
    assert.strictEqual(inventory.managed[0].name, 'managed-dis-skill');
    assert.strictEqual(inventory.managed[0].disabled, true);

    // Must NOT be duplicated in observed
    assert.strictEqual(inventory.observed.length, 0);
  });

  it('an identical-to-source disabled copy shows match identical', async () => {
    // 1. Create registered source
    const sourceFolder = path.join(testTempDir, 'upstream-repo');
    const sourceSkillDir = path.join(sourceFolder, 'matched-tool');
    await fs.promises.mkdir(sourceSkillDir, { recursive: true });
    const skillContent = '---\nname: matched-tool\ndescription: Matched tool v1\n---\n# Matched\n';
    await fs.promises.writeFile(path.join(sourceSkillDir, 'SKILL.md'), skillContent, 'utf-8');

    await writeManifest(
      'project',
      {
        schemaVersion: SCHEMA_VERSION,
        sources: [
          {
            id: 'my-source',
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

    // 2. Create disabled copy in .kilo/_disabled/skills/matched-tool
    const disabledSkillDir = path.join(testTempDir, '.kilo', '_disabled', 'skills', 'matched-tool');
    await fs.promises.mkdir(disabledSkillDir, { recursive: true });
    await fs.promises.writeFile(path.join(disabledSkillDir, 'SKILL.md'), skillContent, 'utf-8');

    // 3. Scan
    const inventory = await scanInstalledInventory('project', testTempDir, testHomeDir);
    assert.strictEqual(inventory.observed.length, 1);

    const obs = inventory.observed[0];
    assert.strictEqual(obs.name, 'matched-tool');
    assert.strictEqual(obs.disabled, true);
    assert.strictEqual(obs.match?.status, 'identical');
    assert.strictEqual(obs.match?.sourceId, 'my-source');
  });

  it('refuses to promote a disabled observed artifact with "Enable it first"', async () => {
    const disabledObs: ObservedArtifact = {
      assistant: 'kilo-code',
      scope: 'project',
      projectPath: testTempDir,
      kind: 'skill',
      name: 'cannot-promote-skill',
      path: path.join(testTempDir, '.kilo', '_disabled', 'skills', 'cannot-promote-skill'),
      discoveredAt: new Date().toISOString(),
      disabled: true,
    };

    await assert.rejects(
      async () => {
        await promoteObservedArtifact(disabledObs, { sourceId: 'any-source' }, testHomeDir);
      },
      (err: Error) => {
        assert.ok(err.message.includes('Enable it first'));
        return true;
      }
    );
  });
});
