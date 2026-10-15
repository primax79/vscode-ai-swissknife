import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter as NodeEventEmitter } from 'events';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module');
const originalRequire = Module.prototype.require;

const extensionRoot = path.resolve(__dirname, '..');
const pkgJson = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'package.json'), 'utf-8'));

// CLI args for standalone server
function parseArgs() {
  const args = process.argv.slice(2);
  let port = Number(process.env.PORT || 3456);
  let workspace = process.env.SWK_WORKSPACE || extensionRoot;
  let home = process.env.SWK_HOME || os.homedir();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = Number(args[++i]);
    } else if (args[i] === '--workspace' && args[i + 1]) {
      workspace = path.resolve(args[++i]);
    } else if (args[i] === '--home' && args[i + 1]) {
      home = path.resolve(args[++i]);
    }
  }
  return { port, workspace, home };
}

const config = parseArgs();
if (config.home !== os.homedir()) {
  process.env.HOME = config.home;
  process.env.USERPROFILE = config.home;
}

// Global event bus for SSE to connected browsers
const sseBus = new NodeEventEmitter();
sseBus.setMaxListeners(100);

function broadcast(event: string, payload: unknown) {
  sseBus.emit('event', { event, payload });
}

// Pending interactive prompts waiting for user response in browser
interface PendingPrompt {
  id: string;
  kind: 'quickPick' | 'inputBox' | 'message' | 'openDialog' | 'saveDialog';
  options: Record<string, unknown>;
  resolve: (val: any) => void;
  rawItems?: any[];
}

const pendingPrompts = new Map<string, PendingPrompt>();
let promptCounter = 0;

function createPrompt<T>(
  kind: PendingPrompt['kind'],
  options: Record<string, unknown>,
  rawItems?: any[]
): Promise<T> {
  const id = `prompt-${++promptCounter}-${Date.now()}`;
  return new Promise<T>((resolve) => {
    pendingPrompts.set(id, { id, kind, options, resolve, rawItems });
    broadcast('prompt', { id, kind, options });
  });
}

// State tracked by the VS Code shim
let currentWorkspacePath = config.workspace;
const contextKeys = new Map<string, unknown>();
const registeredCommands = new Map<string, (...args: any[]) => any>();
const treeProviders = new Map<string, any>();
const contentProviders = new Map<string, any>();
const webviewPanels = new Map<string, {
  viewType: string;
  title: string;
  html: string;
  msgHandler?: (msg: any) => Promise<any>;
  disposeHandlers: Array<() => void>;
}>();

const statusBarState = {
  text: '$(dashboard) AI Swissknife',
  tooltip: 'AI Swissknife: Open Dashboard',
  command: 'aiSwissknife.openDashboard',
  visible: true,
};

let enabledAssistantsConfig: Record<string, boolean> = {
  'claude-code': true,
  'kilo-code': true,
  'github-copilot': true,
  'codex-cli': true,
  'gemini-cli': true,
};

const workspaceStateStore = new Map<string, unknown>([
  // Don't block startup with recommendation modal unless triggered explicitly
  ['aiSwissknife.ignoreRecommendations', true],
]);

const configChangeListeners: Array<(e: { affectsConfiguration: (s: string) => boolean }) => void> = [];

function rewriteWebviewResourceUrls(html: string): string {
  // Rewrite vscode-webview-resource:// to /fs?path=...
  return html.replace(/vscode-webview-resource:\/\/([^\s"'<>]+)/g, (_m, fsPath) => {
    return `/fs?path=${encodeURIComponent(fsPath)}`;
  });
}

function rewriteWebviewMessageDeep(value: any): any {
  if (typeof value === 'string') {
    return rewriteWebviewResourceUrls(value);
  }
  if (Array.isArray(value)) {
    return value.map(rewriteWebviewMessageDeep);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = rewriteWebviewMessageDeep(v);
    }
    return out;
  }
  return value;
}

