import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Setup minimal mock for 'vscode' before importing UI modules in pure Node tests
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockShowErrorMessageCalls: any[] = [];
let mockShowInformationMessageResult: string | undefined = undefined;
let mockQuickPickResponses: any[] = [];

Module.prototype.require = function (id: string, ...rest: unknown[]) {
  if (id === 'vscode') {
    return {
      TreeItem: class {},
      TreeItemCollapsibleState: { None: 0 },
      EventEmitter: class { event = () => ({}); fire = () => {} },
      ThemeIcon: class {},
      workspace: {
        get workspaceFolders() { return [{ uri: { fsPath: (globalThis as any).testWorkspaceRoot } }]; },
        getConfiguration: () => ({ get: () => undefined })
      },
      window: {
        showInformationMessage: async (_msg: string, ..._actions: string[]) => {
          return mockShowInformationMessageResult;
        },
        showErrorMessage: async (msg: string, opts?: any) => {
          mockShowErrorMessageCalls.push({ msg, opts });
          return undefined;
        },
        showWarningMessage: async () => undefined,
        showQuickPick: async (_items: any[]) => {
          return mockQuickPickResponses.shift();
        },
      },
      Uri: {
        file: (p: string) => ({ fsPath: p }),
        joinPath: (base: any, ...segments: string[]) => ({ fsPath: [base.fsPath, ...segments].join('/') })
      },
    };
  }
  return originalRequire.apply(this, [id, ...rest]);
};

import { InstalledTreeDataProvider, InstalledInstallationItem } from './installedView';
import { writeState } from '../domain/registry';
import * as softDeleteModule from '../engine/softDelete';
import { KiloAdapter } from '../adapters/kilo';

describe('InstalledTreeDataProvider - moveItem', () => {
  let testTempDir: string;
  let testHomeDir: string;
  let provider: InstalledTreeDataProvider;
  let originalSoftDeletePath: any;

  beforeEach(async () => {
    testTempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'move-test-ws-'));
    testHomeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'move-test-home-'));
    (globalThis as any).testWorkspaceRoot = testTempDir;
    provider = new InstalledTreeDataProvider({ fsPath: '/ext' } as any);
    mockShowErrorMessageCalls = [];
    originalSoftDeletePath = softDeleteModule.softDeletePath;
  });

  afterEach(async () => {
    (softDeleteModule as any).softDeletePath = originalSoftDeletePath;
    await fs.promises.rm(testTempDir, { recursive: true, force: true });
    await fs.promises.rm(testHomeDir, { recursive: true, force: true });
  });

  it('reports manual-recovery-required if origin removal fails after successful install', async () => {
    // We need to setup a real file to act as the source item so planSync succeeds.
    const claudeSkillDir = path.join(testTempDir, 'source-skill');
    await fs.promises.mkdir(claudeSkillDir, { recursive: true });
    await fs.promises.writeFile(path.join(claudeSkillDir, 'SKILL.md'), '---\nname: move-skill\n---\ncontent', 'utf-8');

    const inst = {
      assistant: 'claude-code' as const,
      scope: 'project' as const,
      kind: 'skill' as const,
      name: 'move-skill',
      path: claudeSkillDir,
      projectPath: testTempDir,
      installedAt: new Date().toISOString(),
    };

    // Ensure it's in state so state update doesn't crash
    await writeState('project', {
      schemaVersion: 1,
      installations: [inst],
    }, testTempDir, testHomeDir);

    const item = new InstalledInstallationItem(inst);

    // Mock UI selections
    mockQuickPickResponses = [
      { label: 'kilo-code' }, // Assistant
      'project' // Scope
    ];
    mockShowInformationMessageResult = 'Move';

    // Override softDeletePath to throw to simulate failure
    (softDeleteModule as any).softDeletePath = async () => {
      throw new Error("Simulated origin-removal failure");
    };

    await provider.moveItem(item);

    assert.strictEqual(mockShowErrorMessageCalls.length, 1);
    assert.ok(mockShowErrorMessageCalls[0].msg.includes('CRITICAL'), 'Should flag the origin-removal failure as critical');
    assert.ok(!mockShowErrorMessageCalls[0].msg.includes('Installation failed'), 'Must not claim the install itself failed — it succeeded, only origin removal failed');
    assert.ok(mockShowErrorMessageCalls[0].msg.includes(claudeSkillDir), 'Should include the origin path');

    // Verify target installation was left intact (it succeeded)
    const kiloAdapter = new KiloAdapter(() => testHomeDir);
    const targetSkill = await kiloAdapter.readSkill('move-skill', { scope: 'project', projectRoot: testTempDir });
    assert.ok(targetSkill, 'Target installation should be intact');
  });
});
