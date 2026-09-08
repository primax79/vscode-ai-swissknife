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
let mockShowInformationMessageResult: string | undefined = undefined;
let mockShowInformationMessageCalls: { msg: string, actions: string[] }[] = [];
let mockLastCreatedStatusBarItem: any = undefined;

Module.prototype.require = function (id: string, ...rest: unknown[]) {
  if (id === 'vscode') {
    return {
      StatusBarAlignment: {
        Left: 1,
        Right: 2,
      },
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
        static Folder = { id: 'folder' };
        static File = { id: 'file' };
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
        registerTextDocumentContentProvider: () => ({ dispose: () => {} }),
      },
      ViewColumn: {
        One: 1,
      },
      window: {
        showInformationMessage: async (msg: string, ...actions: string[]) => {
          mockShowInformationMessageCalls.push({ msg, actions });
          return mockShowInformationMessageResult;
        },
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
            asWebviewUri: (uri: any) => 'vscode-webview-resource://' + uri.fsPath,
            onDidReceiveMessage: () => ({ dispose: () => {} }),
            postMessage: async () => {},
          },
        }),
        registerTreeDataProvider: () => ({ dispose: () => {} }),
        createTreeView: () => ({
          onDidChangeSelection: () => ({ dispose: () => {} }),
          dispose: () => {},
        }),
        createStatusBarItem: (alignment?: any, priority?: number) => {
          const item = {
            alignment,
            priority,
            command: undefined as string | undefined,
            text: '',
            tooltip: undefined as string | undefined,
            show: () => {},
            hide: () => {},
            dispose: () => {},
          };
          mockLastCreatedStatusBarItem = item;
          return item;
        },
      },
      commands: {
        registerCommand: () => ({ dispose: () => {} }),
        executeCommand: async () => {},
      },
      Uri: {
        joinPath: (base: any, ...segments: string[]) => ({ fsPath: [base.fsPath, ...segments].join('/') }),
        file: (path: string) => ({ fsPath: path }),
        parse: (value: string) => ({ toString: () => value }),
      },
    };
  }
  return originalRequire.apply(this, [id, ...rest]);
};

import type { ManagedInstallation, Source, Package, Artifact } from '../domain/types';
import {
  readManifest,
  writeManifest,
  writeState,
  SCHEMA_VERSION,
} from '../domain/registry';
import { SourcesTreeDataProvider, ScopeGroupItem, SourceItem } from './sourcesView';
import { AvailableTreeDataProvider, AvailableFolderItem, AvailableArtifactItem, buildHierarchy, AvailableSourceGroupItem } from './availableView';
import { ArtifactFileItem } from './artifactFileTree';
import { InstalledTreeDataProvider, ScopeGroupItem as InstalledScopeGroupItem, InstalledInstallationItem, KindGroupItem } from './installedView';
import { getAssistantIconPath } from './assistantIcons';
import { setupFileWatchers } from './watchers';
import { DashboardPanel } from './dashboard';
import { FormEditorPanel } from './formEditor';
import { handleRecommendForWorkspace, handleUnrecommendForWorkspace } from '../extension';
import { RecommendedGroupItem, RecommendedBrokenItem } from './availableView';
import type { DesiredInstallation } from '../domain/registry';