const vscodeShim = {
  ProgressLocation: {
    SourceControl: 1,
    Window: 10,
    Notification: 15,
  },
  StatusBarAlignment: {
    Left: 1,
    Right: 2,
  },
  ViewColumn: {
    One: 1,
    Two: 2,
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3,
  },
  TreeItemCollapsibleState: {
    None: 0,
    Collapsed: 1,
    Expanded: 2,
  },
  TreeItem: class {
    description?: string;
    contextValue?: string;
    tooltip?: string;
    iconPath?: unknown;
    command?: unknown;
    id?: string;
    resourceUri?: unknown;
    constructor(public label: string, public collapsibleState: number = 0) {}
  },
  ThemeIcon: class {
    static Folder = { id: 'folder' };
    static File = { id: 'file' };
    constructor(public id: string, public color?: unknown) {}
  },
  EventEmitter: class {
    private listeners: Array<(e?: any) => void> = [];
    event = (listener: (e?: any) => void) => {
      this.listeners.push(listener);
      return {
        dispose: () => {
          const idx = this.listeners.indexOf(listener);
          if (idx >= 0) this.listeners.splice(idx, 1);
        },
      };
    };
    fire = (data?: any) => {
      for (const l of [...this.listeners]) {
        try {
          l(data);
        } catch (err) {
          console.error('[EventEmitter error]', err);
        }
      }
    };
    dispose = () => {
      this.listeners = [];
    };
  },
  Uri: {
    file: (p: string) => ({
      scheme: 'file',
      fsPath: p,
      path: p,
      toString: () => `file://${p}`,
    }),
    joinPath: (base: { fsPath: string }, ...segments: string[]) => {
      const joined = path.join(base.fsPath, ...segments);
      return {
        scheme: 'file',
        fsPath: joined,
        path: joined,
        toString: () => `file://${joined}`,
      };
    },
    parse: (val: string) => {
      const colonIdx = val.indexOf(':');
      const scheme = colonIdx >= 0 ? val.slice(0, colonIdx) : 'file';
      const rest = colonIdx >= 0 ? val.slice(colonIdx + 1) : val;
      return {
        scheme,
        fsPath: rest,
        path: rest,
        toString: () => val,
      };
    },
  },
  workspace: {
    get workspaceFolders() {
      if (!currentWorkspacePath) return [];
      return [
        {
          uri: vscodeShim.Uri.file(currentWorkspacePath),
          name: path.basename(currentWorkspacePath),
          index: 0,
        },
      ];
    },
    get isTrusted() {
      return true;
    },
    onDidGrantWorkspaceTrust: () => ({ dispose: () => {} }),
    getConfiguration: (_section?: string) => ({
      get: (key: string, defaultVal?: unknown) => {
        if (key === 'enabledAssistants') {
          return enabledAssistantsConfig;
        }
        return defaultVal;
      },
      update: async (key: string, value: any) => {
        if (key === 'enabledAssistants' && value && typeof value === 'object') {
          enabledAssistantsConfig = { ...enabledAssistantsConfig, ...value };
          for (const l of configChangeListeners) {
            l({ affectsConfiguration: (s) => s === 'aiSwissknife.enabledAssistants' || s === 'aiSwissknife' });
          }
          broadcast('treesChanged', { reason: 'configChanged' });
        }
      },
    }),
    onDidChangeConfiguration: (listener: (e: { affectsConfiguration: (s: string) => boolean }) => void) => {
      configChangeListeners.push(listener);
      return { dispose: () => {} };
    },
    createFileSystemWatcher: () => ({
      onDidChange: () => ({ dispose: () => {} }),
      onDidCreate: () => ({ dispose: () => {} }),
      onDidDelete: () => ({ dispose: () => {} }),
      dispose: () => {},
    }),
    registerTextDocumentContentProvider: (scheme: string, provider: any) => {
      contentProviders.set(scheme, provider);
      return { dispose: () => contentProviders.delete(scheme) };
    },
    openTextDocument: async (uriOrPath: any) => {
      const uri = typeof uriOrPath === 'string' ? vscodeShim.Uri.file(uriOrPath) : uriOrPath;
      let text = '';
      if (uri.scheme && contentProviders.has(uri.scheme)) {
        text = await contentProviders.get(uri.scheme).provideTextDocumentContent(uri);
      } else if (uri.fsPath && fs.existsSync(uri.fsPath)) {
        text = fs.readFileSync(uri.fsPath, 'utf-8');
      }
      return {
        uri,
        getText: () => text,
      };
    },
    fs: {
      readFile: async (uri: { fsPath: string }) => {
        return fs.promises.readFile(uri.fsPath);
      },
      writeFile: async (uri: { fsPath: string }, content: Uint8Array) => {
        await fs.promises.mkdir(path.dirname(uri.fsPath), { recursive: true });
        await fs.promises.writeFile(uri.fsPath, content);
      },
    },
  },
  window: {
    showInformationMessage: async (msg: string, ...rest: any[]) => {
      let modal = false;
      const actions: string[] = [];
      for (const arg of rest) {
        if (arg && typeof arg === 'object' && 'modal' in arg) {
          modal = Boolean(arg.modal);
        } else if (typeof arg === 'string') {
          actions.push(arg);
        } else if (arg && typeof arg === 'object' && 'title' in arg) {
          actions.push(arg.title);
        }
      }
      if (actions.length === 0 && !modal) {
        broadcast('toast', { severity: 'info', message: msg });
        return undefined;
      }
      return createPrompt('message', { severity: 'info', message: msg, modal, actions });
    },
    showWarningMessage: async (msg: string, ...rest: any[]) => {
      let modal = false;
      const actions: string[] = [];
      for (const arg of rest) {
        if (arg && typeof arg === 'object' && 'modal' in arg) {
          modal = Boolean(arg.modal);
        } else if (typeof arg === 'string') {
          actions.push(arg);
        } else if (arg && typeof arg === 'object' && 'title' in arg) {
          actions.push(arg.title);
        }
      }
      if (actions.length === 0 && !modal) {
        broadcast('toast', { severity: 'warning', message: msg });
        return undefined;
      }
      return createPrompt('message', { severity: 'warning', message: msg, modal, actions });
    },
    showErrorMessage: async (msg: string, ...rest: any[]) => {
      let modal = false;
      const actions: string[] = [];
      for (const arg of rest) {
        if (arg && typeof arg === 'object' && 'modal' in arg) {
          modal = Boolean(arg.modal);
        } else if (typeof arg === 'string') {
          actions.push(arg);
        } else if (arg && typeof arg === 'object' && 'title' in arg) {
          actions.push(arg.title);
        }
      }
      if (actions.length === 0 && !modal) {
        broadcast('toast', { severity: 'error', message: msg });
        return undefined;
      }
      return createPrompt('message', { severity: 'error', message: msg, modal, actions });
    },
    showQuickPick: async (itemsOrPromise: any, options?: any) => {
      const resolvedItems = await Promise.resolve(itemsOrPromise);
      if (!Array.isArray(resolvedItems)) return undefined;
      const serialized = resolvedItems.map((item, idx) => {
        if (typeof item === 'string') {
          return { index: idx, label: item, isString: true };
        }
        return {
          index: idx,
          label: item.label ?? String(item),
          description: item.description ?? '',
          detail: item.detail ?? '',
          picked: Boolean(item.picked),
        };
      });
      return createPrompt(
        'quickPick',
        {
          items: serialized,
          canPickMany: Boolean(options?.canPickMany),
          placeHolder: options?.placeHolder ?? options?.title ?? 'Select an option',
        },
        resolvedItems
      );
    },
    showInputBox: async (options?: any) => {
      return createPrompt('inputBox', {
        prompt: options?.prompt ?? '',
        placeHolder: options?.placeHolder ?? '',
        value: options?.value ?? '',
        title: options?.title ?? '',
        hasValidator: typeof options?.validateInput === 'function',
        validateInput: options?.validateInput,
      });
    },
    showOpenDialog: async (options?: any) => {
      const chosenPath = await createPrompt<string | undefined>('openDialog', {
        openLabel: options?.openLabel ?? 'Select',
        canSelectFolders: Boolean(options?.canSelectFolders),
        canSelectFiles: options?.canSelectFiles !== false,
        defaultPath: currentWorkspacePath,
      });
      if (!chosenPath) return undefined;
      return [vscodeShim.Uri.file(chosenPath)];
    },
    showSaveDialog: async (options?: any) => {
      const defaultPath = options?.defaultUri?.fsPath
        ? path.resolve(currentWorkspacePath, path.basename(options.defaultUri.fsPath))
        : path.join(currentWorkspacePath, 'export.json');
      const chosenPath = await createPrompt<string | undefined>('saveDialog', {
        defaultPath,
      });
      if (!chosenPath) return undefined;
      return vscodeShim.Uri.file(chosenPath);
    },
    createOutputChannel: (name: string) => ({
      name,
      append: (v: string) => broadcast('output', { name, text: v }),
      appendLine: (v: string) => broadcast('output', { name, text: v + '\n' }),
      clear: () => {},
      show: () => {},
      hide: () => {},
      dispose: () => {},
    }),
    withProgress: async (options: any, task: (progress: any) => Promise<any>) => {
      const title = options?.title || 'Working...';
      broadcast('progress', { active: true, title });
      try {
        return await task({
          report: (inc: any) => {
            if (inc?.message) {
              broadcast('progress', { active: true, title: `${title}: ${inc.message}` });
            }
          },
        });
      } finally {
        broadcast('progress', { active: false });
      }
    },
    setStatusBarMessage: (msg: string) => {
      broadcast('statusMessage', { message: msg });
      return {
        dispose: () => broadcast('statusMessage', { message: '' }),
      };
    },
    createStatusBarItem: () => {
      const item = {
        get text() {
          return statusBarState.text;
        },
        set text(v: string) {
          statusBarState.text = v;
          broadcast('statusBar', statusBarState);
        },
        get tooltip() {
          return statusBarState.tooltip;
        },
        set tooltip(v: string) {
          statusBarState.tooltip = v;
          broadcast('statusBar', statusBarState);
        },
        get command() {
          return statusBarState.command;
        },
        set command(v: string) {
          statusBarState.command = v;
          broadcast('statusBar', statusBarState);
        },
        show: () => {
          statusBarState.visible = true;
          broadcast('statusBar', statusBarState);
        },
        hide: () => {
          statusBarState.visible = false;
          broadcast('statusBar', statusBarState);
        },
        dispose: () => {},
      };
      return item;
    },
    registerTreeDataProvider: (viewId: string, provider: any) => {
      treeProviders.set(viewId, provider);
      if (typeof provider.onDidChangeTreeData === 'function') {
        provider.onDidChangeTreeData(() => {
          broadcast('treesChanged', { viewId });
        });
      }
      return { dispose: () => treeProviders.delete(viewId) };
    },
    createTreeView: (viewId: string, options: { treeDataProvider: any }) => {
      if (options?.treeDataProvider) {
        vscodeShim.window.registerTreeDataProvider(viewId, options.treeDataProvider);
      }
      return {
        onDidChangeSelection: () => ({ dispose: () => {} }),
        reveal: async () => {},
        dispose: () => {},
      };
    },
    createWebviewPanel: (viewType: string, title: string) => {
      const panelState = {
        viewType,
        title,
        html: '',
        msgHandler: undefined as ((msg: any) => Promise<any>) | undefined,
        disposeHandlers: [] as Array<() => void>,
      };
      webviewPanels.set(viewType, panelState);

      const panel = {
        get title() {
          return panelState.title;
        },
        set title(v: string) {
          panelState.title = v;
          broadcast('webviewMeta', { viewType, title: v });
        },
        reveal: () => {
          broadcast('webviewReveal', { viewType, title: panelState.title });
        },
        dispose: () => {
          webviewPanels.delete(viewType);
          for (const h of panelState.disposeHandlers) h();
          broadcast('webviewDisposed', { viewType });
        },
        onDidDispose: (cb: () => void) => {
          panelState.disposeHandlers.push(cb);
          return { dispose: () => {} };
        },
        webview: {
          get html() {
            return panelState.html;
          },
          set html(v: string) {
            panelState.html = rewriteWebviewResourceUrls(v);
            broadcast('webviewHtml', {
              viewType,
              title: panelState.title,
              html: prepareWebviewHtmlForIframe(panelState.html, viewType),
            });
          },
          asWebviewUri: (uri: { fsPath: string }) => {
            return `/fs?path=${encodeURIComponent(uri.fsPath)}`;
          },
          onDidReceiveMessage: (handler: (msg: any) => Promise<any>) => {
            panelState.msgHandler = handler;
            return { dispose: () => {} };
          },
          postMessage: async (msg: any) => {
            broadcast('webviewMessage', { viewType, message: rewriteWebviewMessageDeep(msg) });
            return true;
          },
        },
      };
      return panel;
    },
    showTextDocument: async (docOrUri: any) => {
      const uri = docOrUri?.uri ?? docOrUri;
      await openDocumentPreview(uri);
    },
  },
  commands: {
    registerCommand: (command: string, callback: (...args: any[]) => any) => {
      registeredCommands.set(command, callback);
      return { dispose: () => registeredCommands.delete(command) };
    },
    executeCommand: async (command: string, ...args: any[]) => {
      console.log('[standalone] executeCommand:', command, args);
      if (command === 'setContext') {
        const [k, v] = args;
        contextKeys.set(String(k), v);
        broadcast('contextChanged', { key: k, value: v });
        return undefined;
      }
      if (command === 'vscode.open') {
        const [uri] = args;
        await openDocumentPreview(uri);
        return undefined;
      }
      if (command === 'vscode.diff') {
        const [leftUri, rightUri, title] = args;
        const leftText = await readUriContent(leftUri);
        const rightText = await readUriContent(rightUri);
        broadcast('diffModal', {
          title: title || 'Diff',
          leftLabel: leftUri?.fsPath || leftUri?.toString() || 'Original',
          rightLabel: rightUri?.fsPath || rightUri?.toString() || 'Local',
          leftText,
          rightText,
        });
        return undefined;
      }
      if (command.endsWith('.focus')) {
        broadcast('focusView', { viewId: command.replace(/\.focus$/, '') });
        return undefined;
      }
      const handler = registeredCommands.get(command);
      if (handler) {
        return await handler(...args);
      }
      return undefined;
    },
  },
};

