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
      ThemeIcon: class { constructor(public id?: string) {} },
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
      { label: 'Workspace', value: 'project' } // Scope
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

  it('getTreeItem includes explain fields and reason in tooltip', async () => {
    const inst = {
      assistant: 'claude-code' as const,
      scope: 'project' as const,
      kind: 'skill' as const,
      name: 'tooltip-skill',
      path: path.join(testTempDir, 'tooltip-skill'),
      projectPath: testTempDir,
      source: {
        id: 'team-source',
        scope: 'workspace' as const,
        type: 'git-marketplace' as const,
        location: 'https://github.com/org/team.git',
      },
      sourceRevision: {
        commit: '1234567890abcdef1234567890abcdef12345678',
      },
      contentHash: 'abcdef1234567890abcdef1234567890abcdef12',
      sourceContentHash: 'abcdef1234567890abcdef1234567890abcdef12',
      installedAt: new Date().toISOString(),
    };
    const report = {
      installation: inst,
      status: 'update-available' as const,
      installedCommit: '1234567890abcdef1234567890abcdef12345678',
      currentCommit: '9876543210fedcba9876543210fedcba98765432',
      diskHash: inst.contentHash,
      sourceHash: '0000000000000000000000000000000000000000',
    };
    const item = new InstalledInstallationItem(inst, report);
    const treeItem = await provider.getTreeItem(item);
    const tooltip = String(treeItem.tooltip);
    assert.ok(tooltip.includes('Source: workspace:team-source'));
    assert.ok(tooltip.includes('Installed commit: 1234567'));
    assert.ok(tooltip.includes('Current commit: 9876543'));
    assert.ok(tooltip.includes('Installed hash: abcdef1'));
    assert.ok(tooltip.includes('Status: update-available'));
    assert.ok(tooltip.includes('Reason: source moved from 1234567 to 9876543 and the content changed'));
  });

  it('getTreeItem renders flags as description badges and link target in tooltip (Task 48.2)', async () => {
    // 1. Link item
    const linkInst = {
      assistant: 'claude-code' as const,
      scope: 'project' as const,
      kind: 'skill' as const,
      name: 'link-badge-skill',
      path: path.join(testTempDir, 'link-badge-skill'),
      projectPath: testTempDir,
      installedAt: new Date().toISOString(),
      flags: ['link'] as any,
      linkTarget: '/resolved/target/path',
    };
    const linkItem = new InstalledInstallationItem(linkInst);
    const linkTreeItem = await provider.getTreeItem(linkItem);
    assert.ok(
      String(linkTreeItem.description).includes('[link]'),
      `Expected [link] in description: "${linkTreeItem.description}"`
    );
    assert.ok(
      String(linkTreeItem.tooltip).includes('Link target: /resolved/target/path'),
      `Expected link target in tooltip: "${linkTreeItem.tooltip}"`
    );

    // 2. Broken link item
    const brokenInst = {
      assistant: 'claude-code' as const,
      scope: 'project' as const,
      kind: 'skill' as const,
      name: 'broken-badge-skill',
      path: path.join(testTempDir, 'broken-badge-skill'),
      projectPath: testTempDir,
      installedAt: new Date().toISOString(),
      flags: ['link', 'broken-link'] as any,
      linkTarget: '/nonexistent/target/path',
    };
    const brokenItem = new InstalledInstallationItem(brokenInst);
    const brokenTreeItem = await provider.getTreeItem(brokenItem);
    assert.ok(
      String(brokenTreeItem.description).includes('[broken link]'),
      `Expected [broken link] in description: "${brokenTreeItem.description}"`
    );
    assert.ok(
      String(brokenTreeItem.tooltip).includes('Broken link: target does not exist'),
      `Expected broken link in tooltip: "${brokenTreeItem.tooltip}"`
    );

    // 3. Orphan & duplicate item
    const orphanDupInst = {
      assistant: 'claude-code' as const,
      scope: 'project' as const,
      kind: 'skill' as const,
      name: 'orphan-dup-skill',
      path: path.join(testTempDir, 'orphan-dup-skill'),
      projectPath: testTempDir,
      installedAt: new Date().toISOString(),
      flags: ['copy', 'orphan', 'duplicate'] as any,
      duplicateOf: ['claude-code:global:skill:orphan-dup-skill'],
    };
    const orphanDupItem = new InstalledInstallationItem(orphanDupInst);
    const orphanDupTreeItem = await provider.getTreeItem(orphanDupItem);
    assert.ok(
      String(orphanDupTreeItem.description).includes('[orphan]'),
      `Expected [orphan] in description: "${orphanDupTreeItem.description}"`
    );
    assert.ok(
      String(orphanDupTreeItem.description).includes('[duplicate]'),
      `Expected [duplicate] in description: "${orphanDupTreeItem.description}"`
    );
    assert.ok(
      String(orphanDupTreeItem.tooltip).includes('Orphan: artifact no longer exists in source'),
      `Expected orphan in tooltip: "${orphanDupTreeItem.tooltip}"`
    );
    assert.ok(
      String(orphanDupTreeItem.tooltip).includes('Duplicate of: claude-code:global:skill:orphan-dup-skill'),
      `Expected duplicate in tooltip: "${orphanDupTreeItem.tooltip}"`
    );
  });
});
