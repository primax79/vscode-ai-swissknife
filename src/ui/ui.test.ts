import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Setup minimal mock for 'vscode' before importing UI modules in pure Node tests
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockQuickPickResult: any = undefined;
let mockLastWarningMessage: string | undefined = undefined;

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
        get workspaceFolders() {
          return (globalThis as any).mockWorkspaceFolders || [];
        },
        createFileSystemWatcher: () => ({
          onDidChange: () => ({ dispose: () => {} }),
          onDidCreate: () => ({ dispose: () => {} }),
          onDidDelete: () => ({ dispose: () => {} }),
          dispose: () => {},
        }),
      },
      ViewColumn: {
        One: 1,
      },
      window: {
        showInformationMessage: async () => undefined,
        showWarningMessage: async (msg: string) => { mockLastWarningMessage = msg; return undefined; },
        showErrorMessage: async () => undefined,
        showQuickPick: async () => mockQuickPickResult,
        showInputBox: async () => undefined,
        createWebviewPanel: () => ({
          reveal: () => {},
          dispose: () => {},
          onDidDispose: () => ({ dispose: () => {} }),
          webview: {
            html: '',
            onDidReceiveMessage: () => ({ dispose: () => {} }),
            postMessage: async () => {},
          },
        }),
      },
      Uri: {
        joinPath: (base: any, ...segments: string[]) => ({ fsPath: [base.fsPath, ...segments].join('/') }),
        file: (path: string) => ({ fsPath: path })
      },
    };
  }
  return originalRequire.apply(this, [id, ...rest]);
};

import type { ManagedInstallation, Source, Package } from '../domain/types';
import {
  readManifest,
  writeManifest,
  writeState,
  SCHEMA_VERSION,
} from '../domain/registry';
import { SourcesTreeDataProvider, ScopeGroupItem } from './sourcesView';
import { AvailableTreeDataProvider, AvailableFolderItem, AvailableArtifactItem, buildHierarchy } from './availableView';
import { InstalledTreeDataProvider, InstalledGroupItem, InstalledInstallationItem } from './installedView';
import { getAssistantIconPath } from './assistantIcons';
import { setupFileWatchers } from './watchers';
import { DashboardPanel } from './dashboard';
import { FormEditorPanel } from './formEditor';
import { handleRecommendForWorkspace, handleUnrecommendForWorkspace } from '../extension';