async function readUriContent(uri: any): Promise<string> {
  if (!uri) return '';
  if (uri.scheme && contentProviders.has(uri.scheme)) {
    return contentProviders.get(uri.scheme).provideTextDocumentContent(uri) ?? '';
  }
  if (uri.fsPath && fs.existsSync(uri.fsPath)) {
    try {
      const stat = fs.statSync(uri.fsPath);
      if (stat.isDirectory()) {
        const skillMd = path.join(uri.fsPath, 'SKILL.md');
        if (fs.existsSync(skillMd)) {
          return fs.readFileSync(skillMd, 'utf-8');
        }
        return `[Directory: ${uri.fsPath}]\n\nEntries:\n` + fs.readdirSync(uri.fsPath).join('\n');
      }
      return fs.readFileSync(uri.fsPath, 'utf-8');
    } catch (err) {
      return `Error reading ${uri.fsPath}: ${err}`;
    }
  }
  return '';
}

async function openDocumentPreview(uri: any) {
  const content = await readUriContent(uri);
  const title = uri?.fsPath ? path.basename(uri.fsPath) : (uri?.toString() || 'Preview');
  const subtitle = uri?.fsPath || uri?.toString() || '';
  broadcast('filePreviewModal', { title, subtitle, content });
}

// Install module hook before importing any extension modules
Module.prototype.require = function (id: string, ...rest: unknown[]) {
  if (id === 'vscode') {
    return vscodeShim;
  }
  return originalRequire.apply(this, [id, ...rest]);
};

// Now import and activate the extension!
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { activate } = require('../extension');

const extensionContext = {
  subscriptions: [] as any[],
  extensionUri: vscodeShim.Uri.file(extensionRoot),
  extensionPath: extensionRoot,
  workspaceState: {
    get: <T>(key: string, defaultValue?: T): T | undefined => {
      return (workspaceStateStore.has(key) ? workspaceStateStore.get(key) : defaultValue) as T | undefined;
    },
    update: async (key: string, value: unknown) => {
      workspaceStateStore.set(key, value);
    },
  },
  globalState: {
    get: () => undefined,
    update: async () => {},
  },
};

// Node registry so the browser can expand tree nodes or invoke inline item commands by handle ID
const nodeObjectRegistry = new Map<string, { viewId: string; element: any }>();
let nodeSeq = 0;

function registerNodeObject(viewId: string, element: any): string {
  const id = `node-${++nodeSeq}`;
  nodeObjectRegistry.set(id, { viewId, element });
  return id;
}