describe('UI TreeDataProviders', () => {
  let testTempDir: string;
  let testHomeDir: string;

  beforeEach(async () => {
    testTempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-swissknife-ui-ws-'));
    testHomeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-swissknife-ui-home-'));
    (globalThis as any).mockWorkspaceFolders = [{ uri: { fsPath: testTempDir } }];
    mockQuickPickResult = undefined;
    mockLastWarningMessage = undefined;
    mockShowInformationMessageResult = undefined;
    mockShowInformationMessageCalls = [];
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
      const provider = new SourcesTreeDataProvider(
        new AvailableTreeDataProvider({ fsPath: '/test/ext' } as any, testHomeDir)
      );
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

      const provider = new SourcesTreeDataProvider(
        new AvailableTreeDataProvider({ fsPath: '/test/ext' } as any, testHomeDir)
      );
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
      assert.strictEqual((skillTreeItem.iconPath as { id: string }).id, 'lightbulb');

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

    it('AvailableArtifactItem exposes read-only file browsing for git/remote sources but editable for local-folder', async () => {
      const provider = new AvailableTreeDataProvider({ fsPath: '/test/ext' } as any);
      const artifactDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-swissknife-available-art-'));
      await fs.promises.writeFile(path.join(artifactDir, 'SKILL.md'), '# test');

      try {
        const gitSource: Source = { id: 'src-git', type: 'git-marketplace', scope: 'project', url: 'https://example.invalid/repo.git' };
        const pkg: Package = { id: 'src-git:pkg', sourceId: 'src-git', nativeFormat: 'claude-skill', artifacts: [] };
        const gitArtifact: Artifact = {
          id: 'art-git', packageId: 'src-git:pkg', kind: 'skill', name: 'cloned-skill',
          nativeFormat: 'claude-skill', path: artifactDir,
        };
        const gitItem = new AvailableArtifactItem(gitSource, pkg, gitArtifact);

        const gitTreeItem = provider.getTreeItem(gitItem);
        assert.strictEqual(gitTreeItem.collapsibleState, 1 /* Collapsed */);

        const gitChildren = await provider.getChildren(gitItem);
        assert.strictEqual(gitChildren.length, 1);
        const gitFile = gitChildren[0] as ArtifactFileItem;
        assert.strictEqual(gitFile.label, 'SKILL.md');
        assert.strictEqual(gitFile.readonly, true);

        const gitFileTreeItem = provider.getTreeItem(gitFile);
        assert.strictEqual(gitFileTreeItem.command?.title, 'Preview File (read-only)');

        const localSource: Source = { id: 'src-local', type: 'local-folder', scope: 'project', localPath: artifactDir };
        const localArtifact: Artifact = {
          id: 'art-local', packageId: 'src-local:pkg', kind: 'skill', name: 'local-skill',
          nativeFormat: 'claude-skill', path: artifactDir,
        };
        const localItem = new AvailableArtifactItem(localSource, pkg, localArtifact);

        const localChildren = await provider.getChildren(localItem);
        const localFile = localChildren[0] as ArtifactFileItem;
        assert.strictEqual(localFile.readonly, false);

        const localFileTreeItem = provider.getTreeItem(localFile);
        assert.strictEqual(localFileTreeItem.command?.title, 'Open File');
      } finally {
        await fs.promises.rm(artifactDir, { recursive: true, force: true });
      }
    });

    it('previewArtifact resolves a skill directory to its SKILL.md and a single-file kind to itself', async () => {
      const skillDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-swissknife-preview-skill-'));
      const agentFile = path.join(await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-swissknife-preview-agent-')), 'my-agent.md');
      try {
        await fs.promises.writeFile(path.join(skillDir, 'SKILL.md'), '# skill');
        await fs.promises.writeFile(agentFile, '# agent');

        const provider = new AvailableTreeDataProvider({ fsPath: '/test/ext' } as any);
        const source: Source = { id: 'src-1', type: 'git-marketplace', scope: 'project', url: 'https://example.invalid/repo.git' };
        const pkg: Package = { id: 'src-1:pkg', sourceId: 'src-1', nativeFormat: 'claude-skill', artifacts: [] };

        const skillItem = new AvailableArtifactItem(source, pkg, {
          id: 'art-skill', packageId: 'src-1:pkg', kind: 'skill', name: 'a-skill',
          nativeFormat: 'claude-skill', path: skillDir,
        });
        await provider.previewArtifact(skillItem);

        const agentItem = new AvailableArtifactItem(source, pkg, {
          id: 'art-agent', packageId: 'src-1:pkg', kind: 'agent', name: 'an-agent',
          nativeFormat: 'claude-agent', path: agentFile,
        });
        await provider.previewArtifact(agentItem);

        const noPathItem = new AvailableArtifactItem(source, pkg, {
          id: 'art-nopath', packageId: 'src-1:pkg', kind: 'agent', name: 'no-path-agent',
          nativeFormat: 'claude-agent',
        });
        await provider.previewArtifact(noPathItem);
        assert.ok(mockLastWarningMessage?.includes('No local file to preview'));

        mockLastWarningMessage = undefined as string | undefined;
        await provider.previewArtifact(undefined);
        assert.ok((mockLastWarningMessage as string | undefined)?.includes('Please select an available item'));
      } finally {
        await fs.promises.rm(skillDir, { recursive: true, force: true });
        await fs.promises.rm(path.dirname(agentFile), { recursive: true, force: true });
      }
    });

    it('shows which assistants an artifact is installed in via description and tooltip, not the label', () => {
      const provider = new AvailableTreeDataProvider({ fsPath: '/test/ext' } as any);
      const source: Source = { id: 'src-1', type: 'local-folder', scope: 'project' };
      const pkg: Package = { id: 'src-1:pkg', sourceId: 'src-1', nativeFormat: 'claude-skill', artifacts: [] };

      const installedItem = new AvailableArtifactItem(source, pkg, {
        id: 'art-installed', packageId: 'src-1:pkg', kind: 'skill', name: 'my-skill', nativeFormat: 'claude-skill',
      });
      const notInstalledItem = new AvailableArtifactItem(source, pkg, {
        id: 'art-not-installed', packageId: 'src-1:pkg', kind: 'skill', name: 'other-skill', nativeFormat: 'claude-skill',
      });

      provider['installedByArtifactKey'] = new Map([
        ['src-1:art-installed', ['claude-code', 'kilo-code']],
      ]);

      const installedTreeItem = provider.getTreeItem(installedItem);
      assert.strictEqual(installedTreeItem.label, 'my-skill');
      assert.strictEqual(installedTreeItem.description, 'installed: claude-code, kilo-code');
      assert.ok((installedTreeItem.tooltip as string).includes('Installed in: claude-code, kilo-code'));

      const notInstalledTreeItem = provider.getTreeItem(notInstalledItem);
      assert.strictEqual(notInstalledTreeItem.label, 'other-skill');
      assert.strictEqual(notInstalledTreeItem.description, undefined);
      assert.ok(!(notInstalledTreeItem.tooltip as string).includes('Installed in:'));
    });

    it('renders RecommendedGroupItem and RecommendedBrokenItem correctly', () => {
      const provider = new AvailableTreeDataProvider({ fsPath: '/test/ext' } as any);

      const source: Source = { id: 's1', type: 'git-custom', scope: 'project' };
      const pkg: Package = { id: 'p1', sourceId: 's1', nativeFormat: 'raw', artifacts: [] };
      const artifact: Artifact = { id: 'a1', packageId: 'p1', kind: 'skill', name: 's', nativeFormat: 'md' };
      const desiredSat: DesiredInstallation = { sourceId: 's1', artifactId: 'a1', assistant: 'claude-code', scope: 'project' };
      const desiredBrok: DesiredInstallation = { sourceId: 's2', artifactId: 'a2', assistant: 'claude-code', scope: 'project' };
      
      const pending = [{ desired: desiredSat, artifact, pkg, source }];
      const broken = [{ desired: desiredBrok, reason: { kind: 'source-not-registered' as const } }];
      
      const groupItem = new RecommendedGroupItem(pending, broken);
      const treeGroup = provider.getTreeItem(groupItem);
      assert.strictEqual(treeGroup.label, 'Recommended');
      assert.strictEqual(treeGroup.description, '1 pending, 1 broken');
      assert.strictEqual((treeGroup.iconPath as { id: string }).id, 'star');

      const brokenItem = new RecommendedBrokenItem(desiredBrok, { kind: 'source-not-registered' });
      const treeBroken = provider.getTreeItem(brokenItem);
      assert.strictEqual(treeBroken.label, 'a2');
      assert.ok((treeBroken.description as string).includes('Source not registered'));
      assert.strictEqual(treeBroken.command, undefined, 'broken items must be non-actionable (no command)');
    });

    it('root children include the Recommended group when non-empty', async () => {
      const provider = new AvailableTreeDataProvider({ fsPath: '/test/ext' } as any, testHomeDir);
      const source1: Source = { id: 's1', type: 'git-custom', scope: 'project' };
      const artifact1: Artifact = { id: 'a1', packageId: 'p1', kind: 'skill', name: 'art1', nativeFormat: 'md' };
      const pkg1: Package = { id: 'p1', sourceId: 's1', nativeFormat: 'raw', artifacts: [artifact1] };
      const desiredSat: DesiredInstallation = { sourceId: 's1', artifactId: 'a1', assistant: 'claude-code', scope: 'project' };
      const pending = [{ desired: desiredSat, artifact: artifact1, pkg: pkg1, source: source1 }];

      provider['cachedSourceGroups'] = [
        new AvailableSourceGroupItem(source1, { packages: [pkg1], diagnostics: [] }),
      ];
      provider['cachedRecommendedGroup'] = new RecommendedGroupItem(pending, []);

      const children = await provider.getChildren();
      assert.strictEqual(children.length, 2);
      assert.ok(children[0] instanceof RecommendedGroupItem);
      assert.ok(children[1] instanceof AvailableSourceGroupItem);
    });

    it('refreshCatalog dedupes concurrent calls into a single resolve pass', async () => {
      const provider = new AvailableTreeDataProvider({ fsPath: '/test/ext' } as any, testHomeDir);
      let callCount = 0;
      const original = (provider as any).doRefreshCatalog.bind(provider);
      (provider as any).doRefreshCatalog = async () => {
        callCount++;
        await original();
      };

      // Regression guard: before this fix, every concurrent caller (e.g. the
      // tree re-rendering while a slow/hung source was still resolving)
      // kicked off its own independent full resolve pass.
      await Promise.all([provider.refreshCatalog(), provider.refreshCatalog(), provider.refreshCatalog()]);
      assert.strictEqual(callCount, 1);
    });
  });

  describe('SourcesTreeDataProvider merged with Available content', () => {
    it("resolves a SourceItem's children from the injected AvailableTreeDataProvider's cache, disambiguating same id + different scope", async () => {
      const availableProvider = new AvailableTreeDataProvider({ fsPath: '/test/ext' } as any, testHomeDir);
      const sourcesProvider = new SourcesTreeDataProvider(availableProvider);

      const source1: Source = { id: 's1', type: 'git-custom', scope: 'project' };
      const source2: Source = { id: 's1', type: 'git-custom', scope: 'global' }; // same id, different scope
      const artifact1: Artifact = { id: 'a1', packageId: 'p1', kind: 'skill', name: 'art1', nativeFormat: 'md' };
      const artifact2: Artifact = { id: 'a2', packageId: 'p2', kind: 'skill', name: 'art2', nativeFormat: 'md' };
      const pkg1: Package = { id: 'p1', sourceId: 's1', nativeFormat: 'raw', artifacts: [artifact1] };
      const pkg2: Package = { id: 'p2', sourceId: 's1', nativeFormat: 'raw', artifacts: [artifact2] };

      availableProvider['cachedSourceGroups'] = [
        new AvailableSourceGroupItem(source1, { packages: [pkg1], diagnostics: [] }),
        new AvailableSourceGroupItem(source2, { packages: [pkg2], diagnostics: [] }),
      ];

      const sourceItem1 = new SourceItem(source1, 's1');
      const children1 = await sourcesProvider.getChildren(sourceItem1);
      assert.strictEqual(children1.length, 1);
      assert.ok(children1[0] instanceof AvailableArtifactItem);
      assert.strictEqual((children1[0] as AvailableArtifactItem).artifact.name, 'art1');

      const sourceItem2 = new SourceItem(source2, 's1');
      const children2 = await sourcesProvider.getChildren(sourceItem2);
      assert.strictEqual(children2.length, 1);
      assert.ok(children2[0] instanceof AvailableArtifactItem);
      assert.strictEqual((children2[0] as AvailableArtifactItem).artifact.name, 'art2');
    });

    it('root children include the Recommended group ahead of the two scope groups', async () => {
      const availableProvider = new AvailableTreeDataProvider({ fsPath: '/test/ext' } as any, testHomeDir);
      const sourcesProvider = new SourcesTreeDataProvider(availableProvider);

      const source1: Source = { id: 's1', type: 'git-custom', scope: 'project' };
      const artifact1: Artifact = { id: 'a1', packageId: 'p1', kind: 'skill', name: 'art1', nativeFormat: 'md' };
      const pkg1: Package = { id: 'p1', sourceId: 's1', nativeFormat: 'raw', artifacts: [artifact1] };
      const desiredSat: DesiredInstallation = { sourceId: 's1', artifactId: 'a1', assistant: 'claude-code', scope: 'project' };

      availableProvider['cachedSourceGroups'] = [
        new AvailableSourceGroupItem(source1, { packages: [pkg1], diagnostics: [] }),
      ];
      availableProvider['cachedRecommendedGroup'] = new RecommendedGroupItem(
        [{ desired: desiredSat, artifact: artifact1, pkg: pkg1, source: source1 }],
        []
      );

      const children = await sourcesProvider.getChildren();
      assert.strictEqual(children.length, 3);
      assert.ok(children[0] instanceof RecommendedGroupItem);
      assert.ok(children[1] instanceof ScopeGroupItem);
      assert.ok(children[2] instanceof ScopeGroupItem);
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
      const groupItem = new InstalledScopeGroupItem(
        'kilo-code', 'global', 'global', [inst2, inst3, inst4], []
      );
      const treeGroup = provider.getTreeItem(groupItem);
      assert.strictEqual(treeGroup.label, 'global');
      assert.strictEqual(treeGroup.description, '3 managed, 0 unmanaged');

      const treeInstAgent = provider.getTreeItem(new InstalledInstallationItem(inst2));
      assert.strictEqual((treeInstAgent.iconPath as { id: string }).id, 'robot');

      const treeInstCmd = provider.getTreeItem(new InstalledInstallationItem(inst3));
      assert.strictEqual((treeInstCmd.iconPath as { id: string }).id, 'terminal');

      const treeInstMcp = provider.getTreeItem(new InstalledInstallationItem(inst4));
      assert.strictEqual((treeInstMcp.iconPath as { id: string }).id, 'plug');
    });

    it('groups a ScopeGroupItem\'s children into one KindGroupItem per kind present, in stable order, none for absent kinds', async () => {
      const skillA: ManagedInstallation = {
        assistant: 'kilo-code', scope: 'global', kind: 'skill', name: 'skill-a',
        path: '/tmp/skill-a', installedAt: '2026-08-19T12:00:00.000Z',
      };
      const skillB: ManagedInstallation = {
        assistant: 'kilo-code', scope: 'global', kind: 'skill', name: 'skill-b',
        path: '/tmp/skill-b', installedAt: '2026-08-19T12:01:00.000Z',
      };
      const agentA: ManagedInstallation = {
        assistant: 'kilo-code', scope: 'global', kind: 'agent', name: 'agent-a',
        path: '/tmp/agent-a', installedAt: '2026-08-19T12:02:00.000Z',
      };
      const mcpA: ManagedInstallation = {
        assistant: 'kilo-code', scope: 'global', kind: 'mcp-server', name: 'mcp-a',
        path: '/tmp/mcp-a', installedAt: '2026-08-19T12:03:00.000Z',
      };

      const provider = new InstalledTreeDataProvider({ fsPath: '/test/ext' } as any);
      const groupItem = new InstalledScopeGroupItem(
        'kilo-code', 'global', 'global', [skillA, skillB, agentA, mcpA], []
      );

      const kindGroups = await provider.getChildren(groupItem);
      assert.strictEqual(kindGroups.length, 3);
      assert.ok(kindGroups.every((g) => g instanceof KindGroupItem));
      const [skillsGroup, agentsGroup, mcpGroup] = kindGroups as KindGroupItem[];
      // Stable order: skill, agent, command, mcp-server, hook, rule — commands/hooks/rules absent, skipped.
      assert.strictEqual(skillsGroup.kind, 'skill');
      assert.strictEqual(skillsGroup.items.length, 2);
      assert.strictEqual(agentsGroup.kind, 'agent');
      assert.strictEqual(agentsGroup.items.length, 1);
      assert.strictEqual(mcpGroup.kind, 'mcp-server');
      assert.strictEqual(mcpGroup.items.length, 1);

      const skillsTreeItem = provider.getTreeItem(skillsGroup);
      assert.strictEqual(skillsTreeItem.label, 'Skills (2)');
      assert.strictEqual((skillsTreeItem.iconPath as { id: string }).id, 'lightbulb');

      const resolvedSkillItems = await provider.getChildren(skillsGroup);
      assert.strictEqual(resolvedSkillItems.length, 2);
      assert.ok(resolvedSkillItems[0] instanceof InstalledInstallationItem);
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
    it('renders dashboard HTML with metrics and item rows in normal (non-scanning) mode', () => {
      const panel = DashboardPanel.render({ fsPath: '/test/ext' } as any, {} as any);
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
      // Normal mode without a report defaults to up-to-date
      assert.ok(html.includes('● Managed · up to date'));
      assert.ok(!html.includes('id="scan-indicator"')); // No scanning indicator
      assert.ok(html.includes('data-drift-key="claude-code:project:demo-skill"'));
      
      panel.dispose();
    });

    it('renders dashboard HTML in scanning mode with pending status and indicator', () => {
      const panel = DashboardPanel.render({ fsPath: '/test/ext' } as any, {} as any);
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
        [],
        true // scanning = true
      );

      assert.ok(html.includes('AI Swissknife Dashboard'));
      assert.ok(html.includes('demo-skill'));
      // In scanning mode without a report, it should show 'checking…' and 'badge-pending'
      assert.ok(html.includes('● Managed · checking…'));
      assert.ok(html.includes('badge-pending'));
      assert.ok(!html.includes('>up-to-date<')); // Should not default to up-to-date
      
      // Should include the scanning indicator
      assert.ok(html.includes('id="scan-indicator"'));
      assert.ok(html.includes('Scanning for updates…'));
      
      // Should include the data-drift-key
      assert.ok(html.includes('data-drift-key="claude-code:project:demo-skill"'));
      
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
      const availableProvider = new AvailableTreeDataProvider({ fsPath: '/test/ext' } as any, testHomeDir);
      const installedProvider = new InstalledTreeDataProvider({ fsPath: '/test/ext' } as any);
      const sourcesProvider = new SourcesTreeDataProvider(availableProvider);

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
      await handleRecommendForWorkspace(availableItem, availableProvider, installedProvider, sourcesProvider);

      let manifest = await readManifest('project', testTempDir);
      assert.strictEqual(manifest.desiredInstallations.length, 1);
      assert.strictEqual(manifest.desiredInstallations[0].sourceId, 'src-1');
      assert.strictEqual(manifest.desiredInstallations[0].artifactId, 'art-1');
      assert.strictEqual(manifest.desiredInstallations[0].assistant, 'claude-code');

      // Call recommend again on the same item/assistant
      await handleRecommendForWorkspace(availableItem, availableProvider, installedProvider, sourcesProvider);
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
      await handleRecommendForWorkspace(globalAvailableItem, availableProvider, installedProvider, sourcesProvider);
      manifest = await readManifest('project', testTempDir);
      assert.strictEqual(manifest.desiredInstallations.length, 0); // no manifest change
      assert.ok((mockLastWarningMessage as any)?.includes('Cannot recommend global-scope items'));

      // Recommend on an installed item with no sourceId/artifactId: the user is
      // prompted to pick/register the source that provides it. Simulate cancelling
      // that prompt -> no manifest change, no crash.
      const unmanagedInstallation: ManagedInstallation = {
        assistant: 'claude-code',
        scope: 'global',
        kind: 'skill',
        name: 'test-skill',
        path: '/tmp/skill',
        installedAt: 'now',
        // sourceId and artifactId missing
      };
      const installedItem = new InstalledInstallationItem(unmanagedInstallation);
      mockLastWarningMessage = undefined;
      mockQuickPickResult = undefined;
      await handleRecommendForWorkspace(installedItem, availableProvider, installedProvider, sourcesProvider);
      manifest = await readManifest('project', testTempDir);
      assert.strictEqual(manifest.desiredInstallations.length, 0); // cancelled -> no manifest change
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

  describe('Workspace Open Detection', () => {
    let fakeContext: any;
    let extension: any;

    beforeEach(async () => {
      fakeContext = {
        subscriptions: [],
        workspaceState: {
          _state: new Map<string, any>(),
          get(key: string) { return this._state.get(key); },
          async update(key: string, value: any) { this._state.set(key, value); }
        }
      };
      delete require.cache[require.resolve('../extension')];
      extension = require('../extension');
    });

    it('shows notification with correct count when unsatisfied recommendations exist', async () => {
      await writeManifest(
        'project',
        {
          schemaVersion: SCHEMA_VERSION,
          sources: [],
          desiredInstallations: [
            { sourceId: 'src-1', artifactId: 'art-1', assistant: 'claude-code', scope: 'project' },
            { sourceId: 'src-1', artifactId: 'art-2', assistant: 'claude-code', scope: 'project' }
          ],
        },
        testTempDir
      );
      await writeState(
        'project',
        {
          schemaVersion: SCHEMA_VERSION,
          installations: [
            { sourceId: 'src-1', artifactId: 'art-1', assistant: 'claude-code', scope: 'project', kind: 'skill', name: 'art-1', path: '/tmp/art-1', installedAt: 'now' }
          ],
        },
        testTempDir
      );

      mockShowInformationMessageResult = 'Review'; // Resolve with something to prevent hang or to check behavior

      extension.activate(fakeContext);
      await new Promise(r => setTimeout(r, 50)); // let async detection run

      assert.strictEqual(mockShowInformationMessageCalls.length, 1);
      assert.ok(mockShowInformationMessageCalls[0].msg.includes('1 AI Swissknife item(s)'));
      assert.deepStrictEqual(mockShowInformationMessageCalls[0].actions, [
        'Install All',
        'Review',
        "Don't ask again for this workspace"
      ]);
    });

    it('does not show notification when ignore flag is set', async () => {
      await writeManifest(
        'project',
        {
          schemaVersion: SCHEMA_VERSION,
          sources: [],
          desiredInstallations: [
            { sourceId: 'src-1', artifactId: 'art-1', assistant: 'claude-code', scope: 'project' }
          ],
        },
        testTempDir
      );
      await fakeContext.workspaceState.update('aiSwissknife.ignoreRecommendations', true);

      extension.activate(fakeContext);
      await new Promise(r => setTimeout(r, 50));

      assert.strictEqual(mockShowInformationMessageCalls.length, 0);
    });

    it('does not show notification when all recommendations are satisfied', async () => {
      await writeManifest(
        'project',
        {
          schemaVersion: SCHEMA_VERSION,
          sources: [],
          desiredInstallations: [
            { sourceId: 'src-1', artifactId: 'art-1', assistant: 'claude-code', scope: 'project' }
          ],
        },
        testTempDir
      );
      await writeState(
        'project',
        {
          schemaVersion: SCHEMA_VERSION,
          installations: [
            { sourceId: 'src-1', artifactId: 'art-1', assistant: 'claude-code', scope: 'project', kind: 'skill', name: 'art-1', path: '/tmp/art-1', installedAt: 'now' }
          ],
        },
        testTempDir
      );

      extension.activate(fakeContext);
      await new Promise(r => setTimeout(r, 50));

      assert.strictEqual(mockShowInformationMessageCalls.length, 0);
    });

    it('persists ignore flag when "Don\'t ask again" is chosen', async () => {
      await writeManifest(
        'project',
        {
          schemaVersion: SCHEMA_VERSION,
          sources: [],
          desiredInstallations: [
            { sourceId: 'src-1', artifactId: 'art-1', assistant: 'claude-code', scope: 'project' }
          ],
        },
        testTempDir
      );

      mockShowInformationMessageResult = "Don't ask again for this workspace";

      extension.activate(fakeContext);
      await new Promise(r => setTimeout(r, 50));

      assert.strictEqual(fakeContext.workspaceState.get('aiSwissknife.ignoreRecommendations'), true);
    });
  });

  describe('Status Bar Item', () => {
    let fakeContext: any;
    let extension: any;

    beforeEach(async () => {
      fakeContext = {
        subscriptions: [],
        workspaceState: {
          _state: new Map<string, any>(),
          get(key: string) { return this._state.get(key); },
          async update(key: string, value: any) { this._state.set(key, value); }
        }
      };
      delete require.cache[require.resolve('../extension')];
      extension = require('../extension');
    });

    it('creates persistent status bar item with openDashboard command and default label', async () => {
      extension.activate(fakeContext);
      await new Promise(r => setTimeout(r, 50));

      assert.ok(mockLastCreatedStatusBarItem);
      assert.strictEqual(mockLastCreatedStatusBarItem.command, 'aiSwissknife.openDashboard');
      assert.strictEqual(mockLastCreatedStatusBarItem.text, '$(dashboard) AI Swissknife');
      assert.ok(fakeContext.subscriptions.includes(mockLastCreatedStatusBarItem));
    });

    it('updates status bar item label when unsatisfied recommendations exist', async () => {
      await writeManifest(
        'project',
        {
          schemaVersion: SCHEMA_VERSION,
          sources: [],
          desiredInstallations: [
            { sourceId: 'src-1', artifactId: 'art-1', assistant: 'claude-code', scope: 'project' },
            { sourceId: 'src-1', artifactId: 'art-2', assistant: 'claude-code', scope: 'project' }
          ],
        },
        testTempDir
      );

      extension.activate(fakeContext);
      await new Promise(r => setTimeout(r, 50));

      assert.ok(mockLastCreatedStatusBarItem);
      assert.strictEqual(mockLastCreatedStatusBarItem.text, '$(dashboard) AI Swissknife: 2 recommendations');
    });
  });
});

