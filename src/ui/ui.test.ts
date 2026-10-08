import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';

// File-wide HOME sandbox. Several tests below build providers without an
// explicit homeRoot, so "global" scope falls back to os.homedir(). Without
// this, those tests read the developer's real ~/.ai-swissknife manifest and
// kick off real git fetches of its registered sources — which also made the
// suite flaky: a fetch started under the real HOME could still be running
// when a later test swapped HOME to its own temp dir, writing into it while
// afterEach was removing it (ENOTEMPTY).
const realHome = process.env.HOME;
const realUserProfile = process.env.USERPROFILE;
const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-swissknife-ui-sandbox-home-'));
process.env.HOME = sandboxHome;
process.env.USERPROFILE = sandboxHome;
before(() => {
  assert.strictEqual(os.homedir(), sandboxHome);
});
after(() => {
  for (const [key, value] of [['HOME', realHome], ['USERPROFILE', realUserProfile]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(sandboxHome, { recursive: true, force: true });
});

// Setup minimal mock for 'vscode' before importing UI modules in pure Node tests
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockQuickPickResult: any = undefined;
let mockLastWarningMessage: string | undefined = undefined;
let mockShowInformationMessageResult: string | undefined = undefined;
let mockShowInformationMessageCalls: { msg: string, actions: string[] }[] = [];
let mockLastCreatedStatusBarItem: any = undefined;
let mockLastStatusBarMessage: string | undefined = undefined;
let mockLastWebviewMessageListener: ((msg: any) => any) | undefined = undefined;

const mockRegisteredCommands = new Map<string, (...args: any[]) => any>();

let mockConfigUpdates: { section: string, value: any, target: any }[] = [];
let mockConfigGetResult: any = undefined;

let mockCustomShowQuickPick: ((items: any, options?: any) => Promise<any>) | undefined = undefined;
let mockCustomShowInputBox: ((options?: any) => Promise<any>) | undefined = undefined;
let mockCustomShowOpenDialog: ((options?: any) => Promise<any>) | undefined = undefined;
let mockCustomShowWarningMessage: ((msg: string, ...args: any[]) => Promise<any>) | undefined = undefined;
let mockShowErrorMessageCalls: string[] = [];
let mockCustomShowInformationMessage: ((msg: string, ...args: any[]) => Promise<any>) | undefined = undefined;

const mockVscode = {
  ProgressLocation: {
    SourceControl: 1,
    Window: 10,
    Notification: 15,
  },
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
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3
  },
  workspace: {
    get workspaceFolders() {
      return (globalThis as any).mockWorkspaceFolders || [];
    },
    getConfiguration: () => ({ 
      get: () => mockConfigGetResult,
      update: async (section: string, value: any, target: any) => {
        mockConfigUpdates.push({ section, value, target });
      }
    }),
    onDidChangeConfiguration: () => ({ dispose: () => {} }),
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
    showInformationMessage: async (msg: string, ...actions: any[]) => {
      mockShowInformationMessageCalls.push({ msg, actions });
      if (mockCustomShowInformationMessage) return mockCustomShowInformationMessage(msg, ...actions);
      return mockShowInformationMessageResult;
    },
    showWarningMessage: async (msg: string, ...args: any[]) => {
      mockLastWarningMessage = msg;
      if (mockCustomShowWarningMessage) return mockCustomShowWarningMessage(msg, ...args);
      return undefined;
    },
    showErrorMessage: async (msg: string) => {
      mockShowErrorMessageCalls.push(msg);
      return undefined;
    },
    createOutputChannel: (name: string) => ({
      name,
      append: () => {},
      appendLine: () => {},
      clear: () => {},
      show: () => {},
      hide: () => {},
      dispose: () => {},
    }),
    withProgress: async (_options: any, task: (progress: any) => Promise<any>) => {
      return await task({ report: () => {} });
    },
    showQuickPick: async (items: any, options?: any) => {
      if (mockCustomShowQuickPick) return mockCustomShowQuickPick(items, options);
      return mockQuickPickResult;
    },
    showInputBox: async (options?: any) => {
      if (mockCustomShowInputBox) return mockCustomShowInputBox(options);
      return undefined;
    },
    showOpenDialog: async (options?: any) => {
      if (mockCustomShowOpenDialog) return mockCustomShowOpenDialog(options);
      return undefined;
    },
    createWebviewPanel: () => {
      let msgListener: ((msg: any) => Promise<any>) | undefined;
      return {
        reveal: () => {},
        dispose: () => {},
        onDidDispose: () => ({ dispose: () => {} }),
        webview: {
          html: '',
          asWebviewUri: (uri: any) => 'vscode-webview-resource://' + uri.fsPath,
          onDidReceiveMessage: (handler: any) => {
            mockLastWebviewMessageListener = handler;
            msgListener = handler;
            return { dispose: () => {} };
          },
          postMessage: async (msg: any) => {
            if (msgListener) await msgListener(msg);
          },
        },
      };
    },
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
    setStatusBarMessage: (msg: string) => {
      mockLastStatusBarMessage = msg;
      return {
        dispose: () => {
          if (mockLastStatusBarMessage === msg) {
            mockLastStatusBarMessage = undefined;
          }
        },
      };
    },
  },
  commands: {
    registerCommand: (command: string, callback: (...args: any[]) => any) => {
      mockRegisteredCommands.set(command, callback);
      return { dispose: () => {} };
    },
    executeCommand: async (command: string, ...args: any[]) => {
      const handler = mockRegisteredCommands.get(command);
      if (handler) {
        return await handler(...args);
      }
      return undefined;
    },
  },
  Uri: {
    joinPath: (base: any, ...segments: string[]) => ({ fsPath: [base.fsPath, ...segments].join('/') }),
    file: (path: string) => ({ fsPath: path }),
    parse: (value: string) => ({ toString: () => value }),
  },
};

Module.prototype.require = function (id: string, ...rest: unknown[]) {
  if (id === 'vscode') {
    return mockVscode;
  }
  return originalRequire.apply(this, [id, ...rest]);
};

import type { ManagedInstallation, Source, Package, Artifact, Scope } from '../domain/types';
import {
  readManifest,
  writeManifest,
  readState,
  writeState,
  SCHEMA_VERSION,
} from '../domain/registry';
import { SourcesTreeDataProvider, ScopeGroupItem, SourceItem, promptScope } from './sourcesView';
import { AvailableTreeDataProvider, AvailableFolderItem, AvailableArtifactItem, buildHierarchy, AvailableSourceGroupItem } from './availableView';
import { ArtifactFileItem } from './artifactFileTree';
import { InstalledTreeDataProvider, ScopeGroupItem as InstalledScopeGroupItem, InstalledInstallationItem, KindGroupItem } from './installedView';
import { getAssistantIconPath } from './assistantIcons';
import { setupFileWatchers } from './watchers';
import { DashboardPanel, computeItemOrigin, getScopeLabel } from './dashboard';
import { FormEditorPanel } from './formEditor';
import { handleRecommendForWorkspace, handleUnrecommendForWorkspace } from '../extension';
import { RecommendedGroupItem, RecommendedBrokenItem } from './availableView';
import type { DesiredInstallation } from '../domain/registry';
import * as extensionModule from '../extension';
import * as driftModule from '../engine/drift';
import * as updateModule from '../engine/update';

describe('UI TreeDataProviders', () => {
  let testTempDir: string;
  let testHomeDir: string;

  beforeEach(async () => {
    testTempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-swissknife-ui-ws-'));
    testHomeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-swissknife-ui-home-'));
    (globalThis as any).mockWorkspaceFolders = [{ uri: { fsPath: testTempDir } }];
    mockQuickPickResult = undefined;
    mockCustomShowQuickPick = undefined;
    mockCustomShowInputBox = undefined;
    mockCustomShowOpenDialog = undefined;
    mockCustomShowWarningMessage = undefined;
    mockShowErrorMessageCalls = [];
    mockLastWarningMessage = undefined;
    mockShowInformationMessageResult = undefined;
    mockShowInformationMessageCalls = [];
    mockLastStatusBarMessage = undefined;
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

    describe('addSource wizard flow', () => {
      function createTestSourcesProvider() {
        const availableProvider = new AvailableTreeDataProvider({ fsPath: '/test/ext' } as any, testHomeDir);
        availableProvider.refreshCatalog = async () => {};
        const provider = new SourcesTreeDataProvider(availableProvider);
        return { provider, availableProvider };
      }

      it('follows prompt order: type -> scope -> location -> id -> name -> pin for git types', async () => {
        const { provider, availableProvider } = createTestSourcesProvider();
        let catalogRefreshed = false;
        availableProvider.refreshCatalog = async () => { catalogRefreshed = true; };

        const promptSequence: string[] = [];

        mockCustomShowQuickPick = async (items: any[], options?: any) => {
          if (options?.placeHolder?.includes('source type')) {
            promptSequence.push('quickPick:type');
            assert.strictEqual(items.length, 5);
            // Verify items use resolver displayName and icon
            const customGit = items.find((i) => i.type === 'git-custom');
            assert.ok(customGit);
            assert.ok(customGit.label.includes('Git (custom)'));
            assert.ok(customGit.iconPath);
            return customGit;
          }
          if (options?.placeHolder?.includes('source scope')) {
            promptSequence.push('quickPick:scope');
            assert.strictEqual(items.length, 2);
            assert.strictEqual(items[0].label, 'Global');
            assert.strictEqual(items[1].label, 'Workspace');
            return [items[1]]; // Workspace ('project')
          }
          if (options?.placeHolder?.includes('Pin to a branch')) {
            promptSequence.push('quickPick:pin');
            assert.strictEqual(items[0].label, 'Default branch');
            assert.strictEqual(items[1].label, 'Advanced: pin to branch/tag');
            return items[0]; // Default branch
          }
          throw new Error(`Unexpected QuickPick: ${options?.placeHolder}`);
        };

        mockCustomShowInputBox = async (options?: any) => {
          if (options?.prompt?.includes('Git repository URL')) {
            promptSequence.push('inputBox:location');
            return 'https://github.com/org/team-skills.git';
          }
          if (options?.prompt?.includes('unique identifier')) {
            promptSequence.push('inputBox:id');
            return options.value;
          }
          if (options?.prompt?.includes('display name')) {
            promptSequence.push('inputBox:name');
            return options.value;
          }
          throw new Error(`Unexpected InputBox: ${options?.prompt}`);
        };

        const result = await provider.addSource();
        assert.ok(result);
        assert.strictEqual(catalogRefreshed, true);
        assert.deepStrictEqual(promptSequence, [
          'quickPick:type',
          'quickPick:scope',
          'inputBox:location',
          'inputBox:id',
          'inputBox:name',
          'quickPick:pin',
        ]);
        assert.strictEqual(result.id, 'team-skills');
        assert.strictEqual(result.name, 'Team skills');
        assert.strictEqual(result.scope, 'project');
        assert.strictEqual(result.url, 'https://github.com/org/team-skills.git');
      });

      it('prefills id and name from https://github.com/org/team-skills.git', async () => {
        const { provider } = createTestSourcesProvider();

        let prefilledId: string | undefined;
        let prefilledName: string | undefined;

        mockCustomShowQuickPick = async (items: any[], options?: any) => {
          if (options?.placeHolder?.includes('source type')) {
            return items.find((i) => i.type === 'git-custom');
          }
          if (options?.placeHolder?.includes('source scope')) {
            return [items.find((i) => i.scope === 'project')];
          }
          if (options?.placeHolder?.includes('Pin to a branch')) {
            return items[0];
          }
          return undefined;
        };

        mockCustomShowInputBox = async (options?: any) => {
          if (options?.prompt?.includes('Git repository URL')) {
            return 'https://github.com/org/team-skills.git';
          }
          if (options?.prompt?.includes('unique identifier')) {
            prefilledId = options.value;
            return options.value;
          }
          if (options?.prompt?.includes('display name')) {
            prefilledName = options.value;
            return options.value;
          }
          return undefined;
        };

        const result = await provider.addSource();
        assert.ok(result);
        assert.strictEqual(prefilledId, 'team-skills');
        assert.strictEqual(prefilledName, 'Team skills');
        assert.strictEqual(result.id, 'team-skills');
        assert.strictEqual(result.name, 'Team skills');
      });

      it('forceScope skips the scope prompt', async () => {
        const { provider } = createTestSourcesProvider();

        const promptTypes: string[] = [];

        mockCustomShowQuickPick = async (items: any[], options?: any) => {
          if (options?.placeHolder?.includes('source type')) {
            promptTypes.push('type');
            return items.find((i) => i.type === 'git-custom');
          }
          if (options?.placeHolder?.includes('source scope')) {
            promptTypes.push('scope');
            return [items[0]];
          }
          if (options?.placeHolder?.includes('Pin to a branch')) {
            promptTypes.push('pin');
            return items[0];
          }
          return undefined;
        };

        mockCustomShowInputBox = async (options?: any) => {
          if (options?.prompt?.includes('Git repository URL')) {
            promptTypes.push('location');
            return 'https://github.com/org/team-skills.git';
          }
          if (options?.prompt?.includes('unique identifier')) {
            promptTypes.push('id');
            return options.value;
          }
          if (options?.prompt?.includes('display name')) {
            promptTypes.push('name');
            return options.value;
          }
          return undefined;
        };

        const result = await provider.addSource('project');
        assert.ok(result);
        assert.strictEqual(result.scope, 'project');
        // Assert scope prompt was never called
        assert.ok(!promptTypes.includes('scope'));
        assert.deepStrictEqual(promptTypes, ['type', 'location', 'id', 'name', 'pin']);
      });

      it('no workspace -> only Global offered with a one-line hint', async () => {
        (globalThis as any).mockWorkspaceFolders = [];

        let offeredItems: any[] = [];
        mockCustomShowQuickPick = async (items: any[], options?: any) => {
          if (options?.placeHolder?.includes('source scope')) {
            offeredItems = items;
            return [items[0]];
          }
          return undefined;
        };

        const scopes = await promptScope();
        assert.deepStrictEqual(scopes, ['global']);
        assert.strictEqual(offeredItems.length, 1);
        assert.strictEqual(offeredItems[0].label, 'Global');
        assert.strictEqual(offeredItems[0].scope, 'global');
        assert.ok(offeredItems[0].description, 'Expected one-line hint description');
        assert.ok(
          offeredItems[0].description.toLowerCase().includes('workspace') ||
          offeredItems[0].description.toLowerCase().includes('open')
        );
      });

      it('Esc at each step writes nothing and returns undefined', async () => {
        const { provider } = createTestSourcesProvider();

        // Steps: 0: cancel type, 1: cancel scope, 2: cancel location, 3: cancel id, 4: cancel name, 5: cancel pin
        for (let cancelStep = 0; cancelStep <= 7; cancelStep++) {
          mockCustomShowQuickPick = async (items: any[], options?: any) => {
            if (options?.placeHolder?.includes('source type')) {
              if (cancelStep === 0) return undefined;
              return items.find((i) => i.type === 'git-custom');
            }
            if (options?.placeHolder?.includes('source scope')) {
              if (cancelStep === 1) return undefined;
              return [items.find((i) => i.scope === 'project')];
            }
            if (options?.placeHolder?.includes('Pin to a branch')) {
              if (cancelStep === 5) return undefined;
              if (cancelStep === 6 || cancelStep === 7) return items[1]; // Advanced: pin to branch/tag
              return items[0];
            }
            if (options?.placeHolder?.includes('Pin to a specific branch')) {
              if (cancelStep === 6) return undefined;
              return items.find((i: any) => i.target === 'branch' || i.label === 'Specific branch');
            }
            return undefined;
          };

          mockCustomShowInputBox = async (options?: any) => {
            if (options?.prompt?.includes('Git repository URL')) {
              if (cancelStep === 2) return undefined;
              return 'https://github.com/org/team-skills.git';
            }
            if (options?.prompt?.includes('unique identifier')) {
              if (cancelStep === 3) return undefined;
              return options.value;
            }
            if (options?.prompt?.includes('display name')) {
              if (cancelStep === 4) return undefined;
              return options.value;
            }
            if (options?.prompt?.includes('Branch name')) {
              if (cancelStep === 7) return undefined;
              return 'main';
            }
            return undefined;
          };

          const res = await provider.addSource();
          assert.strictEqual(res, undefined, `Expected undefined on cancelStep ${cancelStep}`);

          const manifest = await readManifest('project', testTempDir);
          assert.strictEqual(manifest.sources.length, 0, `Expected 0 sources in manifest on cancelStep ${cancelStep}`);
        }
      });

      it('written DesiredSource equals what the old flow produced for the same answers', async () => {
        const { provider } = createTestSourcesProvider();

        // 1. Default branch source
        mockCustomShowQuickPick = async (items: any[], options?: any) => {
          if (options?.placeHolder?.includes('source type')) return items.find((i) => i.type === 'git-custom');
          if (options?.placeHolder?.includes('source scope')) return [items.find((i) => i.scope === 'project')];
          if (options?.placeHolder?.includes('Pin to a branch')) return items[0]; // Default branch
          return undefined;
        };
        mockCustomShowInputBox = async (options?: any) => {
          if (options?.prompt?.includes('Git repository URL')) return 'https://github.com/org/team-skills.git';
          if (options?.prompt?.includes('unique identifier')) return 'team-skills';
          if (options?.prompt?.includes('display name')) return 'Team skills';
          return undefined;
        };

        const res1 = await provider.addSource();
        assert.ok(res1);

        let manifest = await readManifest('project', testTempDir);
        assert.strictEqual(manifest.sources.length, 1);
        const source1 = manifest.sources[0];
        assert.deepStrictEqual(source1, {
          id: 'team-skills',
          type: 'git-custom',
          scope: 'project',
          name: 'Team skills',
          url: 'https://github.com/org/team-skills.git',
        });

        // 2. Advanced pin branch source
        mockCustomShowQuickPick = async (items: any[], options?: any) => {
          if (options?.placeHolder?.includes('source type')) return items.find((i) => i.type === 'git-custom');
          if (options?.placeHolder?.includes('source scope')) return [items.find((i) => i.scope === 'project')];
          if (options?.placeHolder?.includes('Pin to a branch')) return items[1]; // Advanced: pin to branch/tag
          if (options?.placeHolder?.includes('Pin to a specific branch')) return items.find((i: any) => i.target === 'branch' || i.label === 'Specific branch');
          return undefined;
        };
        mockCustomShowInputBox = async (options?: any) => {
          if (options?.prompt?.includes('Git repository URL')) return 'https://github.com/org/team-skills.git';
          if (options?.prompt?.includes('unique identifier')) return 'team-skills-pinned';
          if (options?.prompt?.includes('display name')) return 'Team Skills Pinned';
          if (options?.prompt?.includes('Branch name')) return 'feature-branch';
          return undefined;
        };

        const res2 = await provider.addSource();
        assert.ok(res2);

        manifest = await readManifest('project', testTempDir);
        const source2 = manifest.sources.find((s) => s.id === 'team-skills-pinned');
        assert.ok(source2);
        assert.deepStrictEqual(source2, {
          id: 'team-skills-pinned',
          type: 'git-custom',
          scope: 'project',
          name: 'Team Skills Pinned',
          url: 'https://github.com/org/team-skills.git',
          branch: 'feature-branch',
        });

        // 3. Tag pin source
        mockCustomShowQuickPick = async (items: any[], options?: any) => {
          if (options?.placeHolder?.includes('source type')) return items.find((i) => i.type === 'git-custom');
          if (options?.placeHolder?.includes('source scope')) return [items.find((i) => i.scope === 'project')];
          if (options?.placeHolder?.includes('Pin to a branch')) return items[1]; // Advanced
          if (options?.placeHolder?.includes('Pin to a specific branch')) return items.find((i: any) => i.target === 'tag' || i.label === 'Specific tag');
          return undefined;
        };
        mockCustomShowInputBox = async (options?: any) => {
          if (options?.prompt?.includes('Git repository URL')) return 'https://github.com/org/team-skills.git';
          if (options?.prompt?.includes('unique identifier')) return 'team-skills-tag';
          if (options?.prompt?.includes('display name')) return 'Team Skills Tag';
          if (options?.prompt?.includes('Tag name')) return 'v1.2.3';
          return undefined;
        };

        const res3 = await provider.addSource();
        assert.ok(res3);

        manifest = await readManifest('project', testTempDir);
        const source3 = manifest.sources.find((s) => s.id === 'team-skills-tag');
        assert.ok(source3);
        assert.deepStrictEqual(source3, {
          id: 'team-skills-tag',
          type: 'git-custom',
          scope: 'project',
          name: 'Team Skills Tag',
          url: 'https://github.com/org/team-skills.git',
          tag: 'v1.2.3',
        });
      });

      it('the pin step is prompted only for git types', async () => {
        const { provider } = createTestSourcesProvider();

        let pinPromptCalled = false;
        mockCustomShowQuickPick = async (items: any[], options?: any) => {
          if (options?.placeHolder?.includes('source type')) return items.find((i) => i.type === 'remote-url');
          if (options?.placeHolder?.includes('source scope')) return [items.find((i) => i.scope === 'project')];
          if (options?.placeHolder?.includes('Pin to a branch')) {
            pinPromptCalled = true;
            return items[0];
          }
          return undefined;
        };
        mockCustomShowInputBox = async (options?: any) => {
          if (options?.prompt?.includes('artifact URL')) return 'https://example.com/raw/skill.md';
          if (options?.prompt?.includes('unique identifier')) return options.value;
          if (options?.prompt?.includes('display name')) return options.value;
          return undefined;
        };

        const res = await provider.addSource();
        assert.ok(res);
        assert.strictEqual(res.type, 'remote-url');
        assert.strictEqual(pinPromptCalled, false, 'Pin step should not be called for remote-url');
      });

      it('supports local-folder via folder picker and typed path', async () => {
        const { provider } = createTestSourcesProvider();

        // 1. Browse folder picker path
        let openDialogOptions: any;
        mockCustomShowQuickPick = async (items: any[], options?: any) => {
          if (options?.placeHolder?.includes('source type')) return items.find((i) => i.type === 'local-folder');
          if (options?.placeHolder?.includes('source scope')) return [items.find((i) => i.scope === 'project')];
          if (options?.placeHolder?.includes('Select folder or enter path')) {
            return items.find((i) => i.action === 'browse' || i.label.includes('Browse'));
          }
          return undefined;
        };
        mockCustomShowOpenDialog = async (options?: any) => {
          openDialogOptions = options;
          return [{ fsPath: path.join(testTempDir, 'local-skills') }];
        };
        mockCustomShowInputBox = async (options?: any) => {
          if (options?.prompt?.includes('unique identifier')) {
            assert.strictEqual(options.value, 'local-skills');
            return options.value;
          }
          if (options?.prompt?.includes('display name')) {
            assert.strictEqual(options.value, 'Local skills');
            return options.value;
          }
          return undefined;
        };

        const res1 = await provider.addSource();
        assert.ok(res1);
        assert.strictEqual(openDialogOptions.canSelectFolders, true);
        assert.strictEqual(openDialogOptions.canSelectFiles, false);
        assert.strictEqual(res1.localPath, path.join(testTempDir, 'local-skills'));

        // 2. Manual path typing with validation
        let validateFn: ((v: string) => string | null) | undefined;
        mockCustomShowQuickPick = async (items: any[], options?: any) => {
          if (options?.placeHolder?.includes('source type')) return items.find((i) => i.type === 'local-folder');
          if (options?.placeHolder?.includes('source scope')) return [items.find((i) => i.scope === 'project')];
          if (options?.placeHolder?.includes('Select folder or enter path')) {
            return items.find((i) => i.action === 'type' || i.label.includes('Enter path'));
          }
          return undefined;
        };
        mockCustomShowInputBox = async (options?: any) => {
          if (options?.prompt?.includes('Local folder path')) {
            validateFn = options.validateInput;
            assert.ok(validateFn);
            assert.strictEqual(validateFn('https://invalid.com'), 'Local folder path cannot be a URL');
            assert.strictEqual(validateFn('valid/sub/folder'), null);
            return path.join(testTempDir, 'typed-skills');
          }
          if (options?.prompt?.includes('unique identifier')) return 'typed-skills';
          if (options?.prompt?.includes('display name')) return 'Typed skills';
          return undefined;
        };

        const res2 = await provider.addSource();
        assert.ok(res2);
        assert.strictEqual(res2.localPath, path.join(testTempDir, 'typed-skills'));
      });

      it('both scopes with two different local paths write two manifests with the same id and different localPath', async () => {
        const { provider } = createTestSourcesProvider();

        const globalLocal = path.join(os.homedir(), 'global-folder');
        const wsLocal = path.join(testTempDir, 'ws-folder');

        mockCustomShowQuickPick = async (items: any[], options?: any) => {
          if (options?.placeHolder?.includes('source type')) {
            return items.find((i) => i.type === 'local-folder');
          }
          if (options?.placeHolder?.includes('source scope')) {
            return [items[0], items[1]];
          }
          if (options?.placeHolder?.includes('Select folder or enter path')) {
            return items.find((i) => i.action === 'type');
          }
          return undefined;
        };

        mockCustomShowInputBox = async (options?: any) => {
          if (options?.prompt?.includes('Local folder path for Global scope')) {
            return globalLocal;
          }
          if (options?.prompt?.includes('Local folder path for Workspace scope')) {
            return wsLocal;
          }
          if (options?.prompt?.includes('unique identifier')) {
            assert.strictEqual(options.value, 'global-folder');
            return 'both-scopes-skills';
          }
          if (options?.prompt?.includes('display name')) {
            return 'Both Scopes Skills';
          }
          return undefined;
        };

        const res = await provider.addSource();
        assert.ok(res);
        assert.strictEqual(res.id, 'both-scopes-skills');
        assert.strictEqual(res.scope, 'global');

        // Check global manifest
        const globalManifest = await readManifest('global');
        const gSource = globalManifest.sources.find((s) => s.id === 'both-scopes-skills');
        assert.ok(gSource);
        assert.strictEqual(gSource.type, 'local-folder');
        assert.strictEqual(gSource.scope, 'global');
        assert.strictEqual(gSource.name, 'Both Scopes Skills');
        assert.strictEqual(gSource.localPath, 'global-folder');

        // Check workspace manifest
        const wsManifest = await readManifest('project', testTempDir);
        const wsSource = wsManifest.sources.find((s) => s.id === 'both-scopes-skills');
        assert.ok(wsSource);
        assert.strictEqual(wsSource.type, 'local-folder');
        assert.strictEqual(wsSource.scope, 'project');
        assert.strictEqual(wsSource.name, 'Both Scopes Skills');
        assert.strictEqual(wsSource.localPath, 'ws-folder');

        // Same ID, different localPath
        assert.strictEqual(gSource.id, wsSource.id);
        assert.notStrictEqual(gSource.localPath, wsSource.localPath);
      });

      it('workspace path outside the workspace is rejected at input time', async () => {
        const { provider } = createTestSourcesProvider();

        let validateCalled = false;
        mockCustomShowQuickPick = async (items: any[], options?: any) => {
          if (options?.placeHolder?.includes('source type')) return items.find((i) => i.type === 'local-folder');
          if (options?.placeHolder?.includes('source scope')) return [items.find((i) => i.scope === 'project')];
          if (options?.placeHolder?.includes('Select folder or enter path')) {
            return items.find((i) => i.action === 'type');
          }
          return undefined;
        };

        mockCustomShowInputBox = async (options?: any) => {
          if (options?.prompt?.includes('Local folder path')) {
            const validate = options.validateInput;
            assert.ok(validate);
            validateCalled = true;

            const outsidePath = '/completely/outside/directory';
            const outsideErr = validate(outsidePath);
            assert.strictEqual(typeof outsideErr, 'string');
            assert.ok(outsideErr.includes('outside workspace root'));

            const relativeOutside = '../../outside/directory';
            const relErr = validate(relativeOutside);
            assert.strictEqual(typeof relErr, 'string');
            assert.ok(relErr.includes('outside workspace root'));

            assert.strictEqual(validate(path.join(testTempDir, 'valid-dir')), null);
            assert.strictEqual(validate('valid/relative/path'), null);

            return path.join(testTempDir, 'valid-dir');
          }
          if (options?.prompt?.includes('unique identifier')) return 'valid-ws-source';
          if (options?.prompt?.includes('display name')) return 'Valid WS Source';
          return undefined;
        };

        const res = await provider.addSource();
        assert.ok(res);
        assert.strictEqual(validateCalled, true);
      });

      it('global-only and workspace-only multi-scope choices still work', async () => {
        const { provider } = createTestSourcesProvider();

        // 1. Global only
        mockCustomShowQuickPick = async (items: any[], options?: any) => {
          if (options?.placeHolder?.includes('source type')) return items.find((i) => i.type === 'remote-url');
          if (options?.placeHolder?.includes('source scope')) return [items[0]]; // Global
          return undefined;
        };
        mockCustomShowInputBox = async (options?: any) => {
          if (options?.prompt?.includes('artifact URL')) return 'https://example.com/global-skill.md';
          if (options?.prompt?.includes('unique identifier')) return 'global-only-src';
          if (options?.prompt?.includes('display name')) return 'Global Only Src';
          return undefined;
        };

        const gRes = await provider.addSource();
        assert.ok(gRes);
        assert.strictEqual(gRes.scope, 'global');
        const gManifest = await readManifest('global');
        assert.ok(gManifest.sources.some((s) => s.id === 'global-only-src'));
        const wsManifest1 = await readManifest('project', testTempDir);
        assert.strictEqual(wsManifest1.sources.some((s) => s.id === 'global-only-src'), false);

        // 2. Workspace only
        mockCustomShowQuickPick = async (items: any[], options?: any) => {
          if (options?.placeHolder?.includes('source type')) return items.find((i) => i.type === 'remote-url');
          if (options?.placeHolder?.includes('source scope')) return [items[1]]; // Workspace
          return undefined;
        };
        mockCustomShowInputBox = async (options?: any) => {
          if (options?.prompt?.includes('artifact URL')) return 'https://example.com/ws-skill.md';
          if (options?.prompt?.includes('unique identifier')) return 'ws-only-src';
          if (options?.prompt?.includes('display name')) return 'WS Only Src';
          return undefined;
        };

        const wsRes = await provider.addSource();
        assert.ok(wsRes);
        assert.strictEqual(wsRes.scope, 'project');
        const wsManifest2 = await readManifest('project', testTempDir);
        assert.ok(wsManifest2.sources.some((s) => s.id === 'ws-only-src'));
      });

      it('second-write failure message names the scope and does not rollback first write', async () => {
        const { provider } = createTestSourcesProvider();

        mockCustomShowQuickPick = async (items: any[], options?: any) => {
          if (options?.placeHolder?.includes('source type')) return items.find((i) => i.type === 'git-custom');
          if (options?.placeHolder?.includes('source scope')) return [items[0], items[1]]; // Global and Workspace
          if (options?.placeHolder?.includes('Pin to a branch')) return items[0];
          return undefined;
        };
        mockCustomShowInputBox = async (options?: any) => {
          if (options?.prompt?.includes('Git repository URL')) return 'https://github.com/org/fail-test.git';
          if (options?.prompt?.includes('unique identifier')) return 'fail-scope-test';
          if (options?.prompt?.includes('display name')) return 'Fail Scope Test';
          return undefined;
        };

        // Create .vscode as a regular file so writeManifest for project scope fails
        fs.writeFileSync(path.join(testTempDir, '.vscode'), 'not a directory');

        const res = await provider.addSource();
        assert.ok(res);
        assert.strictEqual(res.id, 'fail-scope-test');
        assert.strictEqual(res.scope, 'global');

        // First write (Global) must NOT have rolled back
        const gManifest = await readManifest('global');
        assert.ok(gManifest.sources.some((s) => s.id === 'fail-scope-test'));

        // Error message must name the failed scope (Workspace) and the succeeded scope (Global)
        assert.ok(mockShowErrorMessageCalls.length > 0);
        const lastErr = mockShowErrorMessageCalls[mockShowErrorMessageCalls.length - 1];
        assert.ok(lastErr.includes('Workspace'));
        assert.ok(lastErr.includes('Global'));
      });

      it('duplicate id prompts modal and respects No (skipping that scope only)', async () => {
        const { provider } = createTestSourcesProvider();

        await writeManifest('global', {
          schemaVersion: SCHEMA_VERSION,
          sources: [
            {
              id: 'dup-id',
              type: 'git-custom',
              scope: 'global',
              url: 'https://github.com/org/original-global.git',
            },
          ],
          desiredInstallations: [],
        });

        let warningPrompted = false;
        mockCustomShowQuickPick = async (items: any[], options?: any) => {
          if (options?.placeHolder?.includes('source type')) return items.find((i) => i.type === 'remote-url');
          if (options?.placeHolder?.includes('source scope')) return [items[0], items[1]]; // Both Global and Workspace
          return undefined;
        };
        mockCustomShowInputBox = async (options?: any) => {
          if (options?.prompt?.includes('artifact URL')) return 'https://example.com/new.md';
          if (options?.prompt?.includes('unique identifier')) return 'dup-id';
          if (options?.prompt?.includes('display name')) return 'Dup Source';
          return undefined;
        };
        mockCustomShowWarningMessage = async (msg: string, ...args: any[]) => {
          warningPrompted = true;
          assert.ok(msg.includes('dup-id'));
          assert.ok(msg.includes('Global'));
          assert.ok(args[0]?.modal === true);
          return 'No'; // Skip Global
        };

        const res = await provider.addSource();
        assert.ok(res);
        assert.strictEqual(res.id, 'dup-id');
        assert.strictEqual(res.scope, 'project');
        assert.strictEqual(warningPrompted, true);

        // Global manifest still has the original source
        const gManifest = await readManifest('global');
        const gSource = gManifest.sources.find((s) => s.id === 'dup-id');
        assert.ok(gSource);
        assert.strictEqual(gSource.url, 'https://github.com/org/original-global.git');

        // Workspace manifest has the new source
        const wsManifest = await readManifest('project', testTempDir);
        const wsSource = wsManifest.sources.find((s) => s.id === 'dup-id');
        assert.ok(wsSource);
        assert.strictEqual(wsSource.url, 'https://example.com/new.md');
      });

      it('duplicate id prompts modal and replaces when confirmed with Replace', async () => {
        const { provider } = createTestSourcesProvider();

        await writeManifest('project', {
          schemaVersion: SCHEMA_VERSION,
          sources: [
            {
              id: 'replace-me',
              type: 'remote-url',
              scope: 'project',
              url: 'https://example.com/old.md',
            },
          ],
          desiredInstallations: [],
        }, testTempDir);

        mockCustomShowQuickPick = async (items: any[], options?: any) => {
          if (options?.placeHolder?.includes('source type')) return items.find((i) => i.type === 'remote-url');
          if (options?.placeHolder?.includes('source scope')) return [items[1]]; // Workspace
          return undefined;
        };
        mockCustomShowInputBox = async (options?: any) => {
          if (options?.prompt?.includes('artifact URL')) return 'https://example.com/new-replaced.md';
          if (options?.prompt?.includes('unique identifier')) return 'replace-me';
          if (options?.prompt?.includes('display name')) return 'Replaced Source';
          return undefined;
        };
        mockCustomShowWarningMessage = async (msg: string, ...args: any[]) => {
          assert.ok(msg.includes('replace-me'));
          assert.ok(msg.includes('Workspace'));
          assert.ok(args[0]?.modal === true);
          return 'Replace';
        };

        const res = await provider.addSource();
        assert.ok(res);
        assert.strictEqual(res.id, 'replace-me');
        assert.strictEqual(res.url, 'https://example.com/new-replaced.md');

        const wsManifest = await readManifest('project', testTempDir);
        assert.strictEqual(wsManifest.sources.length, 1);
        assert.strictEqual(wsManifest.sources[0].url, 'https://example.com/new-replaced.md');
      });
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

    it('resolveArtifactById finds the correct artifact by sourceId, scope and artifactId', async () => {
      const provider = new AvailableTreeDataProvider({ fsPath: '/test/ext' } as any, testHomeDir);
      const source1: Source = { id: 's1', type: 'git-custom', scope: 'project' };
      const artifact1: Artifact = { id: 'a1', packageId: 'p1', kind: 'skill', name: 'art1', nativeFormat: 'md' };
      const pkg1: Package = { id: 'p1', sourceId: 's1', nativeFormat: 'raw', artifacts: [artifact1] };
      
      provider['cachedSourceGroups'] = [
        new AvailableSourceGroupItem(source1, { packages: [pkg1], diagnostics: [] }),
      ];

      const found = provider.resolveArtifactById('s1', 'project', 'a1');
      assert.ok(found);
      assert.strictEqual(found!.artifact.name, 'art1');

      const notFoundScope = provider.resolveArtifactById('s1', 'global', 'a1');
      assert.strictEqual(notFoundScope, undefined);

      const notFoundId = provider.resolveArtifactById('s1', 'project', 'a2');
      assert.strictEqual(notFoundId, undefined);
    });

    it('doInstallFolder safely aborts if the target folderPath is not found via buildHierarchy', async () => {
      const provider = new AvailableTreeDataProvider({ fsPath: '/test/ext' } as any, testHomeDir);
      const source1: Source = { id: 's1', type: 'git-custom', scope: 'project' };
      const artifact1: Artifact = { id: 'a1', packageId: 's1:pkg1/sub', kind: 'skill', name: 'art1', nativeFormat: 'md' };
      const pkg1: Package = { id: 's1:pkg1/sub', sourceId: 's1', nativeFormat: 'raw', artifacts: [artifact1] };
      
      provider['cachedSourceGroups'] = [
        new AvailableSourceGroupItem(source1, { packages: [pkg1], diagnostics: [] }),
      ];

      mockLastWarningMessage = undefined as string | undefined;
      await provider.doInstallFolder('s1', 'project', 'nonexistent/folder');
      assert.ok((mockLastWarningMessage as string | undefined)?.includes('Folder "nonexistent/folder" not found'), 'Should warn if folder is missing');
    });

    describe('refreshSource', () => {
      it('refreshing A calls A\'s resolver once and never B\'s', async () => {
        await writeManifest(
          'project',
          {
            schemaVersion: SCHEMA_VERSION,
            sources: [
              { id: 'sourceA', type: 'git-custom', scope: 'project', url: 'https://example.com/a.git' },
              { id: 'sourceB', type: 'git-custom', scope: 'project', url: 'https://example.com/b.git' },
            ],
            desiredInstallations: [],
          },
          testTempDir
        );

        const provider = new AvailableTreeDataProvider({ fsPath: '/test/ext' } as any, testHomeDir);
        const resolvedSources: string[] = [];
        (provider as any).resolveSourceGroup = async (src: Source) => {
          resolvedSources.push(src.id);
          const pkg: Package = { id: `p-${src.id}`, sourceId: src.id, nativeFormat: 'raw', artifacts: [] };
          return {
            group: new AvailableSourceGroupItem(src, { packages: [pkg], diagnostics: [] }),
            attempt: { status: 'resolved', source: src, packages: [pkg] },
          };
        };

        const srcA: Source = { id: 'sourceA', type: 'git-custom', scope: 'project', url: 'https://example.com/a.git' };
        const srcB: Source = { id: 'sourceB', type: 'git-custom', scope: 'project', url: 'https://example.com/b.git' };
        provider['cachedSourceGroups'] = [
          new AvailableSourceGroupItem(srcA, { packages: [], diagnostics: [] }),
          new AvailableSourceGroupItem(srcB, { packages: [], diagnostics: [] }),
        ];

        await provider.refreshSource('sourceA', 'project');

        assert.strictEqual(resolvedSources.length, 1);
        assert.strictEqual(resolvedSources[0], 'sourceA');
        assert.strictEqual(resolvedSources.includes('sourceB'), false);
      });

      it('group order unchanged when replacing refreshed source in place', async () => {
        await writeManifest(
          'project',
          {
            schemaVersion: SCHEMA_VERSION,
            sources: [
              { id: 'sourceA', type: 'git-custom', scope: 'project', url: 'https://example.com/a.git' },
              { id: 'sourceB', type: 'git-custom', scope: 'project', url: 'https://example.com/b.git' },
              { id: 'sourceC', type: 'git-custom', scope: 'project', url: 'https://example.com/c.git' },
            ],
            desiredInstallations: [],
          },
          testTempDir
        );

        const provider = new AvailableTreeDataProvider({ fsPath: '/test/ext' } as any, testHomeDir);
        (provider as any).resolveSourceGroup = async (src: Source) => {
          const pkg: Package = { id: `p-${src.id}-new`, sourceId: src.id, nativeFormat: 'raw', artifacts: [] };
          return {
            group: new AvailableSourceGroupItem(src, { packages: [pkg], diagnostics: [] }),
            attempt: { status: 'resolved', source: src, packages: [pkg] },
          };
        };

        const srcA: Source = { id: 'sourceA', type: 'git-custom', scope: 'project' };
        const srcB: Source = { id: 'sourceB', type: 'git-custom', scope: 'project' };
        const srcC: Source = { id: 'sourceC', type: 'git-custom', scope: 'project' };

        const groupA = new AvailableSourceGroupItem(srcA, { packages: [], diagnostics: [] });
        const groupB = new AvailableSourceGroupItem(srcB, { packages: [], diagnostics: [] });
        const groupC = new AvailableSourceGroupItem(srcC, { packages: [], diagnostics: [] });

        provider['cachedSourceGroups'] = [groupA, groupB, groupC];

        await provider.refreshSource('sourceB', 'project');

        const groups = provider.getCachedSourceGroups();
        assert.strictEqual(groups.length, 3);
        assert.strictEqual(groups[0].source.id, 'sourceA');
        assert.strictEqual(groups[1].source.id, 'sourceB');
        assert.strictEqual(groups[2].source.id, 'sourceC');
        // Group A and C are the exact same instances; Group B is updated in place
        assert.strictEqual(groups[0], groupA);
        assert.notStrictEqual(groups[1], groupB);
        assert.strictEqual(groups[1].resolution.packages[0].id, 'p-sourceB-new');
        assert.strictEqual(groups[2], groupC);
      });

      it('a failing resolve leaves a diagnostic group for that source only', async () => {
        await writeManifest(
          'project',
          {
            schemaVersion: SCHEMA_VERSION,
            sources: [
              { id: 'sourceA', type: 'git-custom', scope: 'project', url: 'https://example.com/a.git' },
              { id: 'sourceB', type: 'git-custom', scope: 'project', url: 'https://example.com/b.git' },
            ],
            desiredInstallations: [],
          },
          testTempDir
        );

        const provider = new AvailableTreeDataProvider({ fsPath: '/test/ext' } as any, testHomeDir);
        (provider as any).resolveSourceGroup = async (src: Source) => {
          if (src.id === 'sourceA') {
            return {
              group: new AvailableSourceGroupItem(src, {
                packages: [],
                diagnostics: [
                  {
                    code: 'unreadable-skill',
                    severity: 'error',
                    path: src.id,
                    message: 'Network timeout',
                  },
                ],
              }),
              attempt: { status: 'failed', source: src, error: 'Network timeout' },
            };
          }
          const pkg: Package = { id: `p-${src.id}`, sourceId: src.id, nativeFormat: 'raw', artifacts: [] };
          return {
            group: new AvailableSourceGroupItem(src, { packages: [pkg], diagnostics: [] }),
            attempt: { status: 'resolved', source: src, packages: [pkg] },
          };
        };

        const srcA: Source = { id: 'sourceA', type: 'git-custom', scope: 'project' };
        const srcB: Source = { id: 'sourceB', type: 'git-custom', scope: 'project' };
        const pkgB: Package = { id: 'p-b', sourceId: 'sourceB', nativeFormat: 'raw', artifacts: [] };
        const groupB = new AvailableSourceGroupItem(srcB, { packages: [pkgB], diagnostics: [] });

        provider['cachedSourceGroups'] = [
          new AvailableSourceGroupItem(srcA, { packages: [], diagnostics: [] }),
          groupB,
        ];

        await provider.refreshSource('sourceA', 'project');

        const groups = provider.getCachedSourceGroups();
        assert.strictEqual(groups.length, 2);
        assert.strictEqual(groups[0].source.id, 'sourceA');
        assert.strictEqual(groups[0].resolution.diagnostics.length, 1);
        assert.strictEqual(groups[0].resolution.diagnostics[0].message, 'Network timeout');
        assert.strictEqual(groups[0].resolution.packages.length, 0);

        // Source B is untouched
        assert.strictEqual(groups[1], groupB);
        assert.strictEqual(groups[1].resolution.diagnostics.length, 0);
        assert.strictEqual(groups[1].resolution.packages.length, 1);

        const attemptA = provider['resolutionAttempts'].get('sourceA');
        assert.ok(attemptA);
        assert.strictEqual(attemptA!.status, 'failed');
        assert.strictEqual((attemptA as any).error, 'Network timeout');
      });

      it('removed source disappears from cache, attempts, and tree', async () => {
        // Manifest only has sourceB; sourceA was deleted
        await writeManifest(
          'project',
          {
            schemaVersion: SCHEMA_VERSION,
            sources: [
              { id: 'sourceB', type: 'git-custom', scope: 'project', url: 'https://example.com/b.git' },
            ],
            desiredInstallations: [
              { sourceId: 'sourceA', artifactId: 'artA', assistant: 'claude-code', scope: 'project' },
            ],
          },
          testTempDir
        );

        const provider = new AvailableTreeDataProvider({ fsPath: '/test/ext' } as any, testHomeDir);
        const srcA: Source = { id: 'sourceA', type: 'git-custom', scope: 'project' };
        const srcB: Source = { id: 'sourceB', type: 'git-custom', scope: 'project' };

        provider['cachedSourceGroups'] = [
          new AvailableSourceGroupItem(srcA, { packages: [], diagnostics: [] }),
          new AvailableSourceGroupItem(srcB, { packages: [], diagnostics: [] }),
        ];
        provider['resolutionAttempts'].set('sourceA', { status: 'resolved', source: srcA, packages: [] });
        provider['resolutionAttempts'].set('sourceB', { status: 'resolved', source: srcB, packages: [] });

        let refreshedFired = false;
        provider.onDidChangeTreeData(() => {
          refreshedFired = true;
        });

        await provider.refreshSource('sourceA', 'project');

        assert.strictEqual(refreshedFired, true);
        const groups = provider.getCachedSourceGroups();
        assert.strictEqual(groups.length, 1);
        assert.strictEqual(groups[0].source.id, 'sourceB');
        assert.strictEqual(provider['resolutionAttempts'].has('sourceA'), false);

        // Recommendation for sourceA is now broken because sourceA is no longer registered
        const recGroup = provider.getCachedRecommendedGroup();
        assert.ok(recGroup);
        assert.strictEqual(recGroup!.pending.length, 0);
        assert.strictEqual(recGroup!.broken.length, 1);
        assert.strictEqual(recGroup!.broken[0].reason.kind, 'source-not-registered');
      });

      it('same id in both scopes refreshes only the requested scope', async () => {
        await writeManifest(
          'global',
          {
            schemaVersion: SCHEMA_VERSION,
            sources: [
              { id: 's1', type: 'git-custom', scope: 'global', url: 'https://example.com/global-s1.git' },
            ],
            desiredInstallations: [],
          },
          undefined,
          testHomeDir
        );

        await writeManifest(
          'project',
          {
            schemaVersion: SCHEMA_VERSION,
            sources: [
              { id: 's1', type: 'git-custom', scope: 'project', url: 'https://example.com/proj-s1.git' },
            ],
            desiredInstallations: [],
          },
          testTempDir
        );

        const provider = new AvailableTreeDataProvider({ fsPath: '/test/ext' } as any, testHomeDir);
        const resolvedSources: { id: string; scope: Scope }[] = [];
        (provider as any).resolveSourceGroup = async (src: Source) => {
          resolvedSources.push({ id: src.id, scope: src.scope });
          const pkg: Package = { id: `p-${src.id}-${src.scope}-updated`, sourceId: src.id, nativeFormat: 'raw', artifacts: [] };
          return {
            group: new AvailableSourceGroupItem(src, { packages: [pkg], diagnostics: [] }),
            attempt: { status: 'resolved', source: src, packages: [pkg] },
          };
        };

        const globalSrc: Source = { id: 's1', type: 'git-custom', scope: 'global' };
        const projSrc: Source = { id: 's1', type: 'git-custom', scope: 'project' };
        const globalGroup = new AvailableSourceGroupItem(globalSrc, { packages: [], diagnostics: [] });
        const projGroup = new AvailableSourceGroupItem(projSrc, { packages: [], diagnostics: [] });

        provider['cachedSourceGroups'] = [globalGroup, projGroup];

        await provider.refreshSource('s1', 'project');

        assert.strictEqual(resolvedSources.length, 1);
        assert.strictEqual(resolvedSources[0].id, 's1');
        assert.strictEqual(resolvedSources[0].scope, 'project');

        const groups = provider.getCachedSourceGroups();
        assert.strictEqual(groups.length, 2);
        // Global group is untouched
        assert.strictEqual(groups[0], globalGroup);
        // Project group is replaced with updated group
        assert.notStrictEqual(groups[1], projGroup);
        assert.strictEqual(groups[1].resolution.packages[0].id, 'p-s1-project-updated');
      });

      it('Recommended group recomputed (a pending recommendation for A flips when A\'s resolution changes)', async () => {
        await writeManifest(
          'project',
          {
            schemaVersion: SCHEMA_VERSION,
            sources: [
              { id: 'sourceA', type: 'git-custom', scope: 'project', url: 'https://example.com/a.git' },
            ],
            desiredInstallations: [
              { sourceId: 'sourceA', artifactId: 'artA', assistant: 'claude-code', scope: 'project' },
            ],
          },
          testTempDir
        );

        const provider = new AvailableTreeDataProvider({ fsPath: '/test/ext' } as any, testHomeDir);

        // Phase 1: sourceA resolves WITH artA -> pending
        let includeArtifact = true;
        (provider as any).resolveSourceGroup = async (src: Source) => {
          const art: Artifact = { id: 'artA', packageId: 'pA', kind: 'skill', name: 'artA', nativeFormat: 'md' };
          const pkg: Package = {
            id: 'pA',
            sourceId: src.id,
            nativeFormat: 'raw',
            artifacts: includeArtifact ? [art] : [],
          };
          return {
            group: new AvailableSourceGroupItem(src, { packages: [pkg], diagnostics: [] }),
            attempt: { status: 'resolved', source: src, packages: [pkg] },
          };
        };

        await provider.refreshSource('sourceA', 'project');

        let recGroup = provider.getCachedRecommendedGroup();
        assert.ok(recGroup);
        assert.strictEqual(recGroup!.pending.length, 1);
        assert.strictEqual(recGroup!.broken.length, 0);
        assert.strictEqual(recGroup!.pending[0].desired.artifactId, 'artA');

        // Phase 2: sourceA resolution no longer contains artA -> flips to broken (artifact-not-found)
        includeArtifact = false;
        await provider.refreshSource('sourceA', 'project');

        recGroup = provider.getCachedRecommendedGroup();
        assert.ok(recGroup);
        assert.strictEqual(recGroup!.pending.length, 0);
        assert.strictEqual(recGroup!.broken.length, 1);
        assert.strictEqual(recGroup!.broken[0].reason.kind, 'artifact-not-found');

        // Phase 3: sourceA resolution recovers with artA -> flips back to pending
        includeArtifact = true;
        await provider.refreshSource('sourceA', 'project');

        recGroup = provider.getCachedRecommendedGroup();
        assert.ok(recGroup);
        assert.strictEqual(recGroup!.pending.length, 1);
        assert.strictEqual(recGroup!.broken.length, 0);
      });

      it('concurrent refreshSource(A) calls resolve once', async () => {
        await writeManifest(
          'project',
          {
            schemaVersion: SCHEMA_VERSION,
            sources: [
              { id: 'sourceA', type: 'git-custom', scope: 'project', url: 'https://example.com/a.git' },
            ],
            desiredInstallations: [],
          },
          testTempDir
        );

        const provider = new AvailableTreeDataProvider({ fsPath: '/test/ext' } as any, testHomeDir);
        let resolveCount = 0;
        (provider as any).resolveSourceGroup = async (src: Source) => {
          resolveCount++;
          await new Promise((resolve) => setTimeout(resolve, 20));
          const pkg: Package = { id: `p-${src.id}`, sourceId: src.id, nativeFormat: 'raw', artifacts: [] };
          return {
            group: new AvailableSourceGroupItem(src, { packages: [pkg], diagnostics: [] }),
            attempt: { status: 'resolved', source: src, packages: [pkg] },
          };
        };

        await Promise.all([
          provider.refreshSource('sourceA', 'project'),
          provider.refreshSource('sourceA', 'project'),
          provider.refreshSource('sourceA', 'project'),
        ]);

        assert.strictEqual(resolveCount, 1);
      });

      it('refreshSource awaits in-flight full refresh', async () => {
        await writeManifest(
          'project',
          {
            schemaVersion: SCHEMA_VERSION,
            sources: [
              { id: 'sourceA', type: 'git-custom', scope: 'project', url: 'https://example.com/a.git' },
            ],
            desiredInstallations: [],
          },
          testTempDir
        );

        const provider = new AvailableTreeDataProvider({ fsPath: '/test/ext' } as any, testHomeDir);
        let fullRefreshFinished = false;

        const origDoRefresh = (provider as any).doRefreshCatalog.bind(provider);
        (provider as any).doRefreshCatalog = async () => {
          await new Promise((resolve) => setTimeout(resolve, 25));
          fullRefreshFinished = true;
          await origDoRefresh();
        };

        const refreshCatalogPromise = provider.refreshCatalog();
        let refreshSourceWitnessedFullDone = false;

        const origDoRefreshSource = (provider as any).doRefreshSource.bind(provider);
        (provider as any).doRefreshSource = async (sourceId: string, scope: Scope) => {
          await origDoRefreshSource(sourceId, scope);
          refreshSourceWitnessedFullDone = fullRefreshFinished;
        };

        await Promise.all([
          refreshCatalogPromise,
          provider.refreshSource('sourceA', 'project'),
        ]);

        assert.strictEqual(fullRefreshFinished, true);
        assert.strictEqual(refreshSourceWitnessedFullDone, true);
      });

      it('shows progress via vscode.window.withProgress when available', async () => {
        await writeManifest(
          'project',
          {
            schemaVersion: SCHEMA_VERSION,
            sources: [
              { id: 'sourceA', type: 'git-custom', scope: 'project', url: 'https://example.com/a.git' },
            ],
            desiredInstallations: [],
          },
          testTempDir
        );

        const provider = new AvailableTreeDataProvider({ fsPath: '/test/ext' } as any, testHomeDir);
        let withProgressCalledWith: any = undefined;
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const vscodeModule = require('vscode');
        vscodeModule.window.withProgress = async (options: any, task: any) => {
          withProgressCalledWith = options;
          return task({ report: () => {} });
        };

        try {
          await provider.refreshSource('sourceA', 'project');
          assert.ok(withProgressCalledWith);
          assert.deepStrictEqual(withProgressCalledWith.location, { viewId: 'aiSwissknife.sources' });
        } finally {
          delete vscodeModule.window.withProgress;
        }
      });

      it('shows status bar message when withProgress is not available and disposes it', async () => {
        await writeManifest(
          'project',
          {
            schemaVersion: SCHEMA_VERSION,
            sources: [
              { id: 'sourceA', type: 'git-custom', scope: 'project', url: 'https://example.com/a.git' },
            ],
            desiredInstallations: [],
          },
          testTempDir
        );

        const provider = new AvailableTreeDataProvider({ fsPath: '/test/ext' } as any, testHomeDir);
        let messageObservedDuringTask: string | undefined = undefined;

        (provider as any).resolveSourceGroup = async (src: Source) => {
          messageObservedDuringTask = mockLastStatusBarMessage;
          const pkg: Package = { id: `p-${src.id}`, sourceId: src.id, nativeFormat: 'raw', artifacts: [] };
          return {
            group: new AvailableSourceGroupItem(src, { packages: [pkg], diagnostics: [] }),
            attempt: { status: 'resolved', source: src, packages: [pkg] },
          };
        };

        await provider.refreshSource('sourceA', 'project');

        assert.strictEqual(messageObservedDuringTask, 'Refreshing source sourceA...');
        assert.strictEqual(mockLastStatusBarMessage, undefined);
      });
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

    it('uninstallItem soft-deletes a managed item and drops it from state, but only after confirmation', async () => {
      const provider = new InstalledTreeDataProvider({ fsPath: '/test/ext' } as any);
      const skillDir = path.join(testTempDir, 'my-skill');
      await fs.promises.mkdir(skillDir, { recursive: true });
      await fs.promises.writeFile(path.join(skillDir, 'SKILL.md'), '# test');

      const inst: ManagedInstallation = {
        assistant: 'claude-code', scope: 'project', projectPath: testTempDir, kind: 'skill',
        name: 'my-skill', path: skillDir, installedAt: '2026-08-19T12:00:00.000Z',
      };
      await writeState('project', { schemaVersion: SCHEMA_VERSION, installations: [inst] }, testTempDir);

      await provider.uninstallItem(undefined);
      assert.ok(mockLastWarningMessage?.includes('Please select a managed item to uninstall'));

      mockShowInformationMessageResult = undefined;
      await provider.uninstallItem(new InstalledInstallationItem(inst));
      assert.ok(fs.existsSync(skillDir), 'declining the confirmation must leave the file in place');
      let state = await readState('project', testTempDir);
      assert.strictEqual(state.installations.length, 1);

      mockShowInformationMessageResult = 'Uninstall';
      await provider.uninstallItem(new InstalledInstallationItem(inst));
      assert.ok(!fs.existsSync(skillDir), 'confirming must remove the original file');
      state = await readState('project', testTempDir);
      assert.strictEqual(state.installations.length, 0);
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
      const panel = DashboardPanel.render({ fsPath: '/test/ext' } as any, {} as any, {} as any, {} as any, () => {});
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
      assert.ok(html.includes('data-drift-key="claude-code:project:skill::demo-skill"'));
      
      panel.dispose();
    });

    it('renders dashboard HTML in scanning mode with pending status and indicator', () => {
      const panel = DashboardPanel.render({ fsPath: '/test/ext' } as any, {} as any, {} as any, {} as any, () => {});
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
      assert.ok(html.includes('data-drift-key="claude-code:project:skill::demo-skill"'));
      
      panel.dispose();
    });

    it('updates unifiedTable and observedTableBody when handling inventoryData message without [object Object]', () => {
      const panel = DashboardPanel.render({ fsPath: '/test/ext' } as any, {} as any, {} as any, {} as any, () => {});
      assert.ok(panel);

      const html = panel.getHtml([], [], [], []);
      const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
      assert.ok(scriptMatch, 'script tag must be present in dashboard HTML');

      const elements: Record<string, any> = {
        managedDataJson: { textContent: '[]' },
        observedDataJson: { textContent: '[]' },
        sourceFilterJson: { textContent: 'null' },
        unifiedTable: { innerHTML: 'initial-managed' },
        observedTableBody: { innerHTML: 'initial-observed' },
        'stat-managed': { textContent: '' },
        'stat-unmanaged': { textContent: '' },
        'stat-unmanaged-lbl': { textContent: '' },
        'overview-stat-sources': { textContent: '' },
        'overview-needs-attention': { innerHTML: '' },
        'section-catalog': { innerHTML: '' },
        'scan-indicator': { style: { display: '' } },
        'breadcrumb-chips': { innerHTML: '' },
        breadcrumb: { style: { display: '' } },
        searchBox: { value: '' },
        'stat-updates-available': { textContent: '' },
        'overview-stat-updates': { textContent: '' },
        'stat-modified-locally': { textContent: '' },
        'overview-stat-modified': { textContent: '' },
        'overview-stat-managed': { textContent: '' },
        'overview-stat-unmanaged': { textContent: '' },
      };

      const getEl = (id: string) => {
        if (!elements[id]) {
          elements[id] = { innerHTML: '', textContent: '', style: {}, setAttribute: () => {}, getAttribute: () => null };
        }
        return elements[id];
      };

      let messageListener: ((event: any) => void) | undefined;
      const mockWindow = {
        addEventListener: (event: string, handler: (e: any) => void) => {
          if (event === 'message') messageListener = handler;
        },
      };

      const mockDocument = {
        getElementById: (id: string) => getEl(id),
        querySelector: () => ({ innerHTML: '', classList: { add: () => {} }, querySelector: () => null, insertBefore: () => {} }),
        querySelectorAll: () => [],
        createElement: () => ({ className: '', id: '', innerHTML: '', style: {} }),
      };

      const sandbox = {
        window: mockWindow,
        document: mockDocument,
        acquireVsCodeApi: () => ({ postMessage: () => {} }),
        console,
        JSON,
        Array,
      };

      vm.createContext(sandbox);
      vm.runInContext(scriptMatch[1], sandbox);

      assert.ok(messageListener, 'message listener must be registered');

      const managedRowsHtml = '<tr><td>managed-test-row</td></tr>';
      const observedRowsHtml = '<tr><td>observed-test-row</td></tr>';

      messageListener({
        data: {
          command: 'inventoryData',
          managedData: [],
          observedData: [],
          rowsHtml: { managedRowsHtml, observedRowsHtml },
          totalInstalled: 1,
          totalUnmanaged: 1,
          identicalCount: 0,
          environmentPills: '',
          scanning: false,
          sourcesHtml: '',
          totalSources: 0,
        },
      });

      assert.strictEqual(elements.unifiedTable.innerHTML, managedRowsHtml);
      assert.strictEqual(elements.observedTableBody.innerHTML, observedRowsHtml);
      assert.ok(!elements.unifiedTable.innerHTML.includes('[object Object]'));
      assert.ok(!elements.observedTableBody.innerHTML.includes('[object Object]'));

      panel.dispose();
    });

    it('computeItemOrigin and getScopeLabel compute expected values', () => {
      assert.strictEqual(getScopeLabel('project'), 'Workspace');
      assert.strictEqual(getScopeLabel('global'), 'Global');

      const unmanagedDiff = computeItemOrigin('unmanaged', {
        assistant: 'claude-code',
        scope: 'project',
        kind: 'skill',
        name: 'test-skill',
        path: '/test/path',
        discoveredAt: '2026-10-08T00:00:00.000Z',
        candidates: [{
          status: 'different',
          sourceId: 'gcube-ai-toolkit',
          details: 'Differs from source'
        }]
      });
      assert.ok(unmanagedDiff.includes('gcube-ai-toolkit'));
      assert.ok(unmanagedDiff.includes('differs'));
      assert.ok(!unmanagedDiff.includes('no known origin'));

      const unmanagedLocal = computeItemOrigin('unmanaged', {
        assistant: 'claude-code',
        scope: 'project',
        kind: 'skill',
        name: 'test-skill',
        path: '/test/path',
        discoveredAt: '2026-10-08T00:00:00.000Z',
        candidates: []
      });
      assert.ok(unmanagedLocal.includes('Local only'));
      assert.ok(!unmanagedLocal.includes('no known origin'));

      const managedOrigin = computeItemOrigin('managed', {
        assistant: 'claude-code',
        scope: 'project',
        kind: 'skill',
        name: 'test-skill',
        path: '/test/path',
        sourceId: 'my-source',
        sourceRevision: { commit: 'abcdef1234567890' },
        installedAt: '2026-10-08T00:00:00.000Z'
      });
      assert.strictEqual(managedOrigin, 'my-source@abcdef1');
    });

    it('detail panel HTML has no #diffSection and includes structured detail layout', () => {
      const panel = DashboardPanel.render({ fsPath: '/test/ext' } as any, {} as any, {} as any, {} as any, () => {});
      assert.ok(panel);
      const html = panel.getHtml([], [], [], []);

      assert.ok(html.includes('id="detailPanel"'));
      assert.ok(!html.includes('id="diffSection"'), '#diffSection must be removed');
      assert.ok(html.includes('id="detailKind"'));
      assert.ok(html.includes('id="detailTitle"'));
      assert.ok(html.includes('id="detailAssistant"'));
      assert.ok(html.includes('id="detailScope"'));
      assert.ok(html.includes('id="detailStatus"'));
      assert.ok(html.includes('id="detailOrigin"'));
      assert.ok(html.includes('id="detailLocation"'));
      assert.ok(html.includes('id="detailActions"'));
      assert.ok(html.includes('id="crossFrameworkList"'));

      panel.dispose();
    });

    function setupDashboardSandbox() {
      const panel = DashboardPanel.render({ fsPath: '/test/ext' } as any, {} as any, {} as any, {} as any, () => {});
      assert.ok(panel);

      const html = panel.getHtml([], [], [], []);
      const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
      assert.ok(scriptMatch, 'script tag must be present in dashboard HTML');

      const elements: Record<string, any> = {
        managedDataJson: { textContent: '[]' },
        observedDataJson: { textContent: '[]' },
        sourceFilterJson: { textContent: 'null' },
        unifiedTable: { innerHTML: '' },
        observedTableBody: { innerHTML: '' },
        detailPanel: { style: { display: '' } },
        detailKind: { textContent: '', className: '' },
        detailTitle: { textContent: '' },
        detailAssistant: { innerHTML: '' },
        detailScope: { innerHTML: '' },
        detailStatus: { innerHTML: '' },
        detailOrigin: { textContent: '' },
        detailLocation: { textContent: '', title: '', onclick: null },
        crossFrameworkSection: { style: { display: '' } },
        crossFrameworkList: { innerHTML: '' },
        detailActions: { innerHTML: '' },
      };

      const getEl = (id: string) => {
        if (!elements[id]) {
          elements[id] = { innerHTML: '', textContent: '', style: {}, setAttribute: () => {}, getAttribute: () => null };
        }
        return elements[id];
      };

      let messageListener: ((event: any) => void) | undefined;
      const mockWindow = {
        addEventListener: (event: string, handler: (e: any) => void) => {
          if (event === 'message') messageListener = handler;
        },
      };

      const mockDocument = {
        getElementById: (id: string) => getEl(id),
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: () => ({ className: '', id: '', innerHTML: '', style: {} }),
      };

      const postedMessages: any[] = [];
      const sandbox: any = {
        window: mockWindow,
        document: mockDocument,
        acquireVsCodeApi: () => ({
          postMessage: (msg: any) => { postedMessages.push(msg); }
        }),
        console,
        JSON,
        Array,
      };

      vm.createContext(sandbox);
      vm.runInContext(scriptMatch[1], sandbox);
      assert.ok(messageListener, 'message listener must be registered');

      return {
        panel,
        html,
        elements,
        postedMessages,
        postMessage: (data: any) => messageListener!({ data }),
      };
    }

    it('detail panel handles unmanaged item with different candidate: origin names source and differs, location click posts preview, diff and promote in action bar', () => {
      const { panel, elements, postedMessages, postMessage } = setupDashboardSandbox();

      const unmanagedItem = {
        assistant: 'claude-code',
        scope: 'project',
        kind: 'skill',
        name: 'gcube-sg4-test-migration',
        path: '/workspace/.claude/skills/gcube-sg4-test-migration',
        discoveredAt: '2026-10-08T00:00:00.000Z',
        candidates: [{
          status: 'different',
          sourceId: 'gcube-ai-toolkit',
          details: 'Differs from source gcube-ai-toolkit'
        }],
        match: {
          status: 'different',
          sourceId: 'gcube-ai-toolkit',
          details: 'Differs from source gcube-ai-toolkit'
        }
      };
      const unmanagedKey = 'claude-code:project:skill::gcube-sg4-test-migration';

      postMessage({
        command: 'itemDetail',
        key: unmanagedKey,
        origin: computeItemOrigin('unmanaged', unmanagedItem as any, unmanagedItem.candidates as any),
        diffAvailable: true,
        crossFramework: [{ assistant: 'kilo-code', scope: 'project', strategy: 'provenance' }],
        candidates: unmanagedItem.candidates,
        item: unmanagedItem,
        membership: 'unmanaged',
        status: 'different',
        assistantIconUri: 'vscode-resource:/test/claude.svg'
      });

      // Origin text names the source and says it differs, never "no known origin"
      assert.ok(elements.detailOrigin.textContent.includes('gcube-ai-toolkit'), 'origin must name source');
      assert.ok(elements.detailOrigin.textContent.includes('differs'), 'origin must say differs');
      assert.ok(!elements.detailOrigin.textContent.includes('no known origin'), 'origin must never say no known origin');

      // Header checks
      assert.strictEqual(elements.detailKind.textContent, 'skill');
      assert.strictEqual(elements.detailTitle.textContent, 'gcube-sg4-test-migration');
      assert.ok(elements.detailAssistant.innerHTML.includes('claude-code'));
      assert.ok(elements.detailScope.innerHTML.includes('Workspace'));

      // Status in words
      assert.ok(elements.detailStatus.innerHTML.includes('differs from gcube-ai-toolkit'));

      // Location click posts preview message
      assert.strictEqual(elements.detailLocation.textContent, unmanagedItem.path);
      assert.ok(typeof elements.detailLocation.onclick === 'function');
      elements.detailLocation.onclick({ preventDefault: () => {} });
      const lastMsg = postedMessages[postedMessages.length - 1];
      assert.strictEqual(lastMsg?.command, 'previewInstalledArtifact');
      assert.strictEqual(lastMsg?.key, unmanagedKey);

      // Cross-framework list computed and displays Workspace
      assert.ok(elements.crossFrameworkList.innerHTML.includes('kilo-code'));
      assert.ok(elements.crossFrameworkList.innerHTML.includes('Workspace'));

      // Diff inside action bar with icon and text label
      const actionHtml = elements.detailActions.innerHTML;
      assert.ok(actionHtml.includes('Diff'), 'Diff must be in action bar');
      assert.ok(actionHtml.includes('⇄'));
      assert.ok(actionHtml.includes('Promote'));
      assert.ok(actionHtml.includes('⇧'));
      assert.ok(actionHtml.includes('Preview'));
      assert.ok(actionHtml.includes('👁'));

      // Every button carries icon and text label
      const buttons = [...actionHtml.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)];
      assert.ok(buttons.length >= 3);
      for (const btn of buttons) {
        assert.ok(btn[1].includes('class="btn-icon"'), `Button must have icon: ${btn[1]}`);
        const label = btn[1].replace(/<[^>]*>/g, '').trim();
        assert.ok(label.length > 0, `Button must have text: ${btn[1]}`);
      }

      panel.dispose();
    });

    it('detail panel handles unmanaged item without candidate: renders Local only and excludes Diff', () => {
      const { panel, elements, postMessage } = setupDashboardSandbox();

      const localItem = {
        assistant: 'claude-code',
        scope: 'project',
        kind: 'skill',
        name: 'custom-skill',
        path: '/workspace/.claude/skills/custom-skill',
        discoveredAt: '2026-10-08T00:00:00.000Z',
        candidates: []
      };
      const localKey = 'claude-code:project:skill::custom-skill';

      postMessage({
        command: 'itemDetail',
        key: localKey,
        origin: computeItemOrigin('unmanaged', localItem as any, []),
        diffAvailable: false,
        crossFramework: [],
        candidates: [],
        item: localItem,
        membership: 'unmanaged',
        status: 'unmatched',
      });

      assert.ok(elements.detailOrigin.textContent.includes('Local only'), 'must say Local only');
      assert.ok(!elements.detailOrigin.textContent.includes('no known origin'), 'never say no known origin');
      assert.ok(!elements.detailActions.innerHTML.includes('Diff'), 'Diff should not be rendered');
      assert.ok(!elements.detailActions.innerHTML.includes('Promote'), 'Promote should not be rendered');
      assert.ok(elements.detailActions.innerHTML.includes('Preview'), 'Preview should be rendered');

      panel.dispose();
    });

    it('detail panel handles managed item with update available: Update is primary button with icon and text', () => {
      const { panel, elements, postMessage } = setupDashboardSandbox();

      const managedItem = {
        assistant: 'kilo-code',
        scope: 'project',
        kind: 'skill',
        name: 'managed-skill',
        path: '/workspace/.kilo/skills/managed-skill',
        sourceId: 'gcube-ai-toolkit',
        sourceRevision: { commit: '1234567890abcdef' },
        installedAt: '2026-10-08T00:00:00.000Z'
      };
      const managedKey = 'kilo-code:project:skill::managed-skill';

      postMessage({
        command: 'itemDetail',
        key: managedKey,
        origin: computeItemOrigin('managed', managedItem as any),
        diffAvailable: false,
        crossFramework: [],
        candidates: [],
        item: managedItem,
        membership: 'managed',
        status: 'update-available',
      });

      const actionHtml = elements.detailActions.innerHTML;
      assert.ok(actionHtml.includes('btn-primary'), 'Update button must be primary');
      assert.ok(actionHtml.includes('Update'));
      assert.ok(actionHtml.includes('⟳'));
      assert.ok(actionHtml.includes('Preview'));
      assert.ok(actionHtml.includes('👁'));
      assert.ok(actionHtml.includes('Uninstall'));
      assert.ok(actionHtml.includes('🗑'));

      const buttons = [...actionHtml.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)];
      assert.ok(buttons.length >= 4);
      for (const btn of buttons) {
        assert.ok(btn[1].includes('class="btn-icon"'), `Button must have icon: ${btn[1]}`);
        const label = btn[1].replace(/<[^>]*>/g, '').trim();
        assert.ok(label.length > 0, `Button must have text: ${btn[1]}`);
      }

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
    let originalHome: string | undefined;

    beforeEach(async () => {
      fakeContext = {
        subscriptions: [],
        workspaceState: {
          _state: new Map<string, any>(),
          get(key: string) { return this._state.get(key); },
          async update(key: string, value: any) { this._state.set(key, value); }
        }
      };
      // extension.activate() constructs its own providers internally with no
      // way to inject testHomeDir, so it resolves "global" scope via
      // os.homedir() -> process.env.HOME. Without this override these tests
      // read/resolve-against the real developer machine's actual
      // ~/.ai-swissknife global state, which is slow (real git resolution)
      // and non-deterministic.
      originalHome = process.env.HOME;
      process.env.HOME = testHomeDir;
      delete require.cache[require.resolve('../extension')];
      extension = require('../extension');
    });

    afterEach(() => {
      process.env.HOME = originalHome;
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

      await extension.activate(fakeContext).checkRecommendationsPromise;

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

      await extension.activate(fakeContext).checkRecommendationsPromise;

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

      await extension.activate(fakeContext).checkRecommendationsPromise;

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

      await extension.activate(fakeContext).checkRecommendationsPromise;

      assert.strictEqual(fakeContext.workspaceState.get('aiSwissknife.ignoreRecommendations'), true);
    });
  });

  describe('Status Bar Item', () => {
    let fakeContext: any;
    let extension: any;
    let originalHome: string | undefined;

    beforeEach(async () => {
      fakeContext = {
        subscriptions: [],
        workspaceState: {
          _state: new Map<string, any>(),
          get(key: string) { return this._state.get(key); },
          async update(key: string, value: any) { this._state.set(key, value); }
        }
      };
      // See "Workspace Open Detection" above for why this is needed.
      originalHome = process.env.HOME;
      process.env.HOME = testHomeDir;
      delete require.cache[require.resolve('../extension')];
      extension = require('../extension');
    });

    afterEach(() => {
      process.env.HOME = originalHome;
    });

    it('creates persistent status bar item with openDashboard command and default label', async () => {
      await extension.activate(fakeContext).checkRecommendationsPromise;

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

      await extension.activate(fakeContext).checkRecommendationsPromise;

      assert.ok(mockLastCreatedStatusBarItem);
      assert.strictEqual(mockLastCreatedStatusBarItem.text, '$(dashboard) AI Swissknife: 2 recommendations');
    });
  });

  describe('configureEnabledAssistants Command', () => {
    let fakeContext: any;
    let extension: any;
    let originalHome: string | undefined;

    beforeEach(async () => {
      fakeContext = {
        subscriptions: [],
        workspaceState: {
          _state: new Map<string, any>(),
          get(key: string) { return this._state.get(key); },
          async update(key: string, value: any) { this._state.set(key, value); }
        }
      };
      // See "Workspace Open Detection" above for why this is needed.
      originalHome = process.env.HOME;
      process.env.HOME = testHomeDir;
      mockRegisteredCommands.clear();
      mockConfigUpdates = [];
      mockConfigGetResult = undefined;
      delete require.cache[require.resolve('../extension')];
      extension = require('../extension');
    });

    afterEach(() => {
      process.env.HOME = originalHome;
    });

    it('updates config when QuickPick returns a selection', async () => {
      extension.activate(fakeContext);
      const handler = mockRegisteredCommands.get('aiSwissknife.configureEnabledAssistants');
      assert.ok(handler);

      mockConfigGetResult = { 'claude-code': true, 'kilo-code': true };
      
      // Simulate user selecting only claude-code and codex-cli
      mockQuickPickResult = [
        { label: 'Claude Code', picked: true, assistantId: 'claude-code' },
        { label: 'Codex CLI', picked: true, assistantId: 'codex-cli' }
      ];

      await handler();

      assert.strictEqual(mockConfigUpdates.length, 1);
      const update = mockConfigUpdates[0];
      assert.strictEqual(update.section, 'enabledAssistants');
      assert.strictEqual(update.target, 1); // Global
      assert.deepStrictEqual(update.value, {
        'claude-code': true,
        'kilo-code': false,
        'github-copilot': false,
        'codex-cli': true,
        'gemini-cli': false
      });
    });

    it('does not update config when QuickPick is cancelled', async () => {
      extension.activate(fakeContext);
      const handler = mockRegisteredCommands.get('aiSwissknife.configureEnabledAssistants');
      assert.ok(handler);

      mockQuickPickResult = undefined; // Cancelled
      await handler();

      assert.strictEqual(mockConfigUpdates.length, 0);
    });
  });

  describe('refreshSource Command & Dashboard Integration', () => {
    let fakeContext: any;
    let extension: any;
    let originalHome: string | undefined;

    beforeEach(async () => {
      fakeContext = {
        subscriptions: [],
        workspaceState: {
          _state: new Map<string, any>(),
          get(key: string) { return this._state.get(key); },
          async update(key: string, value: any) { this._state.set(key, value); }
        }
      };
      originalHome = process.env.HOME;
      process.env.HOME = testHomeDir;
      mockRegisteredCommands.clear();
      mockLastWarningMessage = undefined;
      mockLastWebviewMessageListener = undefined;
      delete require.cache[require.resolve('../extension')];
      extension = require('../extension');
    });

    afterEach(() => {
      process.env.HOME = originalHome;
    });

    it('command shows warning message when invoked without an item', async () => {
      extension.activate(fakeContext);
      const handler = mockRegisteredCommands.get('aiSwissknife.refreshSource');
      assert.ok(handler, 'aiSwissknife.refreshSource must be registered');

      await handler(undefined);
      assert.strictEqual(mockLastWarningMessage, 'Please select a source to refresh.');
    });

    it("command invokes availableProvider.refreshSource with the item's id and scope", async () => {
      const originalRefreshSource = AvailableTreeDataProvider.prototype.refreshSource;
      let calledWith: { sourceId: string; scope: Scope } | undefined;
      AvailableTreeDataProvider.prototype.refreshSource = async function (sourceId: string, scope: Scope) {
        calledWith = { sourceId, scope };
      };

      try {
        extension.activate(fakeContext);
        const handler = mockRegisteredCommands.get('aiSwissknife.refreshSource');
        assert.ok(handler, 'aiSwissknife.refreshSource must be registered');

        const mockItem = new SourceItem(
          {
            id: 'my-custom-source',
            scope: 'project',
            type: 'git-custom',
            url: 'https://github.com/org/repo.git'
          },
          'my-custom-source'
        );

        await handler(mockItem);
        assert.deepStrictEqual(calledWith, {
          sourceId: 'my-custom-source',
          scope: 'project'
        });
      } finally {
        AvailableTreeDataProvider.prototype.refreshSource = originalRefreshSource;
      }
    });

    it('Dashboard message switch invokes availableProvider.refreshSource with sourceId and scope', async () => {
      if (DashboardPanel.currentPanel) {
        DashboardPanel.currentPanel.dispose();
      }

      let refreshed: { sourceId: string; scope: Scope } | undefined;
      const mockAvailable = {
        refreshSource: async (sourceId: string, scope: Scope) => {
          refreshed = { sourceId, scope };
        },
        getCachedRecommendedGroup: () => undefined,
      };

      const panel = DashboardPanel.render(
        { fsPath: '/test/ext' } as any,
        {} as any,
        { getAllSources: async () => [] } as any,
        mockAvailable as any,
        () => {}
      );

      assert.ok(mockLastWebviewMessageListener, 'Webview message listener must be captured');
      await mockLastWebviewMessageListener({
        command: 'refreshSource',
        sourceId: 'dashboard-src',
        scope: 'global'
      });

      assert.deepStrictEqual(refreshed, {
        sourceId: 'dashboard-src',
        scope: 'global'
      });
      panel.dispose();
    });

    it('Dashboard renders per-source refresh button and handles source id with apostrophe safely', () => {
      if (DashboardPanel.currentPanel) {
        DashboardPanel.currentPanel.dispose();
      }

      const panel = DashboardPanel.render(
        { fsPath: '/test/ext' } as any,
        {} as any,
        {} as any,
        { getCachedRecommendedGroup: () => undefined } as any,
        () => {}
      );

      const testSource: Source = {
        id: "team's-toolkit",
        scope: 'global',
        type: 'git-custom',
        url: 'https://github.com/team/toolkit.git',
        name: "Team's Toolkit"
      };

      const html = panel.getHtml([testSource], [], [], []);
      assert.ok(html.includes('title="Refresh source"'), 'Must have button with tooltip "Refresh source"');
      assert.ok(html.includes('>↻</button>'), 'Must have icon-only ↻ button');

      // Verify apostrophe in source id does not break onclick attribute JavaScript parsing
      const match = html.match(/<button[^>]*title="Refresh source"[^>]*onclick="([^"]*)"/);
      assert.ok(match, 'Refresh button with onclick must exist');
      const onclickAttr = match[1];

      // Simulate browser HTML decoding of attribute value before executing inline JS
      const decodedJs = onclickAttr
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');

      let posted: any = undefined;
      const exec = new Function('vscode', decodedJs);
      exec({ postMessage: (msg: any) => { posted = msg; } });

      assert.deepStrictEqual(posted, {
        command: 'refreshSource',
        sourceId: "team's-toolkit",
        scope: 'global'
      });

      panel.dispose();
    });
  });

  describe('Update all (47.2)', () => {
    it('package.json check: aiSwissknife.updateAll and per-environment view/title entries', async () => {
      const pkgPath = path.join(__dirname, '../../package.json');
      const pkgJson = JSON.parse(await fs.promises.readFile(pkgPath, 'utf8'));

      // 1. Palette entry for aiSwissknife.updateAll
      const cmds = pkgJson.contributes.commands;
      const updateAllCmd = cmds.find((c: any) => c.command === 'aiSwissknife.updateAll');
      assert.ok(updateAllCmd, 'aiSwissknife.updateAll must be in contributes.commands');
      assert.strictEqual(updateAllCmd.title, 'Update All...');
      assert.strictEqual(updateAllCmd.icon, '$(arrow-circle-up)');

      // 2. Per-environment view/title entry exists with when per assistant view
      const viewTitleMenus = pkgJson.contributes.menus['view/title'];
      assert.ok(Array.isArray(viewTitleMenus));

      const expectedAssistants = ['claude-code', 'kilo-code', 'github-copilot', 'codex-cli', 'gemini-cli'];
      for (const assistant of expectedAssistants) {
        const entry = viewTitleMenus.find(
          (m: any) =>
            m.command === 'aiSwissknife.updateAll' &&
            m.when.includes(`aiSwissknife.installed.${assistant}`)
        );
        assert.ok(
          entry,
          `view/title must have an entry for aiSwissknife.installed.${assistant}`
        );
      }
    });

    it('command with no argument covers all environments, with an id only that one', async () => {
      const fakeContext = { subscriptions: [], extensionUri: { fsPath: '/test/ext' } } as any;
      mockRegisteredCommands.clear();
      extensionModule.activate(fakeContext);

      const updateAllHandler = mockRegisteredCommands.get('aiSwissknife.updateAll');
      assert.ok(updateAllHandler, 'aiSwissknife.updateAll command must be registered');

      const provider = new InstalledTreeDataProvider({ fsPath: '/test/ext' } as any, testHomeDir);
      let capturedFilter: any = 'NOT_CALLED';
      provider.doUpdateAll = async (f?: any) => {
        capturedFilter = f;
      };

      // When called with no argument
      await mockVscode.commands.registerCommand('aiSwissknife.updateAll', async (arg?: any) => {
        let filter: any;
        if (typeof arg === 'string') filter = { assistant: arg };
        else if (arg && typeof arg === 'object') filter = arg;
        await provider.doUpdateAll(filter);
      });

      await mockVscode.commands.executeCommand('aiSwissknife.updateAll');
      assert.strictEqual(capturedFilter, undefined, 'no argument covers all environments');

      // When called with an assistant id
      await mockVscode.commands.executeCommand('aiSwissknife.updateAll', 'kilo-code');
      assert.deepStrictEqual(capturedFilter, { assistant: 'kilo-code' }, 'assistant id covers that one environment');
    });

    it('summary modal text for N/M/K and button options', async () => {
      const provider = new InstalledTreeDataProvider({ fsPath: '/test/ext' } as any, testHomeDir);

      const installations: ManagedInstallation[] = [];
      for (let i = 1; i <= 12; i++) {
        installations.push({
          assistant: 'claude-code',
          scope: 'project',
          projectPath: testTempDir,
          kind: 'skill',
          name: `item-${String(i).padStart(2, '0')}`,
          sourceId: 'src1',
          path: path.join(testTempDir, `item-${i}`),
          installedAt: new Date().toISOString(),
          contentHash: 'hash',
        });
      }
      installations.push({
        assistant: 'claude-code',
        scope: 'project',
        projectPath: testTempDir,
        kind: 'skill',
        name: 'modified-item-1',
        sourceId: 'src1',
        path: path.join(testTempDir, 'mod-1'),
        installedAt: new Date().toISOString(),
        contentHash: 'hash',
      });
      installations.push({
        assistant: 'claude-code',
        scope: 'project',
        projectPath: testTempDir,
        kind: 'skill',
        name: 'modified-item-2',
        sourceId: 'src1',
        path: path.join(testTempDir, 'mod-2'),
        installedAt: new Date().toISOString(),
        contentHash: 'hash',
      });
      installations.push({
        assistant: 'claude-code',
        scope: 'project',
        projectPath: testTempDir,
        kind: 'skill',
        name: 'cannot-item-1',
        sourceId: 'nonexistent-source',
        path: path.join(testTempDir, 'cannot-1'),
        installedAt: new Date().toISOString(),
        contentHash: 'hash',
      });

      await writeState('project', { schemaVersion: SCHEMA_VERSION, installations }, testTempDir);
      await writeManifest('project', { schemaVersion: SCHEMA_VERSION, sources: [{ id: 'src1', name: 'Src 1', type: 'local-folder', localPath: testTempDir, scope: 'project' }], desiredInstallations: [] }, testTempDir);

      mockShowInformationMessageCalls = [];
      mockShowInformationMessageResult = 'Cancel';

      const origCheckDriftForAll = driftModule.checkDriftForAll;
      (driftModule as any).checkDriftForAll = async () => [];

      const origPlanUpdateAll = updateModule.planUpdateAll;
      (updateModule as any).planUpdateAll = async () => ({
        toUpdate: installations.filter(i => i.name.startsWith('item-')).map(inst => ({
          installation: inst,
          source: { id: 'src1' },
          prepared: {}
        })),
        skippedModified: installations.filter(i => i.name.startsWith('modified-item')).map(inst => ({
          installation: inst,
          status: 'modified-locally',
          reason: 'Modified locally'
        })),
        cannotUpdate: [
          { installation: installations.find(i => i.name === 'cannot-item-1')!, reason: 'Source not found in manifest' }
        ],
        upToDate: [],
        buckets: { toUpdate: [], skippedModified: [], cannotUpdate: [], upToDate: [] },
        counts: { toUpdate: 12, skippedModified: 2, cannotUpdate: 1, upToDate: 0, total: 15 }
      });

      try {
        await provider.doUpdateAll();

        assert.ok(mockShowInformationMessageCalls.length >= 1);
        const modalCall = mockShowInformationMessageCalls[0];
        assert.ok(modalCall.msg.includes('12 update(s) will be applied'));
        assert.ok(modalCall.msg.includes('and 2 more'));
        assert.ok(modalCall.msg.includes('2 item(s) are modified locally and will be skipped (they would lose your edits)'));
        assert.ok(modalCall.msg.includes('1 item(s) cannot be updated'));

        assert.ok(modalCall.actions.includes('Update 12'));
        assert.ok(modalCall.actions.some((a: string) => typeof a === 'string' && a.includes('Update 12 + 2 modified (your version is saved to the trash first)')));
        assert.ok(modalCall.actions.includes('Cancel'));
      } finally {
        (driftModule as any).checkDriftForAll = origCheckDriftForAll;
        (updateModule as any).planUpdateAll = origPlanUpdateAll;
      }
    });

    it('choosing plain button never touches modified items, other button passes includeModified', async () => {
      const provider = new InstalledTreeDataProvider({ fsPath: '/test/ext' } as any, testHomeDir);

      const instUp: ManagedInstallation = {
        assistant: 'claude-code',
        scope: 'project',
        projectPath: testTempDir,
        kind: 'skill',
        name: 'item-update',
        sourceId: 'src1',
        path: path.join(testTempDir, 'item-update'),
        installedAt: new Date().toISOString(),
        contentHash: 'hash',
      };
      const instMod: ManagedInstallation = {
        assistant: 'claude-code',
        scope: 'project',
        projectPath: testTempDir,
        kind: 'skill',
        name: 'item-modified',
        sourceId: 'src1',
        path: path.join(testTempDir, 'item-modified'),
        installedAt: new Date().toISOString(),
        contentHash: 'hash',
      };

      await writeState('project', { schemaVersion: SCHEMA_VERSION, installations: [instUp, instMod] }, testTempDir);
      await writeManifest('project', { schemaVersion: SCHEMA_VERSION, sources: [{ id: 'src1', name: 'Src 1', type: 'local-folder', localPath: testTempDir, scope: 'project' }], desiredInstallations: [] }, testTempDir);

      const origCheckDriftForAll = driftModule.checkDriftForAll;
      (driftModule as any).checkDriftForAll = async () => [
        { installation: instUp, status: 'update-available', sourceHash: 'newhash' },
        { installation: instMod, status: 'modified-locally', sourceHash: 'newhash' },
      ];

      const origPlanUpdateAll = updateModule.planUpdateAll;
      const origApplyUpdateAll = updateModule.applyUpdateAll;

      (updateModule as any).planUpdateAll = async (params: any) => {
        if (params.includeModified) {
          return {
            toUpdate: [
              { installation: instUp, source: { id: 'src1' }, prepared: {} },
              { installation: instMod, source: { id: 'src1' }, prepared: {} },
            ],
            skippedModified: [],
            cannotUpdate: [],
            upToDate: [],
            buckets: { toUpdate: [], skippedModified: [], cannotUpdate: [], upToDate: [] },
            counts: { toUpdate: 2, skippedModified: 0, cannotUpdate: 0, upToDate: 0, total: 2 },
          };
        } else {
          return {
            toUpdate: [
              { installation: instUp, source: { id: 'src1' }, prepared: {} },
            ],
            skippedModified: [
              { installation: instMod, status: 'modified-locally', reason: 'Modified locally' },
            ],
            cannotUpdate: [],
            upToDate: [],
            buckets: { toUpdate: [], skippedModified: [], cannotUpdate: [], upToDate: [] },
            counts: { toUpdate: 1, skippedModified: 1, cannotUpdate: 0, upToDate: 0, total: 2 },
          };
        }
      };

      let appliedItems: any[] = [];
      (updateModule as any).applyUpdateAll = async (plan: any) => {
        appliedItems = (Array.isArray(plan) ? plan : plan.toUpdate).map((p: any) => p.installation.name);
        return [{ installation: instUp, status: 'applied' }];
      };

      try {
        // 1. Choose plain button: 'Update 1'
        mockShowInformationMessageCalls = [];
        mockCustomShowInformationMessage = async (msg: string) => {
          if (msg.includes('update(s) will be applied')) {
            return 'Update 1';
          }
          return undefined;
        };

        await provider.doUpdateAll();
        assert.deepStrictEqual(appliedItems, ['item-update'], 'Plain button must only update non-modified item');

        // 2. Choose modified button: 'Update 1 + 1 modified...'
        appliedItems = [];
        mockShowInformationMessageCalls = [];
        mockCustomShowInformationMessage = async (msg: string, ...actions: any[]) => {
          if (msg.includes('update(s) will be applied')) {
            const modBtn = actions.find((a: any) => typeof a === 'string' && a.includes('modified (your version is saved to the trash first)'));
            return modBtn;
          }
          return undefined;
        };

        await provider.doUpdateAll();
        assert.ok(appliedItems.includes('item-modified'), 'Modified button must include modified item');
        assert.ok(appliedItems.includes('item-update'));
      } finally {
        (driftModule as any).checkDriftForAll = origCheckDriftForAll;
        (updateModule as any).planUpdateAll = origPlanUpdateAll;
        (updateModule as any).applyUpdateAll = origApplyUpdateAll;
        mockCustomShowInformationMessage = undefined;
      }
    });

    it('exactly one drift check and one refresh per run (spies)', async () => {
      const provider = new InstalledTreeDataProvider({ fsPath: '/test/ext' } as any, testHomeDir);

      const inst: ManagedInstallation = {
        assistant: 'claude-code',
        scope: 'project',
        projectPath: testTempDir,
        kind: 'skill',
        name: 'single-item',
        sourceId: 'src1',
        path: path.join(testTempDir, 'single-item'),
        installedAt: new Date().toISOString(),
        contentHash: 'hash',
      };
      await writeState('project', { schemaVersion: SCHEMA_VERSION, installations: [inst] }, testTempDir);
      await writeManifest('project', { schemaVersion: SCHEMA_VERSION, sources: [{ id: 'src1', name: 'Src 1', type: 'local-folder', localPath: testTempDir, scope: 'project' }], desiredInstallations: [] }, testTempDir);

      const origCheckDriftForAll = driftModule.checkDriftForAll;
      let driftCheckCount = 0;
      (driftModule as any).checkDriftForAll = async () => {
        driftCheckCount++;
        return [{ installation: inst, status: 'update-available', sourceHash: 'new' }];
      };

      let refreshCount = 0;
      const origRefresh = provider.refresh.bind(provider);
      provider.refresh = () => {
        refreshCount++;
        origRefresh();
      };

      const origPlanUpdateAll = updateModule.planUpdateAll;
      const origApplyUpdateAll = updateModule.applyUpdateAll;
      (updateModule as any).planUpdateAll = async () => ({
        toUpdate: [{ installation: inst, source: { id: 'src1' }, prepared: {} }],
        skippedModified: [],
        cannotUpdate: [],
        upToDate: [],
        buckets: { toUpdate: [], skippedModified: [], cannotUpdate: [], upToDate: [] },
        counts: { toUpdate: 1, skippedModified: 0, cannotUpdate: 0, upToDate: 0, total: 1 },
      });
      (updateModule as any).applyUpdateAll = async () => [
        { installation: inst, status: 'applied' }
      ];

      mockCustomShowInformationMessage = async (msg: string) => {
        if (msg.includes('update(s) will be applied')) return 'Update 1';
        return undefined;
      };

      try {
        await provider.doUpdateAll();
        assert.strictEqual(driftCheckCount, 1, 'drift check must be called exactly once');
        assert.strictEqual(refreshCount, 1, 'refresh must be called exactly once');
      } finally {
        (driftModule as any).checkDriftForAll = origCheckDriftForAll;
        (updateModule as any).planUpdateAll = origPlanUpdateAll;
        (updateModule as any).applyUpdateAll = origApplyUpdateAll;
        provider.refresh = origRefresh;
        mockCustomShowInformationMessage = undefined;
      }
    });

    it('Dashboard button posts the current filter and is disabled at 0', async () => {
      const panel = DashboardPanel.render({ fsPath: '/test/ext' } as any, {} as any, {} as any, {} as any, () => {});
      const htmlZero = (panel as any).getInstalledSectionHtml([], [], [], [], false, 0, 0, 0, 0, 0, '', { managedRowsHtml: '', observedRowsHtml: '' });
      assert.ok(htmlZero.includes('id="updateAllBtn"'));
      assert.ok(htmlZero.includes('title="Update all (0)"'));
      assert.ok(htmlZero.includes('disabled'));
      assert.ok(htmlZero.includes('onclick="triggerUpdateAll()"'));

      const htmlTwo = (panel as any).getInstalledSectionHtml([], [], [], [], false, 2, 0, 2, 0, 0, '', { managedRowsHtml: '', observedRowsHtml: '' });
      assert.ok(htmlTwo.includes('title="Update all (2)"'));
      assert.ok(!htmlTwo.includes('title="Update all (2)" disabled'));

      let receivedFilter: any = undefined;
      const fakeProvider = {
        doUpdateAll: async (f: any) => { receivedFilter = f; },
        refresh: () => {}
      };
      (panel as any)._provider = fakeProvider;
      (panel as any)._refreshCallback = () => {};
      (panel as any).update = async () => {};

      await (panel as any)._panel.webview.postMessage({ command: 'updateAll', filter: { assistant: 'kilo-code', scope: 'project', kind: 'skill' } });
      assert.deepStrictEqual(receivedFilter, { assistant: 'kilo-code', scope: 'project', kind: 'skill' });
    });

    it('single-item doUpdateInstallation gains locally-modified warning in modal text', async () => {
      const provider = new InstalledTreeDataProvider({ fsPath: '/test/ext' } as any, testHomeDir);
      const inst: ManagedInstallation = {
        assistant: 'claude-code',
        scope: 'project',
        projectPath: testTempDir,
        kind: 'skill',
        name: 'test-single',
        sourceId: 'src1',
        path: path.join(testTempDir, 'test-single'),
        installedAt: new Date().toISOString(),
        contentHash: 'hash',
      };

      await writeState('project', { schemaVersion: SCHEMA_VERSION, installations: [inst] }, testTempDir);
      await writeManifest('project', { schemaVersion: SCHEMA_VERSION, sources: [{ id: 'src1', name: 'Src 1', type: 'local-folder', localPath: testTempDir, scope: 'project' }], desiredInstallations: [] }, testTempDir);

      const origPlanUpdate = updateModule.planUpdate;
      (updateModule as any).planUpdate = async () => ({ supported: true, plan: { reason: '' } });

      const origAnalyze = driftModule.analyzeLocalDrift;

      // 1. Not modified
      (driftModule as any).analyzeLocalDrift = async () => ({ status: 'update-available' });
      mockShowInformationMessageCalls = [];
      mockShowInformationMessageResult = 'Cancel';

      try {
        await provider.doUpdateInstallation(inst);
        assert.ok(mockShowInformationMessageCalls.length >= 1);
        const normalMsg = mockShowInformationMessageCalls[0].msg;
        assert.ok(!normalMsg.includes('modified locally'));
        assert.ok(!normalMsg.includes('lose your edits'));

        // 2. Modified locally
        (driftModule as any).analyzeLocalDrift = async () => ({ status: 'modified-locally' });
        mockShowInformationMessageCalls = [];

        await provider.doUpdateInstallation(inst);
        assert.ok(mockShowInformationMessageCalls.length >= 1);
        const warningMsg = mockShowInformationMessageCalls[0].msg;
        assert.ok(warningMsg.includes('modified locally'));
        assert.ok(warningMsg.includes('lose your edits'));
      } finally {
        (updateModule as any).planUpdate = origPlanUpdate;
        (driftModule as any).analyzeLocalDrift = origAnalyze;
      }
    });
  });
});