// Evaluate simple `when` expressions from package.json for menus
function matchViewItem(expr: string, viewId: string, contextValue: string): boolean {
  const parts = expr.split('&&').map((s) => s.trim());
  for (const part of parts) {
    if (part.startsWith('view ==')) {
      const target = part.slice('view =='.length).trim();
      if (viewId !== target) return false;
    } else if (part.startsWith('view =~')) {
      const m = part.match(/view\s*=~\s*\/(.*)\//);
      if (m && !new RegExp(m[1]).test(viewId)) return false;
    } else if (part.startsWith('viewItem ==')) {
      const target = part.slice('viewItem =='.length).trim();
      if (contextValue !== target) return false;
    } else if (part.startsWith('viewItem !=')) {
      const target = part.slice('viewItem !='.length).trim();
      if (contextValue === target) return false;
    } else if (part.startsWith('viewItem =~')) {
      const m = part.match(/viewItem\s*=~\s*\/(.*)\//);
      if (m && !new RegExp(m[1]).test(contextValue)) return false;
    } else if (part.startsWith('aiSwissknife.')) {
      if (!contextKeys.get(part)) return false;
    }
  }
  return true;
}

const commandMetaMap = new Map<string, { title: string; icon?: string }>();
for (const cmd of pkgJson.contributes?.commands ?? []) {
  commandMetaMap.set(cmd.command, { title: cmd.title, icon: cmd.icon });
}

function getActionsForTreeItem(viewId: string, contextValue: string) {
  const itemMenus = pkgJson.contributes?.menus?.['view/item/context'] ?? [];
  const actions: Array<{ command: string; title: string; icon?: string; group?: string }> = [];
  for (const entry of itemMenus) {
    if (entry.when && matchViewItem(entry.when, viewId, contextValue)) {
      const meta: { title: string; icon?: string } = commandMetaMap.get(entry.command) ?? { title: entry.command };
      actions.push({
        command: entry.command,
        title: meta.title,
        icon: meta.icon,
        group: entry.group,
      });
    }
  }
  return actions;
}

function getActionsForViewTitle(viewId: string) {
  const titleMenus = pkgJson.contributes?.menus?.['view/title'] ?? [];
  const actions: Array<{ command: string; title: string; icon?: string; group?: string }> = [];
  for (const entry of titleMenus) {
    if (entry.when && matchViewItem(entry.when, viewId, '')) {
      const meta: { title: string; icon?: string } = commandMetaMap.get(entry.command) ?? { title: entry.command };
      actions.push({
        command: entry.command,
        title: meta.title,
        icon: meta.icon,
        group: entry.group,
      });
    }
  }
  return actions;
}

async function serializeChildren(viewId: string, parentElement?: any): Promise<any[]> {
  const provider = treeProviders.get(viewId);
  if (!provider) return [];
  const children = (await provider.getChildren(parentElement)) ?? [];
  const result = [];
  for (const child of children) {
    const treeItem = await provider.getTreeItem(child);
    const nodeId = registerNodeObject(viewId, child);
    const contextValue = treeItem.contextValue ?? '';
    const actions = getActionsForTreeItem(viewId, contextValue);

    let icon: any = null;
    if (treeItem.iconPath) {
      if (typeof treeItem.iconPath === 'object' && 'id' in treeItem.iconPath) {
        icon = { type: 'codicon', id: (treeItem.iconPath as any).id };
      } else if (typeof treeItem.iconPath === 'object' && 'light' in treeItem.iconPath) {
        icon = { type: 'uri', path: (treeItem.iconPath as any).light.fsPath };
      } else if (typeof treeItem.iconPath === 'object' && 'fsPath' in treeItem.iconPath) {
        icon = { type: 'uri', path: (treeItem.iconPath as any).fsPath };
      }
    }

    result.push({
      nodeId,
      label: typeof treeItem.label === 'string' ? treeItem.label : treeItem.label?.label ?? '',
      description: treeItem.description ?? '',
      tooltip: typeof treeItem.tooltip === 'string' ? treeItem.tooltip : '',
      collapsibleState: treeItem.collapsibleState ?? 0,
      contextValue,
      icon,
      command: treeItem.command
        ? {
            command: treeItem.command.command,
            title: treeItem.command.title,
          }
        : null,
      actions,
    });
  }
  return result;
}

async function getExplorerViewsSnapshot() {
  const declaredViews = pkgJson.contributes?.views?.['ai-swissknife'] ?? [];
  const views = [];
  for (const v of declaredViews) {
    if (v.when && contextKeys.get(v.when) === false) {
      continue;
    }
    const titleActions = getActionsForViewTitle(v.id);
    const rootNodes = await serializeChildren(v.id, undefined);
    views.push({
      id: v.id,
      name: v.name,
      titleActions,
      rootNodes,
    });
  }
  return {
    workspace: currentWorkspacePath,
    home: config.home,
    statusBar: statusBarState,
    views,
  };
}

// Inject standalone bridge into Dashboard / FormEditor webview HTML
function prepareWebviewHtmlForIframe(rawHtml: string, viewType: string, theme: 'dark' | 'light' = 'dark'): string {
  const darkVars = `
    :root {
      --vscode-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      --vscode-editor-font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace;
      --vscode-editor-background: #1e1e1e;
      --vscode-editor-foreground: #cccccc;
      --vscode-sideBar-background: #252526;
      --vscode-panel-border: #333333;
      --vscode-button-background: #0e639c;
      --vscode-button-foreground: #ffffff;
      --vscode-button-hoverBackground: #1177bb;
      --vscode-input-background: #3c3c3c;
      --vscode-input-foreground: #cccccc;
      --vscode-input-border: #555555;
      --vscode-charts-blue: #58a6ff;
      color-scheme: dark;
    }
  `;
  const lightVars = `
    :root {
      --vscode-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      --vscode-editor-font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace;
      --vscode-editor-background: #ffffff;
      --vscode-editor-foreground: #1f2328;
      --vscode-sideBar-background: #f6f8fa;
      --vscode-panel-border: #d0d7de;
      --vscode-button-background: #0969da;
      --vscode-button-foreground: #ffffff;
      --vscode-button-hoverBackground: #0860ca;
      --vscode-input-background: #ffffff;
      --vscode-input-foreground: #1f2328;
      --vscode-input-border: #d0d7de;
      --vscode-charts-blue: #0969da;
      color-scheme: light;
    }
  `;

  const bridgeScript = `
    <style id="vscode-theme-vars">${theme === 'light' ? lightVars : darkVars}</style>
    <script>
      (function() {
        const VIEW_TYPE = ${JSON.stringify(viewType)};
        let savedState = {};
        const api = {
          postMessage: function(message) {
            fetch('/api/webview/message', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ viewType: VIEW_TYPE, message: message })
            }).catch(function(err) {
              console.error('[standalone bridge] postMessage error:', err);
            });
          },
          getState: function() { return savedState; },
          setState: function(s) { savedState = s; return s; }
        };
        window.vscode = api;
        window.acquireVsCodeApi = function() {
          return api;
        };

        // Listen for messages forwarded by the parent workbench frame
        window.addEventListener('message', function(ev) {
          if (ev.data && ev.data.__standaloneTheme) {
            const styleEl = document.getElementById('vscode-theme-vars');
            if (styleEl) {
              styleEl.textContent = ev.data.__standaloneTheme === 'light'
                ? ${JSON.stringify(lightVars)}
                : ${JSON.stringify(darkVars)};
            }
          }
        });
      })();
    </script>
  `;

  if (rawHtml.includes('<head>')) {
    return rawHtml.replace('<head>', '<head>' + bridgeScript);
  }
  return bridgeScript + rawHtml;
}

// Workbench Shell HTML (Activity Bar + Explorer Sidebar + Webview Tabs + Modals)
function getWorkbenchShellHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AI Swissknife — Standalone Workbench</title>
  <style>
    :root {
      --bg: #1e1e1e;
      --fg: #cccccc;
      --sidebar-bg: #252526;
      --activitybar-bg: #333333;
      --header-bg: #2d2d2d;
      --border: #333333;
      --hover-bg: rgba(255, 255, 255, 0.06);
      --selected-bg: rgba(14, 99, 156, 0.35);
      --accent: #0e639c;
      --accent-fg: #ffffff;
      --input-bg: #3c3c3c;
      --input-border: #555555;
      --badge-info: #58a6ff;
      --badge-warn: #d29922;
      --badge-err: #f85149;
      --badge-ok: #3fb950;
      --statusbar-bg: #007acc;
      --statusbar-fg: #ffffff;
    }
    body.light {
      --bg: #ffffff;
      --fg: #1f2328;
      --sidebar-bg: #f6f8fa;
      --activitybar-bg: #24292f;
      --header-bg: #eaeef2;
      --border: #d0d7de;
      --hover-bg: rgba(0, 0, 0, 0.05);
      --selected-bg: rgba(9, 105, 218, 0.15);
      --accent: #0969da;
      --accent-fg: #ffffff;
      --input-bg: #ffffff;
      --input-border: #d0d7de;
      --statusbar-bg: #0969da;
      --statusbar-fg: #ffffff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--fg);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      font-size: 13px;
    }
    /* Top Dev Toolbar */
    .dev-topbar {
      height: 38px;
      background: var(--header-bg);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 12px;
      gap: 12px;
      flex-shrink: 0;
    }
    .dev-brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      font-size: 13px;
    }
    .dev-brand img {
      width: 18px;
      height: 18px;
    }
    .dev-workspace-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      flex: 1;
      max-width: 620px;
    }
    .dev-workspace-bar label {
      opacity: 0.7;
      font-size: 11px;
      text-transform: uppercase;
      font-weight: 600;
    }
    .dev-workspace-bar input {
      flex: 1;
      background: var(--input-bg);
      color: var(--fg);
      border: 1px solid var(--input-border);
      border-radius: 4px;
      padding: 4px 8px;
      font-size: 12px;
      font-family: monospace;
    }
    .dev-controls {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .dev-btn {
      background: var(--accent);
      color: var(--accent-fg);
      border: 1px solid transparent;
      border-radius: 4px;
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .dev-btn.secondary {
      background: rgba(128,128,128,0.15);
      color: var(--fg);
      border-color: var(--border);
    }
    .dev-btn:hover { opacity: 0.9; }

    /* Main Workspace Layout */
    .workbench-main {
      flex: 1;
      display: flex;
      min-height: 0;
      overflow: hidden;
    }
    /* Left Explorer Sidebar */
    .sidebar {
      width: 340px;
      min-width: 240px;
      max-width: 600px;
      background: var(--sidebar-bg);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      user-select: none;
      flex-shrink: 0;
    }
    .sidebar.collapsed {
      display: none;
    }
    .sidebar-header {
      padding: 8px 12px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      opacity: 0.85;
    }
    .sidebar-views {
      flex: 1;
      overflow-y: auto;
    }
    /* Accordion View Section */
    .view-pane {
      border-bottom: 1px solid var(--border);
    }
    .view-pane-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 8px;
      cursor: pointer;
      background: rgba(128, 128, 128, 0.08);
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
    .view-pane-header:hover {
      background: var(--hover-bg);
    }
    .view-pane-title {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .view-pane-actions {
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .icon-btn {
      background: transparent;
      color: var(--fg);
      border: none;
      border-radius: 3px;
      padding: 2px 5px;
      font-size: 12px;
      cursor: pointer;
      opacity: 0.75;
    }
    .icon-btn:hover {
      opacity: 1;
      background: rgba(128, 128, 128, 0.25);
    }
    .view-pane-body {
      padding: 2px 0 6px 0;
    }
    .tree-node-row {
      display: flex;
      align-items: center;
      padding: 3px 8px;
      cursor: pointer;
      gap: 5px;
      font-size: 12px;
      position: relative;
    }
    .tree-node-row:hover {
      background: var(--hover-bg);
    }
    .tree-node-row .node-actions {
      display: none;
      margin-left: auto;
      gap: 2px;
      align-items: center;
      background: var(--sidebar-bg);
      padding-left: 4px;
    }
    .tree-node-row:hover .node-actions {
      display: inline-flex;
    }
    .node-caret {
      width: 14px;
      display: inline-block;
      text-align: center;
      font-size: 10px;
      opacity: 0.75;
      flex-shrink: 0;
    }
    .node-icon {
      width: 16px;
      text-align: center;
      flex-shrink: 0;
      font-size: 12px;
    }
    .node-label {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-weight: 500;
    }
    .node-desc {
      opacity: 0.6;
      font-size: 11px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-left: 4px;
    }
    .tree-empty {
      padding: 8px 24px;
      opacity: 0.55;
      font-size: 11px;
      font-style: italic;
    }

    /* Resizer handle */
    .resizer {
      width: 4px;
      cursor: col-resize;
      background: transparent;
      flex-shrink: 0;
    }
    .resizer:hover {
      background: var(--accent);
    }

    /* Right Editor / Webview Area */
    .editor-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
      background: var(--bg);
    }
    .editor-tabs {
      height: 34px;
      background: var(--header-bg);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      padding: 0 8px;
      gap: 4px;
    }
    .editor-tab {
      padding: 6px 12px;
      font-size: 12px;
      cursor: pointer;
      border-radius: 4px 4px 0 0;
      background: transparent;
      color: var(--fg);
      border: 1px solid transparent;
      border-bottom: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      opacity: 0.7;
    }
    .editor-tab.active {
      background: var(--bg);
      border-color: var(--border);
      opacity: 1;
      font-weight: 600;
    }
    .editor-tab-close {
      opacity: 0.6;
      font-size: 11px;
      padding: 0 2px;
    }
    .editor-tab-close:hover {
      opacity: 1;
      color: var(--badge-err);
    }
    .webview-container {
      flex: 1;
      position: relative;
      min-height: 0;
    }
    .webview-iframe {
      width: 100%;
      height: 100%;
      border: none;
      display: none;
      background: var(--bg);
    }
    .webview-iframe.active {
      display: block;
    }

    /* Status bar */
    .statusbar {
      height: 24px;
      background: var(--statusbar-bg);
      color: var(--statusbar-fg);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 10px;
      font-size: 11px;
      flex-shrink: 0;
    }
    .statusbar-left, .statusbar-right {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .statusbar-item {
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 3px;
    }
    .statusbar-item:hover {
      background: rgba(255,255,255,0.15);
    }

    /* Modals (QuickPick / InputBox / Message / Preview / Diff) */
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      display: none;
      align-items: flex-start;
      justify-content: center;
      padding-top: 60px;
      z-index: 1000;
    }
    .modal-backdrop.open {
      display: flex;
    }
    .modal-card {
      background: var(--sidebar-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      width: 560px;
      max-width: 92vw;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 12px 36px rgba(0,0,0,0.45);
      overflow: hidden;
    }
    .modal-card.wide {
      width: 920px;
    }
    .modal-header {
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .modal-body {
      padding: 12px 14px;
      overflow-y: auto;
      flex: 1;
    }
    .modal-footer {
      padding: 8px 14px;
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .qp-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin-top: 6px;
    }
    .qp-item {
      padding: 7px 10px;
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      border: 1px solid transparent;
    }
    .qp-item:hover {
      background: var(--hover-bg);
      border-color: var(--border);
    }
    .qp-item-label { font-weight: 500; }
    .qp-item-desc { opacity: 0.65; font-size: 11px; margin-left: 6px; }
    .modal-input {
      width: 100%;
      background: var(--input-bg);
      color: var(--fg);
      border: 1px solid var(--input-border);
      border-radius: 4px;
      padding: 7px 10px;
      font-size: 13px;
    }
    .code-preview {
      margin: 0;
      padding: 12px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 60vh;
      overflow-y: auto;
    }
    .diff-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .diff-col h4 {
      margin: 0 0 6px 0;
      font-size: 11px;
      opacity: 0.75;
      font-family: monospace;
    }

    /* Toast container */
    .toast-container {
      position: fixed;
      bottom: 34px;
      right: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      z-index: 900;
      max-width: 420px;
    }
    .toast {
      background: var(--sidebar-bg);
      border: 1px solid var(--border);
      border-left: 4px solid var(--accent);
      padding: 10px 12px;
      border-radius: 4px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.35);
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .toast.warning { border-left-color: var(--badge-warn); }
    .toast.error { border-left-color: var(--badge-err); }
  </style>
</head>
<body>
  <div class="dev-topbar">
    <div class="dev-brand">
      <button class="dev-btn secondary" onclick="toggleSidebar()" title="Toggle Explorer Sidebar">☰ Explorer</button>
      <span>AI Swissknife Workbench</span>
    </div>
    <div class="dev-workspace-bar">
      <label for="wsInput">Workspace:</label>
      <input id="wsInput" type="text" value="" placeholder="/path/to/workspace" onkeydown="if(event.key==='Enter') changeWorkspace()" />
      <button class="dev-btn secondary" onclick="changeWorkspace()">Switch</button>
    </div>
    <div class="dev-controls">
      <button class="dev-btn" onclick="execCommand('aiSwissknife.openDashboard')">⊞ Open Dashboard</button>
      <button class="dev-btn secondary" onclick="openCommandPalette()">⌘ Command Palette</button>
      <button class="dev-btn secondary" onclick="toggleTheme()" id="themeBtn">☀ Light / Dark</button>
    </div>
  </div>

  <div class="workbench-main">
    <div class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <span>AI Swissknife Explorer</span>
        <button class="icon-btn" title="Refresh All Explorer Trees" onclick="refreshAllTrees()">↻</button>
      </div>
      <div class="sidebar-views" id="sidebarViews"></div>
    </div>
    <div class="resizer" id="sidebarResizer"></div>
    <div class="editor-area">
      <div class="editor-tabs" id="editorTabs"></div>
      <div class="webview-container" id="webviewContainer"></div>
    </div>
  </div>

  <div class="statusbar">
    <div class="statusbar-left">
      <span id="progressStatus">Ready</span>
      <span id="tempStatusMsg"></span>
    </div>
    <div class="statusbar-right">
      <span class="statusbar-item" id="swkStatusBar" onclick="execCommand('aiSwissknife.openDashboard')">AI Swissknife</span>
    </div>
  </div>

  <!-- Interactive Prompt Modal (QuickPick / InputBox / Message) -->
  <div class="modal-backdrop" id="promptModal">
    <div class="modal-card" id="promptCard">
      <div class="modal-header">
        <span id="promptTitle">Prompt</span>
        <button class="icon-btn" onclick="cancelActivePrompt()">✕</button>
      </div>
      <div class="modal-body" id="promptBody"></div>
      <div class="modal-footer" id="promptFooter"></div>
    </div>
  </div>

  <!-- File Preview / Diff Modal -->
  <div class="modal-backdrop" id="viewerModal">
    <div class="modal-card wide">
      <div class="modal-header">
        <span id="viewerTitle">Preview</span>
        <button class="icon-btn" onclick="closeViewerModal()">✕</button>
      </div>
      <div class="modal-body" id="viewerBody"></div>
      <div class="modal-footer">
        <button class="dev-btn secondary" onclick="closeViewerModal()">Close</button>
      </div>
    </div>
  </div>

  <div class="toast-container" id="toastContainer"></div>

  <script>
    let currentTheme = 'dark';
    let expandedViews = new Set(['aiSwissknife.sources', 'aiSwissknife.installed.claude-code', 'aiSwissknife.installed.kilo-code']);
    let expandedNodePaths = new Set(['aiSwissknife.sources::Global Sources', 'aiSwissknife.sources::Workspace Sources', 'aiSwissknife.installed.claude-code::Global', 'aiSwissknife.installed.kilo-code::Global']);
    let childrenCache = new Map();
    let webviews = new Map(); // viewType -> { title, html, iframe }
    let activeWebviewType = null;
    let activePrompt = null;

    const CODICON_MAP = {
      'plus': '＋',
      'trash': '🗑',
      'refresh': '↻',
      'sync': '⇄',
      'sync~spin': '⏳',
      'export': '⇧',
      'desktop-download': '⬇',
      'cloud-download': '⬇',
      'eye': '👁',
      'arrow-circle-up': '⟳',
      'diff': '⇄',
      'diff-modified': '✎',
      'shield': '🛡',
      'arrow-right': '⇥',
      'new-file': '＋',
      'edit': '✎',
      'star-empty': '☆',
      'star-full': '★',
      'dashboard': '⊞',
      'sparkle': '✦',
      'history': '↺',
      'clear-all': '🧹',
      'gear': '⚙',
      'globe': '🌐',
      'folder': '📁',
      'file': '📄',
      'lightbulb': '💡',
      'robot': '🤖',
      'terminal': '❯_',
      'plug': '🔌',
      'zap': '⚡',
      'book': '📖',
      'pass': '✓',
      'warning': '⚠️',
      'error': '🔴',
      'repo': '📦',
      'package': '📦',
      'link-external': '🔗',
      'git-commit': '⊙'
    };

    function codiconToGlyph(iconStr) {
      if (!iconStr) return '';
      const m = iconStr.match(/\\$\\(([^)]+)\\)/);
      const id = m ? m[1] : iconStr;
      return CODICON_MAP[id] || '•';
    }

    function escapeHtml(s) {
      return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function toggleSidebar() {
      document.getElementById('sidebar').classList.toggle('collapsed');
    }

    function toggleTheme() {
      currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
      document.body.classList.toggle('light', currentTheme === 'light');
      for (const [, w] of webviews) {
        if (w.iframe && w.iframe.contentWindow) {
          w.iframe.contentWindow.postMessage({ __standaloneTheme: currentTheme }, '*');
        }
      }
    }

    function showToast(severity, message) {
      const container = document.getElementById('toastContainer');
      const el = document.createElement('div');
      el.className = 'toast ' + (severity || 'info');
      el.innerHTML = '<span>' + escapeHtml(message) + '</span><button class="icon-btn" onclick="this.parentElement.remove()">✕</button>';
      container.appendChild(el);
      setTimeout(() => { if (el.parentElement) el.remove(); }, 5000);
    }

    async function execCommand(command, nodeId) {
      await fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, nodeId })
      });
    }

    async function changeWorkspace() {
      const ws = document.getElementById('wsInput').value.trim();
      if (!ws) return;
      await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace: ws })
      });
    }

    async function refreshAllTrees() {
      childrenCache.clear();
      await loadExplorerSnapshot();
    }

    async function loadExplorerSnapshot() {
      const res = await fetch('/api/explorer');
      const data = await res.json();
      document.getElementById('wsInput').value = data.workspace || '';
      updateStatusBarUI(data.statusBar);
      await renderExplorerViews(data.views || []);
    }

    function updateStatusBarUI(sb) {
      if (!sb) return;
      const el = document.getElementById('swkStatusBar');
      el.textContent = sb.text.replace(/\\$\\([^)]+\\)\\s*/g, '⊞ ');
      el.title = sb.tooltip || '';
    }

    async function renderExplorerViews(views) {
      const container = document.getElementById('sidebarViews');
      let html = '';
      for (const v of views) {
        const isOpen = expandedViews.has(v.id);
        const actionsHtml = (v.titleActions || []).map(a => {
          const glyph = codiconToGlyph(a.icon) || a.title.slice(0, 2);
          return '<button class="icon-btn" title="' + escapeHtml(a.title) + '" onclick="event.stopPropagation(); execCommand(\\'' + escapeHtml(a.command) + '\\')">' + escapeHtml(glyph) + '</button>';
        }).join('');

        html += '<div class="view-pane" data-view-id="' + escapeHtml(v.id) + '">';
        html += '  <div class="view-pane-header" onclick="toggleViewPane(\\'' + escapeHtml(v.id) + '\\')">';
        html += '    <div class="view-pane-title"><span>' + (isOpen ? '▼' : '▶') + '</span><span>' + escapeHtml(v.name) + '</span></div>';
        html += '    <div class="view-pane-actions" onclick="event.stopPropagation()">' + actionsHtml + '</div>';
        html += '  </div>';
        if (isOpen) {
          html += '  <div class="view-pane-body" id="view-body-' + escapeHtml(v.id) + '">';
          html += await renderTreeNodesHtml(v.id, v.rootNodes || [], 0, v.id);
          html += '  </div>';
        }
        html += '</div>';
      }
      container.innerHTML = html;
    }

    async function renderTreeNodesHtml(viewId, nodes, depth, pathPrefix) {
      if (!nodes || nodes.length === 0) {
        return '<div class="tree-empty">No items</div>';
      }
      let html = '';
      for (const n of nodes) {
        const stableKey = pathPrefix + '::' + n.label;
        const hasChildren = n.collapsibleState !== 0;
        const isExpanded = hasChildren && expandedNodePaths.has(stableKey);

        let iconHtml = '';
        if (n.icon) {
          if (n.icon.type === 'codicon') {
            iconHtml = '<span class="node-icon">' + escapeHtml(codiconToGlyph('$(' + n.icon.id + ')')) + '</span>';
          } else if (n.icon.type === 'uri') {
            iconHtml = '<img class="node-icon" src="/fs?path=' + encodeURIComponent(n.icon.path) + '" width="14" height="14" />';
          }
        }

        const actionsHtml = (n.actions || []).map(a => {
          const glyph = codiconToGlyph(a.icon) || '•';
          return '<button class="icon-btn" title="' + escapeHtml(a.title) + '" onclick="event.stopPropagation(); execCommand(\\'' + escapeHtml(a.command) + '\\', \\'' + escapeHtml(n.nodeId) + '\\')">' + escapeHtml(glyph) + '</button>';
        }).join('');

        const padLeft = 8 + depth * 14;
        html += '<div class="tree-node-row" style="padding-left:' + padLeft + 'px" title="' + escapeHtml(n.tooltip || n.label) + '" onclick="handleNodeClick(\\'' + escapeHtml(viewId) + '\\', \\'' + escapeHtml(n.nodeId) + '\\', \\'' + escapeHtml(stableKey).replace(/'/g, "\\\\'") + '\\', ' + hasChildren + ', ' + Boolean(n.command) + ')">';
        html += '  <span class="node-caret">' + (hasChildren ? (isExpanded ? '▼' : '▶') : '') + '</span>';
        html += iconHtml;
        html += '  <span class="node-label">' + escapeHtml(n.label) + '</span>';
        if (n.description) {
          html += '  <span class="node-desc">' + escapeHtml(n.description) + '</span>';
        }
        html += '  <div class="node-actions">' + actionsHtml + '</div>';
        html += '</div>';

        if (isExpanded) {
          let children = childrenCache.get(n.nodeId);
          if (!children) {
            const res = await fetch('/api/explorer/children?nodeId=' + encodeURIComponent(n.nodeId));
            const data = await res.json();
            children = data.children || [];
            childrenCache.set(n.nodeId, children);
          }
          html += await renderTreeNodesHtml(viewId, children, depth + 1, stableKey);
        }
      }
      return html;
    }

    async function toggleViewPane(viewId) {
      if (expandedViews.has(viewId)) expandedViews.delete(viewId);
      else expandedViews.add(viewId);
      await loadExplorerSnapshot();
    }

    async function handleNodeClick(viewId, nodeId, stableKey, hasChildren, hasCommand) {
      if (hasChildren) {
        if (expandedNodePaths.has(stableKey)) {
          expandedNodePaths.delete(stableKey);
        } else {
          expandedNodePaths.add(stableKey);
        }
        await loadExplorerSnapshot();
      } else if (hasCommand) {
        await fetch('/api/explorer/click', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nodeId })
        });
      }
    }

    // Webview Panel Management (Dashboard & FormEditor)
    function upsertWebviewPanel(viewType, title, html) {
      const tabsEl = document.getElementById('editorTabs');
      const containerEl = document.getElementById('webviewContainer');
      let entry = webviews.get(viewType);
      if (!entry) {
        const iframe = document.createElement('iframe');
        iframe.className = 'webview-iframe';
        iframe.dataset.viewType = viewType;
        containerEl.appendChild(iframe);
        entry = { viewType, title: title || viewType, html: '', iframe };
        webviews.set(viewType, entry);
      }
      if (title) entry.title = title;
      if (typeof html === 'string' && html !== entry.html) {
        entry.html = html;
        entry.iframe.srcdoc = html;
      }
      activateWebviewTab(viewType);
      renderWebviewTabs();
    }

    function activateWebviewTab(viewType) {
      activeWebviewType = viewType;
      for (const [vt, entry] of webviews) {
        entry.iframe.classList.toggle('active', vt === viewType);
      }
      renderWebviewTabs();
    }

    function closeWebviewTab(viewType) {
      const entry = webviews.get(viewType);
      if (entry) {
        entry.iframe.remove();
        webviews.delete(viewType);
      }
      fetch('/api/webview/dispose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewType })
      });
      if (activeWebviewType === viewType) {
        const first = webviews.keys().next().value || null;
        activeWebviewType = first;
        if (first) activateWebviewTab(first);
      }
      renderWebviewTabs();
    }

    function renderWebviewTabs() {
      const tabsEl = document.getElementById('editorTabs');
      let html = '';
      for (const [vt, entry] of webviews) {
        const isActive = vt === activeWebviewType;
        html += '<div class="editor-tab ' + (isActive ? 'active' : '') + '" onclick="activateWebviewTab(\\'' + escapeHtml(vt) + '\\')">';
        html += '  <span>' + escapeHtml(entry.title) + '</span>';
        html += '  <span class="editor-tab-close" onclick="event.stopPropagation(); closeWebviewTab(\\'' + escapeHtml(vt) + '\\')">✕</span>';
        html += '</div>';
      }
      tabsEl.innerHTML = html;
    }

    // Prompt Modal Handling
    function showPromptModal(prompt) {
      activePrompt = prompt;
      const modal = document.getElementById('promptModal');
      const titleEl = document.getElementById('promptTitle');
      const bodyEl = document.getElementById('promptBody');
      const footerEl = document.getElementById('promptFooter');
      bodyEl.innerHTML = '';
      footerEl.innerHTML = '';

      if (prompt.kind === 'quickPick') {
        titleEl.textContent = prompt.options.placeHolder || 'Select';
        const items = prompt.options.items || [];
        if (prompt.options.canPickMany) {
          let listHtml = '<div class="qp-list">';
          for (const item of items) {
            listHtml += '<label class="qp-item"><input type="checkbox" class="qp-check" value="' + item.index + '" ' + (item.picked ? 'checked' : '') + ' />' +
              '<span class="qp-item-label">' + escapeHtml(item.label) + '</span>' +
              (item.description ? '<span class="qp-item-desc">' + escapeHtml(item.description) + '</span>' : '') +
              '</label>';
          }
          listHtml += '</div>';
          bodyEl.innerHTML = listHtml;
          footerEl.innerHTML = '<button class="dev-btn secondary" onclick="cancelActivePrompt()">Cancel</button>' +
            '<button class="dev-btn" onclick="submitMultiQuickPick()">OK</button>';
        } else {
          let listHtml = '<div class="qp-list">';
          for (const item of items) {
            listHtml += '<div class="qp-item" onclick="submitSingleQuickPick(' + item.index + ')">' +
              '<span class="qp-item-label">' + escapeHtml(item.label) + '</span>' +
              (item.description ? '<span class="qp-item-desc">' + escapeHtml(item.description) + '</span>' : '') +
              '</div>';
          }
          listHtml += '</div>';
          bodyEl.innerHTML = listHtml;
          footerEl.innerHTML = '<button class="dev-btn secondary" onclick="cancelActivePrompt()">Cancel</button>';
        }
      } else if (prompt.kind === 'inputBox' || prompt.kind === 'openDialog' || prompt.kind === 'saveDialog') {
        titleEl.textContent = prompt.options.prompt || prompt.options.openLabel || 'Input';
        const val = prompt.options.value || prompt.options.defaultPath || '';
        bodyEl.innerHTML = '<input type="text" id="promptInputEl" class="modal-input" value="' + escapeHtml(val) + '" placeholder="' + escapeHtml(prompt.options.placeHolder || '') + '" onkeydown="if(event.key===\\'Enter\\') submitInputPrompt()" />' +
          '<div id="promptErrorEl" style="color:var(--badge-err); font-size:11px; margin-top:6px;"></div>';
        footerEl.innerHTML = '<button class="dev-btn secondary" onclick="cancelActivePrompt()">Cancel</button>' +
          '<button class="dev-btn" onclick="submitInputPrompt()">OK</button>';
        setTimeout(() => {
          const inp = document.getElementById('promptInputEl');
          if (inp) { inp.focus(); inp.select(); }
        }, 30);
      } else if (prompt.kind === 'message') {
        titleEl.textContent = (prompt.options.severity || 'info').toUpperCase();
        bodyEl.innerHTML = '<div style="white-space:pre-wrap; line-height:1.5;">' + escapeHtml(prompt.options.message) + '</div>';
        const actions = prompt.options.actions || [];
        let btns = '<button class="dev-btn secondary" onclick="cancelActivePrompt()">Cancel</button>';
        for (const act of actions) {
          btns += '<button class="dev-btn" onclick="submitMessagePrompt(' + JSON.stringify(act).replace(/"/g, '&quot;') + ')">' + escapeHtml(act) + '</button>';
        }
        footerEl.innerHTML = btns;
      }

      modal.classList.add('open');
    }

    async function resolvePromptServer(id, value) {
      const res = await fetch('/api/prompt/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, value })
      });
      const data = await res.json();
      if (data.validationError) {
        const errEl = document.getElementById('promptErrorEl');
        if (errEl) errEl.textContent = data.validationError;
        return;
      }
      document.getElementById('promptModal').classList.remove('open');
      activePrompt = null;
    }

    function cancelActivePrompt() {
      if (!activePrompt) return;
      resolvePromptServer(activePrompt.id, null);
    }

    function submitSingleQuickPick(index) {
      if (!activePrompt) return;
      resolvePromptServer(activePrompt.id, { selectedIndices: [index] });
    }

    function submitMultiQuickPick() {
      if (!activePrompt) return;
      const checked = Array.from(document.querySelectorAll('.qp-check:checked')).map(el => Number(el.value));
      resolvePromptServer(activePrompt.id, { selectedIndices: checked });
    }

    function submitInputPrompt() {
      if (!activePrompt) return;
      const val = document.getElementById('promptInputEl').value;
      resolvePromptServer(activePrompt.id, { text: val });
    }

    function submitMessagePrompt(choice) {
      if (!activePrompt) return;
      resolvePromptServer(activePrompt.id, { choice });
    }

    // File Preview & Diff Viewer Modal
    function openFilePreviewModal(data) {
      document.getElementById('viewerTitle').textContent = data.title + (data.subtitle ? ' — ' + data.subtitle : '');
      document.getElementById('viewerBody').innerHTML = '<pre class="code-preview">' + escapeHtml(data.content) + '</pre>';
      document.getElementById('viewerModal').classList.add('open');

      const tabKey = 'preview::' + (data.subtitle || data.title);
      const tabTitle = '📄 ' + data.title;
      const tabHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"/><style>' +
        'body { margin: 0; padding: 18px 24px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg, #1e1e1e); color: var(--fg, #cccccc); }' +
        '.head { border-bottom: 1px solid rgba(128,128,128,0.25); padding-bottom: 10px; margin-bottom: 16px; }' +
        '.title { font-size: 14px; font-weight: 600; }' +
        '.sub { font-size: 11px; opacity: 0.65; font-family: monospace; margin-top: 4px; }' +
        'pre { font-family: "SF Mono", Menlo, Monaco, Consolas, monospace; font-size: 12px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }' +
        '</style></head><body>' +
        '<div class="head"><div class="title">' + escapeHtml(data.title) + '</div><div class="sub">' + escapeHtml(data.subtitle) + '</div></div>' +
        '<pre>' + escapeHtml(data.content) + '</pre></body></html>';
      upsertWebviewPanel(tabKey, tabTitle, tabHtml);
    }

    function openDiffModal(data) {
      document.getElementById('viewerTitle').textContent = data.title || 'Diff';
      document.getElementById('viewerBody').innerHTML =
        '<div class="diff-grid">' +
        '  <div class="diff-col"><h4>Original: ' + escapeHtml(data.leftLabel) + '</h4><pre class="code-preview">' + escapeHtml(data.leftText) + '</pre></div>' +
        '  <div class="diff-col"><h4>Local: ' + escapeHtml(data.rightLabel) + '</h4><pre class="code-preview">' + escapeHtml(data.rightText) + '</pre></div>' +
        '</div>';
      document.getElementById('viewerModal').classList.add('open');
    }

    function closeViewerModal() {
      document.getElementById('viewerModal').classList.remove('open');
    }

    async function openCommandPalette() {
      const res = await fetch('/api/commands');
      const data = await res.json();
      const cmds = data.commands || [];
      showPromptModal({
        id: '__local_cmd_palette__',
        kind: 'quickPick',
        options: {
          placeHolder: 'Run AI Swissknife Command...',
          canPickMany: false,
          items: cmds.map((c, idx) => ({ index: idx, label: c.title, description: c.command, _cmd: c.command }))
        }
      });
    }

    const origResolvePromptServer = resolvePromptServer;
    resolvePromptServer = async function(id, value) {
      if (id === '__local_cmd_palette__') {
        document.getElementById('promptModal').classList.remove('open');
        const p = activePrompt;
        activePrompt = null;
        if (value && Array.isArray(value.selectedIndices) && value.selectedIndices.length > 0) {
          const item = p.options.items[value.selectedIndices[0]];
          if (item && item._cmd) {
            await execCommand(item._cmd);
          }
        }
        return;
      }
      return origResolvePromptServer(id, value);
    };

    // Sidebar drag resizer
    (function setupResizer() {
      const resizer = document.getElementById('sidebarResizer');
      const sidebar = document.getElementById('sidebar');
      let dragging = false;
      resizer.addEventListener('mousedown', () => { dragging = true; });
      window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const w = Math.max(220, Math.min(600, e.clientX));
        sidebar.style.width = w + 'px';
      });
      window.addEventListener('mouseup', () => { dragging = false; });
    })();

    let refreshTimer = null;
    function scheduleExplorerRefresh() {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        childrenCache.clear();
        loadExplorerSnapshot();
      }, 250);
    }

    // Connect SSE stream
    const evtSource = new EventSource('/api/events');
    evtSource.onmessage = async (e) => {
      const { event, payload } = JSON.parse(e.data);
      if (event === 'treesChanged') {
        scheduleExplorerRefresh();
      } else if (event === 'webviewHtml') {
        upsertWebviewPanel(payload.viewType, payload.title, payload.html);
      } else if (event === 'webviewMessage') {
        const entry = webviews.get(payload.viewType);
        if (entry && entry.iframe && entry.iframe.contentWindow) {
          entry.iframe.contentWindow.postMessage(payload.message, '*');
        }
      } else if (event === 'webviewReveal') {
        if (webviews.has(payload.viewType)) {
          activateWebviewTab(payload.viewType);
        }
      } else if (event === 'webviewDisposed') {
        const entry = webviews.get(payload.viewType);
        if (entry) {
          entry.iframe.remove();
          webviews.delete(payload.viewType);
          renderWebviewTabs();
        }
      } else if (event === 'prompt') {
        showPromptModal(payload);
      } else if (event === 'toast') {
        showToast(payload.severity, payload.message);
      } else if (event === 'statusBar') {
        updateStatusBarUI(payload);
      } else if (event === 'progress') {
        document.getElementById('progressStatus').textContent = payload.active ? ('⏳ ' + payload.title) : 'Ready';
      } else if (event === 'statusMessage') {
        document.getElementById('tempStatusMsg').textContent = payload.message || '';
      } else if (event === 'filePreviewModal') {
        openFilePreviewModal(payload);
      } else if (event === 'diffModal') {
        openDiffModal(payload);
      }
    };

    // Initial boot: load Explorer and open Dashboard
    (async function init() {
      await loadExplorerSnapshot();
      const wvRes = await fetch('/api/webviews');
      const wvData = await wvRes.json();
      for (const w of wvData.panels || []) {
        upsertWebviewPanel(w.viewType, w.title, w.html);
      }
    })();
  </script>
