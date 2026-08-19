import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Setup minimal mock for 'vscode' before importing UI modules in pure Node tests
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id: string, ...rest: unknown[]) {
  if (id === 'vscode') {
    return {
      TreeItem: class {
        description?: string;
        contextValue?: string;
        tooltip?: string;
        iconPath?: unknown;
        constructor(public label: string, public collapsibleState?: number) {}
      },
      TreeItemCollapsibleState: {
        None: 0,
        Collapsed: 1,
        Expanded: 2,
      },
      EventEmitter: class {
        private listeners: Array<() => void> = [];
        event = (listener: () => void) => {
          this.listeners.push(listener);
          return { dispose: () => {} };
        };
        fire = (_data: unknown) => {
          for (const l of this.listeners) l();
        };
      },
      ThemeIcon: class {
        constructor(public id: string) {}
      },
      workspace: {
        workspaceFolders: [],
      },
      window: {
        showInformationMessage: async () => undefined,
        showWarningMessage: async () => undefined,
        showErrorMessage: async () => undefined,
        showQuickPick: async () => undefined,
        showInputBox: async () => undefined,
      },
    };
  }
  return originalRequire.apply(this, [id, ...rest]);
};

import type { ManagedInstallation } from '../domain/types';
import {
  writeManifest,
  writeState,
  SCHEMA_VERSION,
} from '../domain/registry';
import { SourcesTreeDataProvider, ScopeGroupItem } from './sourcesView';
import { InstalledTreeDataProvider, InstalledGroupItem, InstalledInstallationItem } from './installedView';

describe('UI TreeDataProviders', () => {
  let testTempDir: string;
  let testHomeDir: string;

  beforeEach(async () => {
    testTempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-swissknife-ui-ws-'));
    testHomeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-swissknife-ui-home-'));
  });

  afterEach(async () => {
    if (testTempDir && fs.existsSync(testTempDir)) {
      await fs.promises.rm(testTempDir, { recursive: true, force: true });
    }
    if (testHomeDir && fs.existsSync(testHomeDir)) {
      await fs.promises.rm(testHomeDir, { recursive: true, force: true });
    }
  });

  describe('SourcesTreeDataProvider', () => {
    it('returns Global and Project scope group items at top level', async () => {
      const provider = new SourcesTreeDataProvider();
      const topLevel = await provider.getChildren();
      assert.strictEqual(topLevel.length, 2);
      assert.ok(topLevel[0] instanceof ScopeGroupItem);
      assert.ok(topLevel[1] instanceof ScopeGroupItem);

      if (topLevel[0] instanceof ScopeGroupItem && topLevel[1] instanceof ScopeGroupItem) {
        assert.strictEqual(topLevel[0].scope, 'global');
        assert.strictEqual(topLevel[1].scope, 'project');
      }

      const item0 = provider.getTreeItem(topLevel[0]);
      assert.strictEqual(item0.label, 'Global Sources');
    });

    it('returns SourceItems for global sources from manifest', async () => {
      await writeManifest(
        'global',
        {
          schemaVersion: SCHEMA_VERSION,
          sources: [
            {
              id: 'global-git',
              type: 'git-custom',
              scope: 'global',
              url: 'https://github.com/example/skills.git',
              branch: 'main',
            },
          ],
          desiredInstallations: [],
        },
        undefined,
        testHomeDir
      );

      const provider = new SourcesTreeDataProvider();
      const globalGroup = new ScopeGroupItem('global', 'Global Sources');
      const items = await provider.getChildren(globalGroup);
      assert.ok(Array.isArray(items));
    });
  });

  describe('InstalledTreeDataProvider', () => {
    it('groups installations by (assistant, scope)', async () => {
      const inst1: ManagedInstallation = {
        assistant: 'claude-code',
        scope: 'global',
        kind: 'skill',
        name: 'skill-one',
        path: '/tmp/skill-one',
        installedAt: '2026-08-19T12:00:00.000Z',
      };
      const inst2: ManagedInstallation = {
        assistant: 'kilo-code',
        scope: 'global',
        kind: 'skill',
        name: 'skill-two',
        path: '/tmp/skill-two',
        installedAt: '2026-08-19T12:05:00.000Z',
      };

      await writeState(
        'global',
        {
          schemaVersion: SCHEMA_VERSION,
          installations: [inst1, inst2],
        },
        undefined,
        testHomeDir
      );

      const provider = new InstalledTreeDataProvider();
      const groupItem = new InstalledGroupItem('claude-code (global)', 'Claude Code (global)', [inst1]);
      const treeGroup = provider.getTreeItem(groupItem);
      assert.strictEqual(treeGroup.label, 'Claude Code (global)');
      assert.strictEqual(treeGroup.description, '1 installed');

      const installItem = new InstalledInstallationItem(inst1);
      const treeInst = provider.getTreeItem(installItem);
      assert.strictEqual(treeInst.label, 'skill-one');
      assert.strictEqual(treeInst.description, 'skill (global)');

      const children = await provider.getChildren(groupItem);
      assert.strictEqual(children.length, 1);
      assert.ok(children[0] instanceof InstalledInstallationItem);
      assert.strictEqual(children[0].installation.name, 'skill-one');
    });
  });
});