describe('UI TreeDataProviders', () => {
  let testTempDir: string;
  let testHomeDir: string;

  beforeEach(async () => {
    testTempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-swissknife-ui-ws-'));
    testHomeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-swissknife-ui-home-'));
    (globalThis as any).mockWorkspaceFolders = [{ uri: { fsPath: testTempDir } }];
    mockQuickPickResult = undefined;
    mockLastWarningMessage = undefined;
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

    it('AvailableTreeDataProvider sets distinct icons and command for skill, agent, command, and mcp-server', () => {
      const provider = new AvailableTreeDataProvider({ fsPath: '/test/ext' } as any);
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

      const mcpItem = new AvailableArtifactItem(source, pkg, {
        id: 'art-4',
        packageId: 'src-1:pkg',
        kind: 'mcp-server',
        name: 'sqlite',
        nativeFormat: 'mcp-config',
      });
      const mcpTreeItem = provider.getTreeItem(mcpItem);
      assert.strictEqual((mcpTreeItem.iconPath as { id: string }).id, 'plug');
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
      const inst4: ManagedInstallation = {
        assistant: 'kilo-code',
        scope: 'global',
        kind: 'mcp-server',
        name: 'sqlite',
        path: '/tmp/mcp.json',
        installedAt: '2026-08-19T12:15:00.000Z',
      };

      await writeState(
        'global',
        {
          schemaVersion: SCHEMA_VERSION,
          installations: [inst1, inst2, inst3, inst4],
        },
        undefined,
        testHomeDir
      );

      const provider = new InstalledTreeDataProvider({ fsPath: '/test/ext' } as any);
      const groupItem = new InstalledGroupItem('kilo-code (global)', 'Kilo Code (global)', [inst2, inst3, inst4], 'kilo-code');
      const treeGroup = provider.getTreeItem(groupItem);
      assert.strictEqual(treeGroup.label, 'Kilo Code (global)');
      assert.strictEqual(treeGroup.description, '3 managed');

      const treeInstAgent = provider.getTreeItem(new InstalledInstallationItem(inst2));
      assert.strictEqual((treeInstAgent.iconPath as { id: string }).id, 'robot');

      const treeInstCmd = provider.getTreeItem(new InstalledInstallationItem(inst3));
      assert.strictEqual((treeInstCmd.iconPath as { id: string }).id, 'terminal');

      const treeInstMcp = provider.getTreeItem(new InstalledInstallationItem(inst4));
      assert.strictEqual((treeInstMcp.iconPath as { id: string }).id, 'plug');
    });

    it('sets correct iconPath for InstalledGroupItem based on assistant', () => {
      const provider = new InstalledTreeDataProvider({ fsPath: '/test/ext' } as any);
      const groupItem = new InstalledGroupItem('claude-code (global)', 'Claude Code (global)', [], 'claude-code');
      const treeGroup = provider.getTreeItem(groupItem);
      const iconPath = treeGroup.iconPath as { light: { fsPath: string }, dark: { fsPath: string } };
      assert.ok(iconPath);
      assert.strictEqual(iconPath.light.fsPath, '/test/ext/resources/claude.svg');
      assert.strictEqual(iconPath.dark.fsPath, '/test/ext/resources/claude.svg');
    });
  });

  describe('setupFileWatchers', () => {
    it('creates disposables for assistant directories', () => {
      let fired = false;
      const disposables = setupFileWatchers(() => {
        fired = true;
      });
      assert.ok(disposables.length > 0);
      assert.strictEqual(fired, false);

      for (const d of disposables) {
        d.dispose();
      }
    });
  });

  describe('DashboardPanel', () => {
    it('renders dashboard HTML with metrics and item rows', () => {
      const panel = DashboardPanel.render();
      assert.ok(panel);

      const html = panel.getHtml(
        [],
        [
          {
            assistant: 'claude-code',
            scope: 'project',
            kind: 'skill',
            name: 'demo-skill',
            path: '/tmp/demo-skill',
            installedAt: '2026-08-19T12:00:00.000Z',
          },
        ],
        [],
        []
      );

      assert.ok(html.includes('AI Swissknife Dashboard'));
      assert.ok(html.includes('demo-skill'));
      assert.ok(html.includes('claude-code'));
      panel.dispose();
    });
  });

  describe('FormEditorPanel', () => {
    it('renders form editor HTML for skill, agent, command, and mcp-server', async () => {
      const panel = await FormEditorPanel.open({
        mode: 'create',
        assistant: 'kilo-code',
        scope: 'project',
        kind: 'agent',
      });
      assert.ok(panel);

      const html = panel.getHtml({
        name: 'test-agent',
        description: 'Testing form editor',
        mode: 'subagent',
        tools: ['read', 'edit'],
        body: '# Test Agent\nInstructions here.',
      });

      assert.ok(html.includes('Create agent'));
      assert.ok(html.includes('test-agent'));
      assert.ok(html.includes('kilo-code'));
      assert.ok(html.includes('subagent'));
      panel.dispose();
    });
  });

  describe('Recommend and Unrecommend Commands', () => {
    it('manages desiredInstallations in manifest accurately', async () => {
      const availableProvider = new AvailableTreeDataProvider({ fsPath: '/test/ext' } as any);
      const installedProvider = new InstalledTreeDataProvider({ fsPath: '/test/ext' } as any);

      const source: Source = { id: 'src-1', type: 'local-folder', scope: 'project' };
      const pkg: Package = { id: 'src-1:pkg', sourceId: 'src-1', nativeFormat: 'raw', artifacts: [] };
      const availableItem = new AvailableArtifactItem(source, pkg, {
        id: 'art-1',
        packageId: 'src-1:pkg',
        kind: 'skill',
        name: 'test-skill',
        nativeFormat: 'raw',
      });

      // Recommend an item from Available
      mockQuickPickResult = 'claude-code';
      await handleRecommendForWorkspace(availableItem, availableProvider, installedProvider);

      let manifest = await readManifest('project', testTempDir);
      assert.strictEqual(manifest.desiredInstallations.length, 1);
      assert.strictEqual(manifest.desiredInstallations[0].sourceId, 'src-1');
      assert.strictEqual(manifest.desiredInstallations[0].artifactId, 'art-1');
      assert.strictEqual(manifest.desiredInstallations[0].assistant, 'claude-code');

      // Call recommend again on the same item/assistant
      await handleRecommendForWorkspace(availableItem, availableProvider, installedProvider);
      manifest = await readManifest('project', testTempDir);
      assert.strictEqual(manifest.desiredInstallations.length, 1); // still exactly one entry

      // Unrecommend
      await handleUnrecommendForWorkspace(availableItem, availableProvider, installedProvider);
      manifest = await readManifest('project', testTempDir);
      assert.strictEqual(manifest.desiredInstallations.length, 0); // entry removed

      // Recommend on a global-scope item
      const globalSource: Source = { id: 'global-1', type: 'local-folder', scope: 'global' };
      const globalAvailableItem = new AvailableArtifactItem(globalSource, pkg, {
        id: 'art-1',
        packageId: 'src-1:pkg',
        kind: 'skill',
        name: 'test-skill',
        nativeFormat: 'raw',
      });
      mockLastWarningMessage = undefined;
      await handleRecommendForWorkspace(globalAvailableItem, availableProvider, installedProvider);
      manifest = await readManifest('project', testTempDir);
      assert.strictEqual(manifest.desiredInstallations.length, 0); // no manifest change
      assert.ok((mockLastWarningMessage as any)?.includes('Cannot recommend global-scope items'));

      // Recommend on an installed item with no sourceId/artifactId
      const unmanagedInstallation: ManagedInstallation = {
        assistant: 'claude-code',
        scope: 'project',
        kind: 'skill',
        name: 'test-skill',
        path: '/tmp/skill',
        installedAt: 'now',
        // sourceId and artifactId missing
      };
      const installedItem = new InstalledInstallationItem(unmanagedInstallation);
      mockLastWarningMessage = undefined;
      await handleRecommendForWorkspace(installedItem, availableProvider, installedProvider);
      manifest = await readManifest('project', testTempDir);
      assert.strictEqual(manifest.desiredInstallations.length, 0); // no manifest change
      assert.ok((mockLastWarningMessage as any)?.includes("This item isn't tracked to a source"));
    });
  });

  describe('assistantIcons', () => {
    it('getAssistantIconPath returns the right file(s) for each of the 5 assistant ids', () => {
      const extUri = { fsPath: '/ext' } as any;
      const claude = getAssistantIconPath('claude-code', extUri);
      assert.strictEqual(claude.light.fsPath, '/ext/resources/claude.svg');
      assert.strictEqual(claude.dark.fsPath, '/ext/resources/claude.svg');

      const kilo = getAssistantIconPath('kilo-code', extUri);
      assert.strictEqual(kilo.light.fsPath, '/ext/resources/kilocode-light.svg');
      assert.strictEqual(kilo.dark.fsPath, '/ext/resources/kilocode-dark.svg');

      const copilot = getAssistantIconPath('github-copilot', extUri);
      assert.strictEqual(copilot.light.fsPath, '/ext/resources/githubcopilot-light.svg');
      assert.strictEqual(copilot.dark.fsPath, '/ext/resources/githubcopilot-dark.svg');

      const codex = getAssistantIconPath('codex-cli', extUri);
      assert.strictEqual(codex.light.fsPath, '/ext/resources/openai.svg');
      assert.strictEqual(codex.dark.fsPath, '/ext/resources/openai.svg');

      const gemini = getAssistantIconPath('gemini-cli', extUri);
      assert.strictEqual(gemini.light.fsPath, '/ext/resources/gemini.svg');
      assert.strictEqual(gemini.dark.fsPath, '/ext/resources/gemini.svg');
    });
  });
});