</body>
</html>`;
}

// Activate the extension and open the Dashboard by default
activate(extensionContext);
vscodeShim.commands.executeCommand('aiSwissknife.openDashboard');

function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const MIME_TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.json': 'application/json',
  '.css': 'text/css',
  '.js': 'application/javascript',
};

const server = http.createServer(async (req, res) => {
  try {
    const urlObj = new URL(req.url || '/', `http://localhost:${config.port}`);

    if (req.method === 'GET' && urlObj.pathname === '/favicon.ico') {
      const iconPath = path.join(extensionRoot, 'resources', 'icon.png');
      if (fs.existsSync(iconPath)) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        fs.createReadStream(iconPath).pipe(res);
      } else {
        res.writeHead(204);
        res.end();
      }
      return;
    }

    if (req.method === 'GET' && urlObj.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getWorkbenchShellHtml());
      return;
    }

    if (req.method === 'GET' && urlObj.pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.flushHeaders?.();
      res.write(': connected\n\n');
      const onEvent = (data: unknown) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        (res as any).flush?.();
      };
      sseBus.on('event', onEvent);
      req.on('close', () => {
        sseBus.off('event', onEvent);
      });
      return;
    }

    if (req.method === 'GET' && urlObj.pathname === '/fs') {
      const targetPath = urlObj.searchParams.get('path') || '';
      const resolved = path.resolve(targetPath);
      const allowedRoot = path.join(extensionRoot, 'resources');
      if (!resolved.startsWith(allowedRoot) || !fs.existsSync(resolved)) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(resolved).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(resolved).pipe(res);
      return;
    }

    if (req.method === 'GET' && urlObj.pathname === '/api/explorer') {
      const snap = await getExplorerViewsSnapshot();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(snap));
      return;
    }

    if (req.method === 'GET' && urlObj.pathname === '/api/explorer/children') {
      const nodeId = urlObj.searchParams.get('nodeId') || '';
      const entry = nodeObjectRegistry.get(nodeId);
      if (!entry) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ children: [] }));
        return;
      }
      const children = await serializeChildren(entry.viewId, entry.element);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ children }));
      return;
    }

    if (req.method === 'POST' && urlObj.pathname === '/api/explorer/click') {
      const body = await readJsonBody(req);
      const entry = nodeObjectRegistry.get(body.nodeId);
      if (entry) {
        const provider = treeProviders.get(entry.viewId);
        const treeItem = provider ? await provider.getTreeItem(entry.element) : null;
        if (treeItem?.command?.command) {
          await vscodeShim.commands.executeCommand(
            treeItem.command.command,
            ...(treeItem.command.arguments ?? [])
          );
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === 'GET' && urlObj.pathname === '/api/webviews') {
      const panels = Array.from(webviewPanels.values()).map((p) => ({
        viewType: p.viewType,
        title: p.title,
        html: prepareWebviewHtmlForIframe(p.html, p.viewType),
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ panels }));
      return;
    }

    if (req.method === 'POST' && urlObj.pathname === '/api/webview/message') {
      const body = await readJsonBody(req);
      console.log('[standalone] webview message received:', body.viewType, body.message?.command, body.message);
      const panel = webviewPanels.get(body.viewType);
      if (panel?.msgHandler) {
        // Don't block HTTP response if handler opens a modal QuickPick/InputBox
        panel.msgHandler(body.message).catch((err) => {
          console.error('[standalone] webview msgHandler error:', err);
        });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === 'POST' && urlObj.pathname === '/api/webview/dispose') {
      const body = await readJsonBody(req);
      const panel = webviewPanels.get(body.viewType);
      if (panel) {
        webviewPanels.delete(body.viewType);
        for (const h of panel.disposeHandlers) h();
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === 'POST' && urlObj.pathname === '/api/command') {
      const body = await readJsonBody(req);
      const arg = body.nodeId ? nodeObjectRegistry.get(body.nodeId)?.element : undefined;
      vscodeShim.commands.executeCommand(body.command, arg).catch((err) => {
        console.error('[standalone] command error:', err);
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === 'GET' && urlObj.pathname === '/api/commands') {
      const commands = (pkgJson.contributes?.commands ?? []).map((c: any) => ({
        command: c.command,
        title: `${c.category ? c.category + ': ' : ''}${c.title}`,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ commands }));
      return;
    }

    if (req.method === 'POST' && urlObj.pathname === '/api/workspace') {
      const body = await readJsonBody(req);
      if (body.workspace && fs.existsSync(body.workspace)) {
        currentWorkspacePath = path.resolve(body.workspace);
        vscodeShim.commands.executeCommand('aiSwissknife.reloadRegistry');
        vscodeShim.commands.executeCommand('aiSwissknife.refreshInstalled');
        if (webviewPanels.has('aiSwissknifeDashboard')) {
          vscodeShim.commands.executeCommand('aiSwissknife.openDashboard');
        }
        broadcast('treesChanged', { reason: 'workspaceChanged' });
        broadcast('toast', { severity: 'info', message: `Switched workspace to ${currentWorkspacePath}` });
      } else {
        broadcast('toast', { severity: 'error', message: `Workspace path does not exist: ${body.workspace}` });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ workspace: currentWorkspacePath }));
      return;
    }

    if (req.method === 'POST' && urlObj.pathname === '/api/prompt/resolve') {
      const body = await readJsonBody(req);
      const pending = pendingPrompts.get(body.id);
      if (!pending) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (body.value === null || body.value === undefined) {
        pendingPrompts.delete(body.id);
        pending.resolve(undefined);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (pending.kind === 'inputBox' && typeof pending.options.validateInput === 'function') {
        const err = await pending.options.validateInput(body.value.text ?? '');
        if (err) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ validationError: err }));
          return;
        }
      }

      pendingPrompts.delete(body.id);
      if (pending.kind === 'quickPick') {
        const indices: number[] = body.value.selectedIndices ?? [];
        const raw = pending.rawItems ?? [];
        if (pending.options.canPickMany) {
          pending.resolve(indices.map((i) => raw[i]).filter((x) => x !== undefined));
        } else {
          pending.resolve(indices.length > 0 ? raw[indices[0]] : undefined);
        }
      } else if (pending.kind === 'inputBox' || pending.kind === 'openDialog' || pending.kind === 'saveDialog') {
        pending.resolve(body.value.text);
      } else if (pending.kind === 'message') {
        pending.resolve(body.value.choice);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  } catch (err) {
    console.error('[standalone server error]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
  }
});

server.listen(config.port, '127.0.0.1', () => {
  console.log(`AI Swissknife Standalone Workbench listening on http://localhost:${config.port}`);
  console.log(`  Workspace : ${currentWorkspacePath}`);
  console.log(`  Home      : ${config.home}`);
});
