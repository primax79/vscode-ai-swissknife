import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ManagedInstallation } from '../domain/types';
import { planSync } from './sync';
import { applyInstall } from './apply';
import { KiloAdapter } from '../adapters/kilo';
import { readState } from '../domain/registry';

describe('cross-assistant sync — planSync and applyInstall', () => {
  let testTempDir: string;
  let testHomeDir: string;
  const kiloAdapter = new KiloAdapter();

  beforeEach(async () => {
    testTempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sync-test-ws-'));
    testHomeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sync-test-home-'));
  });

  afterEach(async () => {
    if (testTempDir && fs.existsSync(testTempDir)) {
      await fs.promises.rm(testTempDir, { recursive: true, force: true });
    }
    if (testHomeDir && fs.existsSync(testHomeDir)) {
      await fs.promises.rm(testHomeDir, { recursive: true, force: true });
    }
  });

  it('syncs skill from Claude Code to Kilo Code and Copilot', async () => {
    // 1. Create skill in Claude project directory
    const claudeSkillDir = path.join(testTempDir, '.claude', 'skills', 'syncable-skill');
    await fs.promises.mkdir(claudeSkillDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(claudeSkillDir, 'SKILL.md'),
      '---\nname: syncable-skill\ndescription: A syncable skill\n---\n# Content\n',
      'utf-8'
    );

    const sourceItem: ManagedInstallation = {
      assistant: 'claude-code',
      scope: 'project',
      projectPath: testTempDir,
      kind: 'skill',
      name: 'syncable-skill',
      path: claudeSkillDir,
      installedAt: new Date().toISOString(),
    };

    // 2. Plan sync to Kilo Code
    const preparedKilo = await planSync({
      sourceItem,
      targetAssistant: 'kilo-code',
      targetScope: 'project',
      targetProjectRoot: testTempDir,
      homeRoot: testHomeDir,
    });

    assert.strictEqual(preparedKilo.supported, true);
    if (preparedKilo.supported && preparedKilo.kind === 'skill') {
      assert.strictEqual(preparedKilo.content.name, 'syncable-skill');
      const applied = await applyInstall(preparedKilo, testHomeDir);
      assert.strictEqual(applied.status, 'applied');

      const kiloSkill = await kiloAdapter.readSkill('syncable-skill', {
        scope: 'project',
        projectRoot: testTempDir,
      });
      assert.ok(kiloSkill);
      assert.strictEqual(kiloSkill.name, 'syncable-skill');
    }
  });

  it('syncs agent from Claude Code to Kilo Code translating tools to permissions', async () => {
    const claudeAgentDir = path.join(testTempDir, '.claude', 'agents');
    await fs.promises.mkdir(claudeAgentDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(claudeAgentDir, 'sync-agent.md'),
      '---\nname: sync-agent\ndescription: Sync agent\ntools: ["read", "edit"]\n---\n# Agent\n',
      'utf-8'
    );

    const sourceItem: ManagedInstallation = {
      assistant: 'claude-code',
      scope: 'project',
      projectPath: testTempDir,
      kind: 'agent',
      name: 'sync-agent',
      path: path.join(claudeAgentDir, 'sync-agent.md'),
      installedAt: new Date().toISOString(),
    };

    const prepared = await planSync({
      sourceItem,
      targetAssistant: 'kilo-code',
      targetScope: 'project',
      targetProjectRoot: testTempDir,
      homeRoot: testHomeDir,
    });

    assert.strictEqual(prepared.supported, true);
    if (prepared.supported && prepared.kind === 'agent') {
      assert.strictEqual(prepared.content.permissions.read, 'allow');
      assert.strictEqual(prepared.content.permissions.edit, 'allow');

      const applied = await applyInstall(prepared, testHomeDir);
      assert.strictEqual(applied.status, 'applied');

      const state = await readState('project', testTempDir, testHomeDir);
      const installed = state.installations.find(
        (i) => i.assistant === 'kilo-code' && i.name === 'sync-agent'
      );
      assert.ok(installed);
    }
  });
});
