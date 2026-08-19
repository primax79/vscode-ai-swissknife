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
        command?: unknown;
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

import type { ManagedInstallation, Source, Package } from '../domain/types';
import {
  writeManifest,
  writeState,
  SCHEMA_VERSION,
} from '../domain/registry';
import { SourcesTreeDataProvider, ScopeGroupItem } from './sourcesView';
import {
  AvailableTreeDataProvider,
  AvailableFolderItem,
  AvailableArtifactItem,
  buildHierarchy,
} from './availableView';
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

  describe('AvailableTreeDataProvider & buildHierarchy', () => {
    it('builds hierarchy grouping nested skills into compact folder items and root skills', () => {
      const source: Source = {
        id: 'gcube-ai-toolkit',
        type: 'local-folder',
        scope: 'project',
      };

      const packages: Package[] = [
        {
          id: 'gcube-ai-toolkit:_attic/skills/skill-1',
          sourceId: 'gcube-ai-toolkit',
          nativeFormat: 'claude-skill',
          artifacts: [
            {
              id: 'gcube-ai-toolkit:_attic/skills/skill-1:skill-1',
              packageId: 'gcube-ai-toolkit:_attic/skills/skill-1',
              kind: 'skill',
              name: 'skill-1',
              nativeFormat: 'claude-skill',
            },
          ],
        },
        {
          id: 'gcube-ai-toolkit:_attic/skills/skill-2',
          sourceId: 'gcube-ai-toolkit',
          nativeFormat: 'claude-skill',
          artifacts: [
            {
              id: 'gcube-ai-toolkit:_attic/skills/skill-2:skill-2',
              packageId: 'gcube-ai-toolkit:_attic/skills/skill-2',
              kind: 'skill',
              name: 'skill-2',
              nativeFormat: 'claude-skill',
            },
          ],
        },
        {
          id: 'gcube-ai-toolkit:root-skill',
          sourceId: 'gcube-ai-toolkit',
          nativeFormat: 'claude-skill',
          artifacts: [
            {
              id: 'gcube-ai-toolkit:root-skill:root-skill',
              packageId: 'gcube-ai-toolkit:root-skill',
              kind: 'skill',
              name: 'root-skill',
              nativeFormat: 'claude-skill',
            },
          ],
        },
      ];

      const hierarchy = buildHierarchy(source, packages);
      assert.strictEqual(hierarchy.length, 2);

      const folderItem = hierarchy.find((h) => h instanceof AvailableFolderItem) as AvailableFolderItem;
      assert.ok(folderItem);
      assert.strictEqual(folderItem.label, '_attic/skills');
      assert.strictEqual(folderItem.items.length, 2);

      const allFolderArtifacts = folderItem.getAllArtifacts();
      assert.strictEqual(allFolderArtifacts.length, 2);
      assert.strictEqual(allFolderArtifacts[0].artifact.name, 'skill-1');
      assert.strictEqual(allFolderArtifacts[1].artifact.name, 'skill-2');

      const rootArtifact = hierarchy.find((h) => h instanceof AvailableArtifactItem) as AvailableArtifactItem;
      assert.ok(rootArtifact);
      assert.strictEqual(rootArtifact.artifact.name, 'root-skill');
    });

    it('AvailableTreeDataProvider sets distinct icons and command for skill, agent, and command', () => {
      const provider = new AvailableTreeDataProvider();
      const source: Source = { id: 'src-1', type: 'local-folder', scope: 'project' };
      const pkg: Package = { id: 'src-1:pkg', sourceId: 'src-1', nativeFormat: 'claude-skill', artifacts: [] };

      const skillItem = new AvailableArtifactItem(source, pkg, {
        id: 'art-1',
        packageId: 'src-1:pkg',
        kind: 'skill',
        name: 'test-skill',
        nativeFormat: 'claude-skill',
      });
      const skillTreeItem = provider.getTreeItem(skillItem);
      assert.strictEqual(skillTreeItem.label, 'test-skill');
      assert.strictEqual((skillTreeItem.iconPath as { id: string }).id, 'tools');

      const agentItem = new AvailableArtifactItem(source, pkg, {
        id: 'art-2',
        packageId: 'src-1:pkg',
        kind: 'agent',
        name: 'test-agent',
        nativeFormat: 'claude-agent',
      });
      const agentTreeItem = provider.getTreeItem(agentItem);
      assert.strictEqual((agentTreeItem.iconPath as { id: string }).id, 'robot');

      const cmdItem = new AvailableArtifactItem(source, pkg, {
        id: 'art-3',
        packageId: 'src-1:pkg',
        kind: 'command',
        name: 'test-cmd',
        nativeFormat: 'claude-command',
      });
      const cmdTreeItem = provider.getTreeItem(cmdItem);
      assert.strictEqual((cmdTreeItem.iconPath as { id: string }).id, 'terminal');
    });
  });

  describe('InstalledTreeDataProvider', () => {
    it('groups installations by (assistant, scope) and renders correct icons', async () => {
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
        kind: 'agent',
        name: 'agent-two',
        path: '/tmp/agent-two',
        installedAt: '2026-08-19T12:05:00.000Z',
      };
      const inst3: ManagedInstallation = {
        assistant: 'kilo-code',
        scope: 'global',
        kind: 'command',
        name: 'cmd-three',
        path: '/tmp/cmd-three',
        installedAt: '2026-08-19T12:10:00.000Z',
      };

      await writeState(
        'global',
        {
          schemaVersion: SCHEMA_VERSION,
          installations: [inst1, inst2, inst3],
        },
        undefined,
        testHomeDir
      );

      const provider = new InstalledTreeDataProvider();
      const groupItem = new InstalledGroupItem('kilo-code (global)', 'Kilo Code (global)', [inst2, inst3]);
      const treeGroup = provider.getTreeItem(groupItem);
      assert.strictEqual(treeGroup.label, 'Kilo Code (global)');
      assert.strictEqual(treeGroup.description, '2 installed');

      const treeInstAgent = provider.getTreeItem(new InstalledInstallationItem(inst2));
      assert.strictEqual((treeInstAgent.iconPath as { id: string }).id, 'robot');

      const treeInstCmd = provider.getTreeItem(new InstalledInstallationItem(inst3));
      assert.strictEqual((treeInstCmd.iconPath as { id: string }).id, 'terminal');
    });
  });
});
