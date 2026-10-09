import * as vscode from 'vscode';
import type { ManagedInstallation, ObservedArtifact, ObservedSourceMatch, Source, AssistantId, Scope } from '../domain/types';
import { readManifest, fromDesiredSource } from '../domain/registry';
import { scanInstalledInventory, promoteObservedArtifact } from '../engine/discovery';
import { analyzeLocalDrift, checkForUpstreamUpdate } from '../engine/drift';
import type { DriftReport } from '../engine/types';
import { FormEditorPanel } from './formEditor';
import { getAssistantIconPath } from './assistantIcons';
import { InstalledTreeDataProvider, getIdentityKey } from './installedView';
import { SourcesTreeDataProvider, SourceItem } from './sourcesView';
import { AvailableTreeDataProvider, AvailableTreeItem, AvailableFolderItem, AvailableArtifactItem, DiagnosticTreeItem } from './availableView';
import { findRelatedInstallations } from '../engine/crossFrameworkLookup';
import { ALL_ADAPTERS } from '../adapters/registry';
import { resolveArtifactPreviewPath } from './artifactFileTree';
import { handleInstallRecommended, installResolvedArtifacts, unrecommendArtifactForWorkspace } from './recommendations';
import { getScopeLabel, getScopeIconSvg } from './scopeIcons';
import { buildInstalledTree, type InstalledObject, type Place, type PlaceState, STATE_SEVERITY } from '../engine/installedTree';

export { getScopeLabel, getScopeIconSvg, buildInstalledTree };

export function computeItemOrigin(
  membership: 'managed' | 'unmanaged',
  item: ManagedInstallation | ObservedArtifact,
  candidates?: ObservedSourceMatch[]
): string {
  if (membership === 'managed') {
    const inst = item as ManagedInstallation;
    if (!inst.sourceId) {
      return 'Local only: not found in any registered source';
    }
    const commit = inst.sourceRevision?.commit;
    const shortCommit = commit ? (commit.length > 7 ? commit.slice(0, 7) : commit) : '';
    return `${inst.sourceId}${shortCommit ? '@' + shortCommit : ''}`;
  }

  const obs = item as ObservedArtifact;
  const cands = (candidates && candidates.length > 0)
    ? candidates
    : (obs.candidates && obs.candidates.length > 0)
      ? obs.candidates
      : (obs.match && obs.match.status !== 'unmatched' && obs.match.sourceId)
        ? [obs.match]
        : [];

  if (cands.length === 0) {
    return 'Local only: not found in any registered source';
  }

  return cands.map(c => {
    const src = c.sourceId || 'unknown';
    if (c.status === 'identical') {
      return `Matches registered source "${src}" — identical`;
    } else if (c.status === 'different') {
      return `Matches registered source "${src}" — differs (your copy was changed or is a different version)`;
    } else {
      return `Matches registered source "${src}"`;
    }
  }).join('\n');
}

export class DashboardPanel {
  private async getAllSources(): Promise<Source[]> {
    const allSources: Source[] = [];
    try {
      const gManifest = await readManifest('global');
      allSources.push(...gManifest.sources.map((d) => fromDesiredSource(d)));
    } catch { /* ignore */ }
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      const projectRoot = folders[0].uri.fsPath;
      try {
        const pManifest = await readManifest('project', projectRoot);
        allSources.push(...pManifest.sources.map((d) => fromDesiredSource(d, projectRoot)));
      } catch { /* ignore */ }
    }
    return allSources;
  }

  /**
   * Re-resolves a ManagedInstallation from a fresh inventory scan by its
   * composite identity key -- never trust the client's own copy of the
   * installation (security: doUninstallItem/doUpdateInstallation act on
   * inst.path). Returns undefined (and shows an error, since silently
   * doing nothing on a real button click is indistinguishable from a
   * frozen UI) when the key doesn't match anything currently on disk.
   */
  private async resolveManagedInstallationByKey(key: string): Promise<ManagedInstallation | undefined> {
    const allManaged: ManagedInstallation[] = [];
    try {
      const gInv = await scanInstalledInventory('global');
      allManaged.push(...gInv.managed);
    } catch { /* ignore */ }
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      try {
        const pInv = await scanInstalledInventory('project', folders[0].uri.fsPath);
        allManaged.push(...pInv.managed);
      } catch { /* ignore */ }
    }
    const inst = allManaged.find(m => getIdentityKey(m) === key);
    if (!inst) {
      vscode.window.showErrorMessage(
        `Couldn't find that installation anymore (key: ${key}). It may have been moved, uninstalled, or belong to a workspace folder other than the first one open. Try refreshing the Dashboard.`
      );
    }
    return inst;
  }

  private async resolveInstallationOrObservedByKey(key: string): Promise<ManagedInstallation | ObservedArtifact | undefined> {
    const allManaged: ManagedInstallation[] = [];
    const allObserved: ObservedArtifact[] = [];
    try {
      const gInv = await scanInstalledInventory('global');
      allManaged.push(...gInv.managed);
      allObserved.push(...gInv.observed);
    } catch { /* ignore */ }
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      try {
        const pInv = await scanInstalledInventory('project', folders[0].uri.fsPath);
        allManaged.push(...pInv.managed);
        allObserved.push(...pInv.observed);
      } catch { /* ignore */ }
    }
    const inst = allManaged.find(m => getIdentityKey(m) === key);
    if (inst) {
      return inst;
    }
    const obs = allObserved.find(o => getIdentityKey(o) === key);
    if (obs) {
      return obs;
    }
    vscode.window.showErrorMessage(
      `Couldn't find that item anymore (key: ${key}). It may have been moved, uninstalled, or belong to a workspace folder other than the first one open. Try refreshing the Dashboard.`
    );
    return undefined;
  }

  public static currentPanel: DashboardPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _provider: InstalledTreeDataProvider;
  private readonly _sourcesProvider: SourcesTreeDataProvider;
  private readonly _availableProvider: AvailableTreeDataProvider;
  private readonly _refreshCallback: () => void;
  private _disposables: vscode.Disposable[] = [];
  private _htmlInitialized: boolean = false;

  private _sourceFilter?: { id: string; scope: Scope };

  private escapeHtml(unsafe: string): string {
    return (unsafe || '')
      .toString()
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /**
   * Safely embeds an arbitrary string (e.g. an identity key derived from a
   * user-chosen artifact name) as a JS string literal inside an inline
   * HTML event handler attribute, e.g. onclick="fn(${this.jsStringLiteral(x)})".
   * escapeHtml() alone is NOT enough here: the browser HTML-decodes
   * attribute values (so escapeHtml's `'` -> `&#039;` decodes right back to
   * `'`) before handing the decoded text to the JS parser as the handler's
   * source, so a value containing a real apostrophe (a plausible skill/
   * artifact name, e.g. "team's-toolkit") silently breaks the enclosing
   * '...' JS string and the whole handler fails to parse -- the button
   * looks clickable but does nothing, with no visible error unless
   * DevTools happens to be open. JSON.stringify already produces a valid,
   * self-quoted JS string literal for any input (handles backslashes,
   * quotes, newlines, etc.); escaping *that* for the HTML attribute
   * context (its own `"` becomes `&quot;`) makes the whole thing safe in
   * both layers.
   */
  private jsStringLiteral(value: string): string {
    return this.escapeHtml(JSON.stringify(value ?? ''));
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    provider: InstalledTreeDataProvider,
    sourcesProvider: SourcesTreeDataProvider,
    availableProvider: AvailableTreeDataProvider,
    refreshCallback: () => void
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._provider = provider;
    this._sourcesProvider = sourcesProvider;
    this._availableProvider = availableProvider;
    this._refreshCallback = refreshCallback;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'addSource':
            await this._sourcesProvider.addSource(message.scope);
            this._refreshCallback();
            await this.update();
            break;
          case 'removeSource': {
            const sources = await this.getAllSources();
            const source = sources.find(s => s.id === message.sourceId && s.scope === message.scope);
            if (source) {
              await this._sourcesProvider.removeSource(new SourceItem(source, source.name ?? source.id));
              this._refreshCallback();
              await this.update();
            }
            break;
          }
          case 'exportConfig':
            await this._sourcesProvider.exportConfig();
            break;
          case 'exportSource': {
            const sources = await this.getAllSources();
            const source = sources.find(s => s.id === message.sourceId && s.scope === message.scope);
            if (source) {
              await this._sourcesProvider.exportSource(new SourceItem(source, source.name ?? source.id));
            }
            break;
          }
          case 'importConfig':
            await this._sourcesProvider.importConfig();
            this._refreshCallback();
            await this.update();
            break;
          case 'refreshCatalog':
            await this._availableProvider.refreshCatalog();
            this._refreshCallback();
            await this.update();
            break;
          case 'refreshSource':
            await this._availableProvider.refreshSource(message.sourceId, message.scope);
            this._refreshCallback();
            await this.update();
            break;
          case 'requestCatalog': {
            await this._availableProvider.ensureCatalogLoaded();
            const groups = this._availableProvider.getCachedSourceGroups();
            const group = groups.find(g => g.source.id === message.sourceId && g.source.scope === message.scope);
            if (group) {
              const children = await this._availableProvider.getChildren(group);
              const html = this.renderCatalogLevel(children);
              this._panel.webview.postMessage({
                command: 'catalogData',
                sourceId: message.sourceId,
                scope: message.scope,
                html
              });
            }
            break;
          }
          case 'previewArtifact': {
            const item = this._availableProvider.resolveArtifactById(message.sourceId, message.scope, message.artifactId);
            if (item) {
              await this._availableProvider.previewArtifact(item);
            }
            break;
          }
          case 'installArtifact':
            await this._availableProvider.doInstallArtifact(message.sourceId, message.scope, message.artifactId);
            this._refreshCallback();
            await this.update();
            break;
          case 'installFolder':
            await this._availableProvider.doInstallFolder(message.sourceId, message.scope, message.folderPath);
            this._refreshCallback();
            await this.update();
            break;
          case 'installSourceGroup':
            await this._availableProvider.doInstallSourceGroup(message.sourceId, message.scope);
            this._refreshCallback();
            await this.update();
            break;
          case 'refresh':
            await this.update();
            break;
          case 'checkDrift':
            await this.update();
            break;
          case 'promote':
            if (message.observed) {
              await this._provider.doPromoteItem(message.observed as ObservedArtifact);
              this._refreshCallback();
              await this.update();
            }
            break;
          case 'promoteAllIdentical':
            if (Array.isArray(message.items)) {
              let count = 0;
              let skipped = 0;
              for (const item of message.items) {
                const obs = item as ObservedArtifact;
                const candidates = obs.candidates ?? [];
                if (candidates.length === 1 && candidates[0].status === 'identical') {
                  await promoteObservedArtifact(obs, candidates[0]);
                  count++;
                } else if (obs.match?.status === 'identical' && candidates.length > 1) {
                  skipped++;
                }
              }
              if (skipped > 0) {
                vscode.window.showInformationMessage(`Promoted ${count} identical item(s). Skipped ${skipped} item(s) with multiple candidates.`);
              } else {
                vscode.window.showInformationMessage(`Promoted ${count} identical item(s) to managed installations.`);
              }
              this._refreshCallback();
              await this.update();
            }
            break;
          case 'edit':
            if (message.installation) {
              const inst = message.installation as ManagedInstallation;
              await FormEditorPanel.open(
                {
                  mode: 'edit',
                  assistant: inst.assistant,
                  scope: inst.scope,
                  projectRoot: inst.projectPath,
                  kind: inst.kind,
                  name: inst.name,
                  sourceInstallation: inst,
                },
                () => {
                  this._refreshCallback();
                  this.update();
                  this._provider.refresh();
                }
              );
            }
            break;
          case 'copyItem':
            if (message.item) {
              await this._provider.doSyncItem(message.item);
              this._refreshCallback();
              await this.update();
            }
            break;
          case 'moveItem':
            if (message.item) {
              await this._provider.doMoveItem(message.item as ManagedInstallation);
              this._refreshCallback();
              await this.update();
            }
            break;
          case 'diffItem':
            if (message.item) {
              await this._provider.doDiffAgainstOriginal(message.item);
            }
            break;

          case 'createArtifact':
            vscode.commands.executeCommand('aiSwissknife.createArtifact');
            break;
          case 'requestDetail':
            if (message.key) {
              await this.handleRequestDetail(message.key);
            }
            break;
          case 'uninstallItem': {
            if (message.key) {
              const inst = await this.resolveManagedInstallationByKey(message.key);
              if (inst) {
                await this._provider.doUninstallItem(inst);
                this._refreshCallback();
                await this.update();
                this._panel.webview.postMessage({ command: 'clearDetail' });
              }
            }
            break;
          }
          case 'previewInstalledArtifact': {
            if (message.key) {
              const item = await this.resolveInstallationOrObservedByKey(message.key);
              if (item) {
                const p = resolveArtifactPreviewPath(item.path, item.kind);
                if (p) {
                  vscode.commands.executeCommand('vscode.open', vscode.Uri.file(p));
                } else {
                  vscode.window.showWarningMessage(`No local file to preview for "${item.name}".`);
                }
              }
            }
            break;
          }
          case 'diffInstalledArtifact': {
            if (message.key) {
              const item = await this.resolveInstallationOrObservedByKey(message.key);
              if (item) {
                await this._provider.doDiffAgainstOriginal(item);
              }
            }
            break;
          }
          case 'updateItem': {
            if (message.key) {
              const inst = await this.resolveManagedInstallationByKey(message.key);
              if (inst) {
                await this._provider.doUpdateInstallation(inst);
                this._refreshCallback();
                await this.update();
              }
            }
            break;
          }
          case 'updateAll': {
            await this._provider.doUpdateAll(message.filter);
            this._refreshCallback();
            await this.update();
            break;
          }
          case 'installRecommended':
            await handleInstallRecommended(() => {
              this._availableProvider.refreshCatalog();
              this._refreshCallback();
              this.update();
            });
            break;
          case 'installRecommendation': {
            const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (projectRoot) {
              const recGroup = this._availableProvider.getCachedRecommendedGroup();
              if (recGroup) {
                const pendingItem = recGroup.pending.find(p => p.source.id === message.sourceId && p.artifact.id === message.artifactId && p.desired.assistant === message.assistant);
                if (pendingItem) {
                  const toInstall = {
                    artifact: pendingItem.artifact,
                    pkg: pendingItem.pkg,
                    source: pendingItem.source,
                    targetAssistant: pendingItem.desired.assistant,
                    targetScope: pendingItem.desired.scope
                  };
                  await installResolvedArtifacts([toInstall], projectRoot);
                  this._availableProvider.refreshCatalog();
                  this._refreshCallback();
                  await this.update();
                }
              }
            }
            break;
          }
          case 'unrecommendRecommendation': {
            const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (projectRoot) {
              await unrecommendArtifactForWorkspace(message.sourceId, message.artifactId, message.assistant, projectRoot);
              this._availableProvider.refreshCatalog();
              this._refreshCallback();
              await this.update();
            }
            break;
          }
        }
      },
      null,
      this._disposables
    );

    this.update();
  }

  public static render(
    extensionUri: vscode.Uri,
    provider: InstalledTreeDataProvider,
    sourcesProvider: SourcesTreeDataProvider,
    availableProvider: AvailableTreeDataProvider,
    refreshCallback: () => void
  ): DashboardPanel {
    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
      DashboardPanel.currentPanel.update();
      return DashboardPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'aiSwissknifeDashboard',
      'AI Swissknife Dashboard',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'resources')]
      }
    );

    // Show something immediately instead of the webview's default black
    // background while update()'s first data fetch is still in flight.
    panel.webview.html = DashboardPanel.getLoadingHtml();

    DashboardPanel.currentPanel = new DashboardPanel(panel, extensionUri, provider, sourcesProvider, availableProvider, refreshCallback);
    return DashboardPanel.currentPanel;
  }

  private static getLoadingHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>AI Swissknife Dashboard</title>
  <style>
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      padding: 16px 20px;
      margin: 0;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--vscode-panel-border, #333);
    }
    .header h1 { margin: 0 0 2px 0; font-size: 18px; font-weight: 600; }
    .header p { margin: 0; opacity: 0.7; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 12px; }
    th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--vscode-panel-border, #333); }
    th { opacity: 0.8; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .loading-row { text-align: center; opacity: 0.7; padding: 24px; }
    .spinner { display: inline-block; vertical-align: middle; margin-right: 8px; border: 2px solid rgba(136, 136, 136, 0.2); border-top-color: #888; border-radius: 50%; width: 12px; height: 12px; animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>AI Swissknife Dashboard</h1>
      <p>Loading…</p>
    </div>
  </div>
  <table>
    <thead>
      <tr><th>Kind</th><th>Name</th><th>Assistant</th><th>Scope</th><th>Status</th><th>Action</th></tr>
    </thead>
    <tbody>
      <tr><td colspan="6" class="loading-row"><span class="spinner"></span>Loading dashboard data…</td></tr>
    </tbody>
  </table>
</body>
</html>`;
  }

  public setSourceFilter(id: string, scope: Scope) {
    this._sourceFilter = { id, scope };
    this.update();
  }

  private async handleRequestDetail(key: string) {
    const allManaged: ManagedInstallation[] = [];
    const allObserved: ObservedArtifact[] = [];
    
    try {
      const gInv = await scanInstalledInventory('global');
      allManaged.push(...gInv.managed);
      allObserved.push(...gInv.observed);
    } catch {
      // ignore
    }

    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      const projectRoot = folders[0].uri.fsPath;
      try {
        const pInv = await scanInstalledInventory('project', projectRoot);
        allManaged.push(...pInv.managed);
        allObserved.push(...pInv.observed);
      } catch {
        // ignore
      }
    }

    const allInstallations: ManagedInstallation[] = [
      ...allManaged,
      ...allObserved.map(o => ({
        assistant: o.assistant,
        scope: o.scope,
        projectPath: o.projectPath,
        kind: o.kind,
        name: o.name,
        path: o.path,
        sourceId: o.match?.sourceId,
        packageId: o.match?.packageId,
        artifactId: o.match?.artifactId,
        sourceRevision: o.match?.sourceRevision,
        installedAt: o.discoveredAt,
        contentHash: o.contentHash,
      })),
    ];

    const inst = allManaged.find(m => getIdentityKey(m) === key);
    if (inst) {
      let diffAvailable = false;
      const allSources: Source[] = [];
      try {
        const gManifest = await readManifest('global');
        allSources.push(...gManifest.sources.map((d) => fromDesiredSource(d)));
        if (folders && folders.length > 0) {
          const pManifest = await readManifest('project', folders[0].uri.fsPath);
          allSources.push(...pManifest.sources.map((d) => fromDesiredSource(d, folders[0].uri.fsPath)));
        }
      } catch {
        // ignore
      }

      const matchingSource = allSources.find((s) => s.id === inst.sourceId);
      let report: DriftReport;
      if (matchingSource) {
        report = await checkForUpstreamUpdate(inst, matchingSource);
      } else {
        report = await analyzeLocalDrift(inst);
      }
      
      if (report.status === 'modified-locally' || report.status === 'modified-and-update-available') {
        diffAvailable = true;
      }

      const crossFramework = findRelatedInstallations(inst, allInstallations).map(r => ({
        assistant: r.installation.assistant,
        scope: r.installation.scope,
        strategy: r.strategy
      }));

      const origin = computeItemOrigin('managed', inst);
      let assistantIconUri: string | undefined;
      try {
        assistantIconUri = this._panel.webview.asWebviewUri(getAssistantIconPath(inst.assistant, this._extensionUri).light).toString();
      } catch {
        // ignore
      }

      this._panel.webview.postMessage({
        command: 'itemDetail',
        key,
        origin,
        diffAvailable,
        crossFramework,
        candidates: [],
        item: inst,
        membership: 'managed',
        status: report ? report.status : 'up-to-date',
        assistantIconUri
      });
      return;
    }

    const obs = allObserved.find(o => getIdentityKey(o) === key);
    if (obs) {
      const targetAsInst: ManagedInstallation = {
        assistant: obs.assistant,
        scope: obs.scope,
        projectPath: obs.projectPath,
        kind: obs.kind,
        name: obs.name,
        path: obs.path,
        sourceId: obs.match?.sourceId,
        packageId: obs.match?.packageId,
        artifactId: obs.match?.artifactId,
        sourceRevision: obs.match?.sourceRevision,
        installedAt: obs.discoveredAt,
        contentHash: obs.contentHash,
      };

      const crossFramework = findRelatedInstallations(targetAsInst, allInstallations).map(r => ({
        assistant: r.installation.assistant,
        scope: r.installation.scope,
        strategy: r.strategy
      }));

      const origin = computeItemOrigin('unmanaged', obs, obs.candidates);
      const diffAvailable = Boolean(obs.match?.status === 'different' || (obs.candidates && obs.candidates.some(c => c.status === 'different')));
      let assistantIconUri: string | undefined;
      try {
        assistantIconUri = this._panel.webview.asWebviewUri(getAssistantIconPath(obs.assistant, this._extensionUri).light).toString();
      } catch {
        // ignore
      }

      this._panel.webview.postMessage({
        command: 'itemDetail',
        key,
        origin,
        diffAvailable,
        crossFramework,
        candidates: obs.candidates ?? [],
        item: obs,
        membership: 'unmanaged',
        status: obs.match?.status ?? 'unmatched',
        assistantIconUri
      });
      return;
    }
  }

  public dispose() {
    DashboardPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) x.dispose();
    }
  }

  public async update(): Promise<void> {
    const allSources: Source[] = [];
    const allManaged: ManagedInstallation[] = [];
    const allObserved: ObservedArtifact[] = [];
    const driftReports: DriftReport[] = [];

    // Global
    try {
      const gManifest = await readManifest('global');
      allSources.push(...gManifest.sources.map((d) => fromDesiredSource(d)));
      const gInv = await scanInstalledInventory('global');
      allManaged.push(...gInv.managed);
      allObserved.push(...gInv.observed);
    } catch {
      // ignore
    }

    // Project
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      const projectRoot = folders[0].uri.fsPath;
      try {
        const pManifest = await readManifest('project', projectRoot);
        allSources.push(...pManifest.sources.map((d) => fromDesiredSource(d, projectRoot)));
        const pInv = await scanInstalledInventory('project', projectRoot);
        allManaged.push(...pInv.managed);
        allObserved.push(...pInv.observed);
      } catch {
        // ignore
      }
    }

    // Phase A: Fast render
    if (!this._htmlInitialized) {
      this._panel.webview.html = this.getHtml(allSources, allManaged, allObserved, [], true, this._sourceFilter);
      this._htmlInitialized = true;
    } else {

      const totalInstalled = allManaged.length;
      const totalUnmanaged = allObserved.length;
      const identicalCount = allObserved.filter((o) => o.match?.status === 'identical').length;

      const presentAssistants = Array.from(new Set([...allManaged.map(m => m.assistant), ...allObserved.map(o => o.assistant)])).sort();
      const environmentPills = presentAssistants.map(a => {
        const iconUris = getAssistantIconPath(a, this._extensionUri);
        const iconSrc = this._panel.webview.asWebviewUri(iconUris.light);
        return `<button class="filter-pill env-pill" data-env="${this.escapeHtml(a)}" aria-pressed="false" onclick="setEnvFilter(${this.jsStringLiteral(a)})">
          <img src="${iconSrc}" class="assistant-icon" width="14" height="14" />
          ${this.escapeHtml(a)}
        </button>`;
      }).join('\n');

      const tree = buildInstalledTree(allManaged, allObserved);
      const rowsHtml = this.renderInstalledTree(tree);

      this._panel.webview.postMessage({
        command: 'inventoryData',
        managedData: allManaged,
        observedData: allObserved,
        rowsHtml,
        totalInstalled,
        totalUnmanaged,
        identicalCount,
        environmentPills,
        scanning: true,
        sourcesHtml: this.getSourcesCatalogHtml(allSources),
        totalSources: allSources.length,
        overviewNeedsAttentionHtml: this.getNeedsAttentionHtml(allManaged, [], true)
      });
    }

    // Phase C: Recommendations
    (async () => {
      try {
        await this._availableProvider.ensureCatalogLoaded();
        const recGroup = this._availableProvider.getCachedRecommendedGroup();
        const pending = recGroup ? recGroup.pending : [];
        const broken = recGroup ? recGroup.broken : [];
        this._panel.webview.postMessage({
          command: 'recommendationsData',
          html: this.getRecommendationsHtml(pending, broken),
          pendingCount: pending.length
        });
      } catch {
        // ignore
      }
    })();

    // Phase B: Slow drift check
    for (const inst of allManaged) {
      const matchingSource = allSources.find((s) => s.id === inst.sourceId);
      let report: DriftReport;
      if (matchingSource) {
        report = await checkForUpstreamUpdate(inst, matchingSource);
      } else {
        report = await analyzeLocalDrift(inst);
      }
      driftReports.push(report);
      this._panel.webview.postMessage({
        command: 'driftResult',
        key: getIdentityKey(inst),
        status: report.status
      });
    }

    const updatesAvailable = driftReports.filter(
      (r) => r.status === 'update-available' || r.status === 'modified-and-update-available'
    ).length;
    const modifiedLocally = driftReports.filter(
      (r) => r.status === 'modified-locally' || r.status === 'modified-and-update-available'
    ).length;
    
    this._panel.webview.postMessage({
      command: 'scanComplete',
      updatesAvailable,
      modifiedLocally,
      overviewNeedsAttentionHtml: this.getNeedsAttentionHtml(allManaged, driftReports, false)
    });
  }


  private getNeedsAttentionHtml(managed: ManagedInstallation[], reports: DriftReport[], scanning: boolean): string {
    const reportMap = new Map(reports.map((r) => [getIdentityKey(r.installation), r]));
    const needsAttention = managed
      .map(inst => {
        const key = getIdentityKey(inst);
        const report = reportMap.get(key);
        return { inst, key, status: report?.status ?? (scanning ? 'checking…' : 'up-to-date') };
      })
      .filter(x => x.status === 'update-available' || x.status === 'modified-and-update-available' || x.status === 'modified-locally')
      .slice(0, 5);

    if (needsAttention.length === 0) {
      return `<div class="empty-state" style="padding: 20px;">No items need attention.</div>`;
    }

    let html = `
      <table>
        <thead>
          <tr>
            <th>Kind</th>
            <th>Name</th>
            <th>Assistant</th>
            <th>Scope</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const x of needsAttention) {
      let badgeClass = 'badge-pending';
      let badgeText = x.status;
      if (x.status === 'update-available') { badgeClass = 'badge-info'; badgeText = 'Update available'; }
      else if (x.status === 'modified-locally' || x.status === 'modified-and-update-available') { badgeClass = 'badge-warning'; badgeText = 'Modified locally'; }
      
      html += `
        <tr class="overview-item-row" style="cursor: pointer;" onclick="jumpToInstalledRow(${this.jsStringLiteral(x.key)})" onmouseover="this.style.backgroundColor='rgba(255, 255, 255, 0.05)'" onmouseout="this.style.backgroundColor=''">
          <td><span class="kind-pill kind-${this.escapeHtml(x.inst.kind)}">${this.escapeHtml(x.inst.kind)}</span></td>
          <td><strong>${this.escapeHtml(x.inst.name)}</strong></td>
          <td>${this.escapeHtml(x.inst.assistant)}</td>
          <td><span class="scope-pill scope-${this.escapeHtml(x.inst.scope)}">${this.escapeHtml(getScopeLabel(x.inst.scope))}</span></td>
          <td><span class="badge ${badgeClass}">${this.escapeHtml(badgeText)}</span></td>
        </tr>
      `;
    }

    html += `
        </tbody>
      </table>
    `;
    
    return html;
  }

  private getOverviewHtml(
    sources: Source[],
    managed: ManagedInstallation[],
    reports: DriftReport[],
    scanning: boolean,
    totalInstalled: number,
    totalUnmanaged: number,
    updatesAvailable: number,
    modifiedLocally: number,
    pendingRecommendationsCount: number
  ): string {
    return `
      <div class="stats-ribbon">
        <div class="stat-chip">
          <span class="stat-num" id="overview-stat-managed">${totalInstalled}</span>
          <span class="stat-label">Managed Installations</span>
        </div>
        <div class="stat-chip stat-info" style="cursor: pointer;" onclick="triggerUpdateAll()">
          <span class="stat-num" id="overview-stat-updates">${updatesAvailable}</span>
          <span class="stat-label">Updates Available</span>
        </div>
        <div class="stat-chip stat-warning">
          <span class="stat-num" id="overview-stat-modified">${modifiedLocally}</span>
          <span class="stat-label">Modified Locally</span>
        </div>
        <div class="stat-chip stat-unmanaged">
          <span class="stat-num" id="overview-stat-unmanaged">${totalUnmanaged}</span>
          <span class="stat-label">Unmanaged Discovered</span>
        </div>
        <div class="stat-chip">
          <span class="stat-num" id="overview-stat-pending">${pendingRecommendationsCount}</span>
          <span class="stat-label">Pending Recommendations</span>
        </div>
        <div class="stat-chip">
          <span class="stat-num" id="overview-stat-sources">${sources.length}</span>
          <span class="stat-label">Sources</span>
        </div>
      </div>

      <div class="toolbar" style="margin-top: 24px; margin-bottom: 16px;">
        <button class="btn btn-primary" onclick="switchSection('installed')">View Installed</button>
        <button class="btn btn-secondary" onclick="switchSection('catalog')">View Sources &amp; Catalog</button>
        <button class="btn btn-secondary" onclick="switchSection('recommendations')">View Recommendations</button>
      </div>

      <div class="scope-group" style="margin-top: 24px;">
        <div class="scope-header" style="border-bottom: 1px solid var(--border); padding-bottom: 8px; margin-bottom: 8px;">
          <h3 style="margin: 0; font-size: 13px;">Needs Attention</h3>
        </div>
        <div id="overview-needs-attention">
          ${this.getNeedsAttentionHtml(managed, reports, scanning)}
        </div>
      </div>
    `;
  }

  private renderCatalogLevel(items: AvailableTreeItem[], level: number = 0): string {
    let html = '';
    for (const item of items) {
      if (item instanceof DiagnosticTreeItem) {
        const diag = item.diagnostic;
        const icon = diag.severity === 'error' ? '🔴' : '⚠️';
        html += `
          <div class="catalog-item diagnostic-row" style="padding: 4px 8px; font-size: 11px; color: ${diag.severity === 'error' ? 'var(--badge-error)' : 'var(--badge-warning)'}; display: flex; align-items: center; gap: 6px;">
            <span>${icon}</span>
            <span><strong>[${this.escapeHtml(diag.code)}]</strong> ${this.escapeHtml(diag.message)}</span>
            <span style="opacity:0.7; font-size:10px;">${this.escapeHtml(diag.path)}</span>
          </div>
        `;
      } else if (item instanceof AvailableFolderItem) {
        const folderId = `folder-${Math.random().toString(36).substr(2, 9)}`;
        html += `
          <div class="catalog-folder">
            <div class="catalog-item folder-row" style="padding: 4px 8px; cursor: pointer; display: grid; grid-template-columns: 100px 180px 1fr auto 180px; align-items: center; gap: 10px;" onclick="toggleFolder('${folderId}', this)">
              <div style="display: flex; align-items: center; gap: 6px;">
                <span class="folder-icon" style="transition: transform 0.2s; font-size: 10px; opacity: 0.8;">▶</span>
                <span class="folder-icon-img" style="font-size: 12px;">📁</span>
              </div>
              <div style="overflow: hidden; white-space: nowrap; text-overflow: ellipsis;">
                <strong>${this.escapeHtml(item.label)}</strong>
              </div>
              <div></div>
              <div></div>
              <div style="display: flex; gap: 4px; justify-content: flex-end;" onclick="event.stopPropagation()">
                <button class="btn btn-sm btn-primary" title="Install" onclick="vscode.postMessage({ command: 'installFolder', sourceId: ${this.jsStringLiteral(item.source.id)}, scope: ${this.jsStringLiteral(item.source.scope)}, folderPath: ${this.jsStringLiteral(item.folderPath)} })">⬇</button>
              </div>
            </div>
            <div id="${folderId}" style="display: none; padding-left: 16px; border-left: 1px solid var(--border); margin-left: 5px;">
              ${this.renderCatalogLevel(item.items, level + 1)}
            </div>
          </div>
        `;
      } else if (item instanceof AvailableArtifactItem) {
        const installedIn = this._availableProvider.getInstalledAssistants(item.source.id, item.artifact.id);
        const badgesHtml = installedIn.map(a => {
          const iconUris = getAssistantIconPath(a as AssistantId, this._extensionUri);
          const iconSrc = this._panel.webview.asWebviewUri(iconUris.light);
          return `<span class="filter-pill env-pill active" style="padding: 2px 6px; font-size: 10px; cursor: default; height: auto;" title="Installed in ${this.escapeHtml(a)}">
            <img src="${iconSrc}" class="assistant-icon" width="12" height="12" style="vertical-align: middle; margin-right: 4px;" />${this.escapeHtml(a)}
          </span>`;
        }).join('');

        html += `
          <div class="catalog-item artifact-row" style="padding: 4px 8px; display: grid; grid-template-columns: 100px 180px 1fr auto 180px; align-items: center; gap: 10px;">
            <div>
              <span class="kind-pill kind-${this.escapeHtml(item.artifact.kind)}">${this.escapeHtml(item.artifact.kind)}</span>
            </div>
            <div style="overflow: hidden; white-space: nowrap; text-overflow: ellipsis; display: flex; align-items: center; gap: 4px;">
              <strong style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${this.escapeHtml(item.artifact.name)}</strong>
              ${item.isRecommended ? '<span style="color: var(--badge-warning); flex-shrink: 0;" title="Recommended">★</span>' : ''}
            </div>
            <div style="opacity:0.7; font-size:11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${this.escapeHtml(item.artifact.description || '')}">
              ${item.artifact.description ? this.escapeHtml(item.artifact.description) : ''}
            </div>
            <div style="display: flex; gap: 4px; flex-wrap: nowrap;">
              ${badgesHtml}
            </div>
            <div style="display: flex; gap: 4px; justify-content: flex-end;">
              <button class="btn btn-sm btn-secondary" title="Preview" onclick="vscode.postMessage({ command: 'previewArtifact', sourceId: ${this.jsStringLiteral(item.source.id)}, scope: ${this.jsStringLiteral(item.source.scope)}, artifactId: ${this.jsStringLiteral(item.artifact.id)} })">👁</button>
              <button class="btn btn-sm btn-primary" title="Install" onclick="vscode.postMessage({ command: 'installArtifact', sourceId: ${this.jsStringLiteral(item.source.id)}, scope: ${this.jsStringLiteral(item.source.scope)}, artifactId: ${this.jsStringLiteral(item.artifact.id)} })">⬇</button>
            </div>
          </div>
        `;
      }
    }
    return html || '<div style="padding: 8px; opacity: 0.6; font-size: 11px;">No items</div>';
  }

  private getSourcesCatalogHtml(sources: Source[]): string {
    const globalSources = sources.filter(s => s.scope === 'global');
    const projectSources = sources.filter(s => s.scope === 'project');

    let html = `
      <div class="toolbar" style="margin-bottom: 16px;">
        <button class="btn btn-primary" title="Add Source" onclick="vscode.postMessage({ command: 'addSource' })">＋</button>
        <button class="btn btn-secondary" title="Import" onclick="vscode.postMessage({ command: 'importConfig' })">⬇</button>
        <button class="btn btn-secondary" title="Export All" onclick="vscode.postMessage({ command: 'exportConfig' })">⇧</button>
        <button class="btn btn-secondary" title="Refresh Catalog" onclick="vscode.postMessage({ command: 'refreshCatalog' })">↻</button>
      </div>
    `;

    const renderSourceRow = (s: Source) => `
      <div class="source-container">
        <div class="item-row source-row" style="display: grid; grid-template-columns: 100px 180px 1fr auto 180px; align-items: center; gap: 10px; padding: 8px 10px; border-bottom: 1px solid var(--border); cursor: pointer;" onclick="toggleSource(this, ${this.jsStringLiteral(s.id)}, ${this.jsStringLiteral(s.scope)})">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span class="source-caret" style="transition: transform 0.2s; font-size: 10px; opacity: 0.8; display: inline-block;">▶</span>
            <span class="kind-pill" style="background: rgba(255, 255, 255, 0.1); color: var(--fg);">${this.escapeHtml(s.type)}</span>
          </div>
          <div style="overflow: hidden; white-space: nowrap; text-overflow: ellipsis;">
            <strong>${this.escapeHtml(s.name ?? s.id)}</strong>
          </div>
          <div style="opacity: 0.7; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${this.escapeHtml(s.url || s.localPath || '')}">
            ${s.url ? this.escapeHtml(s.url) : (s.localPath ? this.escapeHtml(s.localPath) : '')}
          </div>
          <div></div>
          <div class="source-actions" style="display: flex; gap: 4px; justify-content: flex-end;" onclick="event.stopPropagation()">
            <button class="btn btn-sm btn-secondary" title="Refresh source" onclick="vscode.postMessage({ command: 'refreshSource', sourceId: ${this.jsStringLiteral(s.id)}, scope: ${this.jsStringLiteral(s.scope)} })">↻</button>
            <button class="btn btn-sm btn-primary" title="Install Source Group" onclick="vscode.postMessage({ command: 'installSourceGroup', sourceId: ${this.jsStringLiteral(s.id)}, scope: ${this.jsStringLiteral(s.scope)} })">⬇</button>
            <button class="btn btn-sm btn-secondary" title="Export Source" onclick="vscode.postMessage({ command: 'exportSource', sourceId: ${this.jsStringLiteral(s.id)}, scope: ${this.jsStringLiteral(s.scope)} })">⇧</button>
            <button class="btn btn-sm btn-secondary" title="Remove Source" style="color: var(--badge-error); border-color: rgba(207, 34, 46, 0.3);" onclick="vscode.postMessage({ command: 'removeSource', sourceId: ${this.jsStringLiteral(s.id)}, scope: ${this.jsStringLiteral(s.scope)} })">🗑</button>
          </div>
        </div>
        <div class="source-catalog" id="catalog-${this.escapeHtml(s.id)}-${this.escapeHtml(s.scope)}" style="display: none; padding: 8px 10px 8px 30px; background: rgba(0,0,0,0.1); border-bottom: 1px solid var(--border);">
        </div>
      </div>
    `;

    html += `<div class="scope-group">
      <div class="scope-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 8px; margin-bottom: 8px;">
        <h3 style="margin: 0; font-size: 13px;">Global Sources</h3>
        <button class="btn btn-sm btn-secondary" title="Add Global Source" onclick="vscode.postMessage({ command: 'addSource', scope: 'global' })">＋</button>
      </div>
      <div class="source-list">
        ${globalSources.length > 0 ? globalSources.map(renderSourceRow).join('') : '<div class="empty-state" style="padding: 20px;">No global sources</div>'}
      </div>
    </div>`;

    html += `<div class="scope-group" style="margin-top: 24px;">
      <div class="scope-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 8px; margin-bottom: 8px;">
        <h3 style="margin: 0; font-size: 13px;">Workspace Sources</h3>
        <button class="btn btn-sm btn-secondary" title="Add Workspace Source" onclick="vscode.postMessage({ command: 'addSource', scope: 'project' })">＋</button>
      </div>
      <div class="source-list">
        ${projectSources.length > 0 ? projectSources.map(renderSourceRow).join('') : '<div class="empty-state" style="padding: 20px;">No workspace sources</div>'}
      </div>
    </div>`;

    return html;
  }

  private getRecommendationsHtml(pending: any[] = [], broken: any[] = []): string {
    let html = `
      <div class="toolbar" style="margin-bottom: 16px;">
        <button class="btn btn-primary" title="Install All Actionable" onclick="vscode.postMessage({ command: 'installRecommended' })">⬇</button>
      </div>
    `;

    if (pending.length === 0 && broken.length === 0) {
      html += `<div class="empty-state">No pending recommendations for this workspace.</div>`;
      return html;
    }

    if (pending.length > 0) {
      html += `
        <div class="scope-group">
          <div class="scope-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 8px; margin-bottom: 8px;">
            <h3 style="margin: 0; font-size: 13px;">Actionable Recommendations</h3>
          </div>
          <div class="source-list">
      `;
      for (const p of pending) {
        const installedInHtml = `<span class="filter-pill env-pill active" style="padding: 2px 6px; font-size: 10px; cursor: default; height: auto;">${this.escapeHtml(p.desired.assistant)}</span>`;
        html += `
          <div class="catalog-item artifact-row" style="padding: 8px; display: flex; align-items: center; gap: 10px; justify-content: space-between; border-bottom: 1px solid var(--border);">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="kind-pill kind-${this.escapeHtml(p.artifact.kind)}">${this.escapeHtml(p.artifact.kind)}</span>
              <span><strong>${this.escapeHtml(p.artifact.name)}</strong></span>
              ${installedInHtml}
              ${p.artifact.description ? `<span style="opacity:0.7; font-size:11px;">${this.escapeHtml(p.artifact.description)}</span>` : ''}
              <span style="opacity: 0.5; font-size: 10px; margin-left: 8px;">from ${this.escapeHtml(p.source.id)}</span>
            </div>
            <div style="display: flex; gap: 4px;">
              <button class="btn btn-sm btn-primary" title="Install" onclick="vscode.postMessage({ command: 'installRecommendation', sourceId: ${this.jsStringLiteral(p.source.id)}, scope: ${this.jsStringLiteral(p.source.scope)}, artifactId: ${this.jsStringLiteral(p.artifact.id)}, assistant: ${this.jsStringLiteral(p.desired.assistant)} })">⬇</button>
              <button class="btn btn-sm btn-secondary" title="Unrecommend" style="color: var(--badge-error); border-color: rgba(207, 34, 46, 0.3);" onclick="vscode.postMessage({ command: 'unrecommendRecommendation', sourceId: ${this.jsStringLiteral(p.desired.sourceId)}, artifactId: ${this.jsStringLiteral(p.desired.artifactId)}, assistant: ${this.jsStringLiteral(p.desired.assistant)} })">🗑</button>
            </div>
          </div>
        `;
      }
      html += `</div></div>`;
    }

    if (broken.length > 0) {
      html += `
        <div class="scope-group" style="margin-top: 24px;">
          <div class="scope-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 8px; margin-bottom: 8px;">
            <h3 style="margin: 0; font-size: 13px; color: var(--badge-error);">Broken Recommendations</h3>
          </div>
          <div class="source-list">
      `;
      for (const b of broken) {
        let reasonText = '';
        if (b.reason.kind === 'source-not-registered') {
          reasonText = 'Source not registered';
        } else if (b.reason.kind === 'source-resolution-failed') {
          reasonText = `Resolution failed (${b.reason.error})`;
        } else {
          reasonText = 'Artifact not found in source';
        }
        
        const installedInHtml = `<span class="filter-pill env-pill" style="padding: 2px 6px; font-size: 10px; cursor: default; height: auto;">${this.escapeHtml(b.desired.assistant)}</span>`;
        html += `
          <div class="catalog-item artifact-row" style="padding: 8px; display: flex; align-items: center; gap: 10px; justify-content: space-between; border-bottom: 1px solid var(--border); opacity: 0.8;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="color: var(--badge-error);">⚠️</span>
              <span><strong>${this.escapeHtml(b.desired.artifactId)}</strong></span>
              ${installedInHtml}
              <span style="color: var(--badge-error); font-size:11px;">${this.escapeHtml(reasonText)}</span>
              <span style="opacity: 0.5; font-size: 10px; margin-left: 8px;">from ${this.escapeHtml(b.desired.sourceId)}</span>
            </div>
            <div style="display: flex; gap: 4px;">
              <button class="btn btn-sm btn-secondary" title="Unrecommend" style="color: var(--badge-error); border-color: rgba(207, 34, 46, 0.3);" onclick="vscode.postMessage({ command: 'unrecommendRecommendation', sourceId: ${this.jsStringLiteral(b.desired.sourceId)}, artifactId: ${this.jsStringLiteral(b.desired.artifactId)}, assistant: ${this.jsStringLiteral(b.desired.assistant)} })">🗑</button>
            </div>
          </div>
        `;
      }
      html += `</div></div>`;
    }

    return html;
  }

  private getAssistantIconSrc(assistant: AssistantId): string {
    try {
      const iconUris = getAssistantIconPath(assistant, this._extensionUri);
      return this._panel.webview.asWebviewUri(iconUris.light).toString();
    } catch {
      return '';
    }
  }

  private getBadgeClass(state: PlaceState | string): string {
    switch (state) {
      case 'up-to-date':
      case 'identical':
        return 'badge-success';
      case 'update-available':
        return 'badge-info';
      case 'modified-locally':
      case 'modified-and-update-available':
      case 'different':
        return 'badge-warning';
      case 'missing-on-disk':
        return 'badge-error';
      case 'local-only':
        return 'badge-unmanaged';
      case 'checking':
      case 'checking…':
      default:
        return 'badge-pending';
    }
  }

  private getWorstStatusLabel(state: PlaceState | string): string {
    switch (state) {
      case 'up-to-date':
        return 'Up to date';
      case 'update-available':
        return 'Update available';
      case 'modified-locally':
        return 'Modified locally';
      case 'modified-and-update-available':
        return 'Modified & update available';
      case 'missing-on-disk':
        return 'Missing on disk';
      case 'different':
        return 'Differs from source';
      case 'identical':
        return 'Identical to source';
      case 'local-only':
        return 'Local only';
      case 'checking':
      case 'checking…':
        return 'checking…';
      default:
        return String(state);
    }
  }

  private getManagedPlaceBadgeText(state: PlaceState | string): string {
    switch (state) {
      case 'up-to-date':
        return '● Managed · up to date';
      case 'update-available':
        return '● Managed · update available';
      case 'modified-locally':
        return '● Managed · modified locally';
      case 'modified-and-update-available':
        return '● Managed · modified locally';
      case 'missing-on-disk':
        return '● Managed · missing on disk';
      case 'checking':
      case 'checking…':
        return '● Managed · checking…';
      default:
        return `● Managed · ${state}`;
    }
  }

  private getUnmanagedPlaceBadgeText(place: Place): string {
    if (place.state === 'identical') {
      return place.match?.sourceId
        ? `◌ Unmanaged · identical to ${place.match.sourceId}`
        : '◌ Unmanaged · identical';
    } else if (place.state === 'different') {
      return place.match?.sourceId
        ? `◌ Unmanaged · differs from ${place.match.sourceId}`
        : '◌ Unmanaged · differs';
    } else {
      return '◌ Unmanaged · local only';
    }
  }

  public renderInstalledTree(
    tree: InstalledObject[],
    driftByKey?: Map<string, PlaceState | string> | Record<string, PlaceState | string>
  ): string {
    if (!tree || tree.length === 0) {
      return '<tr><td colspan="4" style="text-align:center; opacity:0.6;">No items found.</td></tr>';
    }

    const lookupState = (key: string): PlaceState | undefined => {
      if (!driftByKey) return undefined;
      let raw: PlaceState | string | undefined;
      if (driftByKey instanceof Map) raw = driftByKey.get(key);
      else if (typeof driftByKey === 'object') raw = (driftByKey as Record<string, PlaceState | string>)[key];
      if (!raw) return undefined;
      if (raw === 'checking…') return 'checking';
      return raw as PlaceState;
    };

    let html = '';

    tree.forEach((obj, groupIdx) => {
      const placesWithState = obj.places.map((place) => {
        const injected = lookupState(place.key);
        return {
          ...place,
          state: injected ?? place.state,
        };
      });

      const worstState = placesWithState.reduce<PlaceState>((worst, p) => {
        const currSev = STATE_SEVERITY[p.state] ?? -1;
        const worstSev = STATE_SEVERITY[worst] ?? -1;
        return currSev > worstSev ? p.state : worst;
      }, placesWithState[0]?.state ?? 'up-to-date');

      const assistantsList = Array.from(new Set(placesWithState.map((p) => p.assistant))).join(',');
      const scopesList = Array.from(new Set(placesWithState.map((p) => p.scope))).join(',');
      const membershipsList = Array.from(new Set(placesWithState.map((p) => p.membership))).join(',');

      const chipsHtml = placesWithState.map((place) => {
        const chipClass = this.getBadgeClass(place.state);
        const iconSrc = this.getAssistantIconSrc(place.assistant);
        const scopeSvg = getScopeIconSvg(place.scope);
        const scopeLabel = getScopeLabel(place.scope);
        const title = `${place.assistant} · ${scopeLabel} · ${place.state}`;
        return `<span class="badge ${chipClass} parent-chip parent-badge" data-parent-key="${this.escapeHtml(place.key)}" title="${this.escapeHtml(title)}"><img src="${iconSrc}" class="assistant-icon" width="12" height="12" style="vertical-align: middle;" />${scopeSvg}</span>`;
      }).join('\n');

      const worstBadgeClass = this.getBadgeClass(worstState);
      const worstBadgeText = this.getWorstStatusLabel(worstState);

      const childRowsHtml = placesWithState.map((place) => {
        const asstIconSrc = this.getAssistantIconSrc(place.assistant);
        const scopeSvg = getScopeIconSvg(place.scope);
        const scopeLabel = getScopeLabel(place.scope);
        const childBadgeClass = this.getBadgeClass(place.state);
        const childBadgeText = place.membership === 'managed'
          ? this.getManagedPlaceBadgeText(place.state)
          : this.getUnmanagedPlaceBadgeText(place);

        let actionsHtml = '';
        if (place.membership === 'managed') {
          const hasDiff = place.state === 'modified-locally' || place.state === 'modified-and-update-available';
          const hasUpdate = place.state === 'update-available' || place.state === 'modified-and-update-available';
          actionsHtml = `
            <button class="btn btn-sm btn-secondary" title="Preview" onclick="event.stopPropagation(); vscode.postMessage({ command: 'previewInstalledArtifact', key: ${this.jsStringLiteral(place.key)} })">👁</button>
            <button class="btn btn-sm btn-secondary diff-btn" title="Diff" style="${hasDiff ? 'display: inline-block;' : 'display: none;'}" onclick="event.stopPropagation(); vscode.postMessage({ command: 'diffInstalledArtifact', key: ${this.jsStringLiteral(place.key)} })">⇄</button>
            <button class="btn btn-sm btn-primary update-btn" title="Update to latest" style="${hasUpdate ? 'display: inline-block;' : 'display: none;'}" onclick="event.stopPropagation(); vscode.postMessage({ command: 'updateItem', key: ${this.jsStringLiteral(place.key)} })">⟳</button>
          `;
        } else {
          const canPromote = place.state === 'identical' || place.state === 'different' || (place.match && place.match.status !== 'none');
          if (canPromote) {
            actionsHtml = `<button class="btn btn-sm btn-primary" title="Promote" onclick="event.stopPropagation(); promoteItem(${this.jsStringLiteral(place.key)})">⇧</button>`;
          }
        }

        const sourceIdAttr = place.membership === 'unmanaged' && place.match?.sourceId
          ? ` data-source-id="${this.escapeHtml(place.match.sourceId)}"`
          : '';

        return `
          <tr class="item-row sub-row"
            data-key="${this.escapeHtml(place.key)}"
            data-name="${this.escapeHtml(obj.name)}"
            data-kind="${this.escapeHtml(obj.kind)}"
            data-assistant="${this.escapeHtml(place.assistant)}"
            data-scope="${this.escapeHtml(place.scope)}"
            data-membership="${this.escapeHtml(place.membership)}"
            data-status="${this.escapeHtml(place.state)}"${sourceIdAttr}
            onclick="selectRow(this, ${this.jsStringLiteral(place.key)})">
            <td style="padding-left: 30px; width: 30%;">
              <img src="${asstIconSrc}" class="assistant-icon" width="14" height="14" style="vertical-align: middle; margin-right: 6px;" />
              ${this.escapeHtml(place.assistant)}
            </td>
            <td style="width: 15%;">
              <span title="${this.escapeHtml(scopeLabel)}">${scopeSvg}</span>
            </td>
            <td data-drift-key="${this.escapeHtml(place.key)}" data-status="${this.escapeHtml(place.state)}" style="width: 35%;">
              <span class="badge ${childBadgeClass}">${this.escapeHtml(childBadgeText)}</span>
            </td>
            <td style="text-align: right; width: 20%;">
              ${actionsHtml}
            </td>
          </tr>
        `;
      }).join('\n');

      const subrowsId = `subrows-${groupIdx}`;

      html += `
        <tbody class="matrix-group item-row-group"
          data-kind="${this.escapeHtml(obj.kind)}"
          data-name="${this.escapeHtml(obj.name.toLowerCase())}"
          data-worst-status="${this.escapeHtml(worstState)}"
          data-assistants="${this.escapeHtml(assistantsList)}"
          data-scopes="${this.escapeHtml(scopesList)}"
          data-memberships="${this.escapeHtml(membershipsList)}">
          <tr class="item-row parent-row"
            onclick="toggleFolder('${subrowsId}', this)"
            data-kind="${this.escapeHtml(obj.kind)}"
            data-name="${this.escapeHtml(obj.name.toLowerCase())}"
            data-worst-status="${this.escapeHtml(worstState)}"
            data-assistants="${this.escapeHtml(assistantsList)}"
            data-scopes="${this.escapeHtml(scopesList)}"
            data-memberships="${this.escapeHtml(membershipsList)}">
            <td>
              <span class="folder-icon" style="transition: transform 0.2s; font-size: 10px; opacity: 0.8; display: inline-block;">▶</span>
              <span class="kind-pill kind-${this.escapeHtml(obj.kind)}">${this.escapeHtml(obj.kind)}</span>
            </td>
            <td><strong>${this.escapeHtml(obj.name)}</strong></td>
            <td class="parent-chips-cell">
              <div class="chip-strip" style="display: inline-flex; gap: 4px; flex-wrap: wrap; align-items: center;">
                ${chipsHtml}
              </div>
            </td>
            <td class="parent-status-cell">
              <span class="badge ${worstBadgeClass} worst-badge" title="${placesWithState.length} place${placesWithState.length === 1 ? '' : 's'}">${this.escapeHtml(worstBadgeText)}</span>
            </td>
          </tr>
          <tr id="${subrowsId}" style="display: none;">
            <td colspan="4" style="padding: 0; border: none;">
              <table style="margin: 0; background: rgba(0,0,0,0.1); width: 100%;">
                <tbody>
                  ${childRowsHtml}
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      `;
    });

    return html;
  }

  private getInstalledSectionHtml(
    sources: Source[],
    managed: ManagedInstallation[],
    observed: ObservedArtifact[],
    reports: DriftReport[],
    scanning: boolean,
    totalInstalled: number,
    totalUnmanaged: number,
    updatesAvailable: number,
    modifiedLocally: number,
    identicalCount: number,
    environmentPills: string,
    rowsHtml: string
  ): string {
    return `
  <div class="stats-ribbon">
    <div class="stat-chip">
      <span class="stat-num" id="stat-managed">${totalInstalled}</span>
      <span class="stat-label">Managed Installations</span>
    </div>
    <div class="stat-chip stat-info" style="cursor: pointer;" onclick="triggerUpdateAll()">
      <span class="stat-num" id="stat-updates-available">${updatesAvailable}</span>
      <span class="stat-label">Updates Available</span>
    </div>
    <div class="stat-chip stat-warning">
      <span class="stat-num" id="stat-modified-locally">${modifiedLocally}</span>
      <span class="stat-label">Modified Locally</span>
    </div>
    <div class="stat-chip stat-unmanaged">
      <span class="stat-num" id="stat-unmanaged">${totalUnmanaged}</span>
      <span class="stat-label" id="stat-unmanaged-lbl">Unmanaged Discovered (${identicalCount} identical, ${totalUnmanaged - identicalCount} custom)</span>
    </div>
  </div>
  
  <div class="breadcrumb" id="breadcrumb" style="display: none;">
    <span class="breadcrumb-text">Active filters:</span>
    <span id="breadcrumb-chips"></span>
  </div>

  <div class="toolbar filters-bar">
    <div class="filter-group" id="filter-group-env">
      <span class="filter-group-label">ENV</span>
      <button class="filter-pill env-pill active" data-env="all" aria-pressed="true" onclick="setEnvFilter('all')">All Env</button>
      ${environmentPills}
    </div>
    <div class="filter-group" id="filter-group-scope">
      <span class="filter-group-label">SCOPE</span>
      <button class="filter-pill scope-pill active" data-scope="all" aria-pressed="true" onclick="setScopeFilter('all')">All</button>
      <button class="filter-pill scope-pill" data-scope="global" aria-pressed="false" onclick="setScopeFilter('global')">${getScopeIconSvg('global')}${getScopeLabel('global')}</button>
      <button class="filter-pill scope-pill" data-scope="project" aria-pressed="false" onclick="setScopeFilter('project')">${getScopeIconSvg('project')}${getScopeLabel('project')}</button>
    </div>
    <div class="filter-group" id="filter-group-membership">
      <span class="filter-group-label">MEMBERSHIP</span>
      <button class="filter-pill membership-pill active" data-membership="all" aria-pressed="true" onclick="setMembershipFilter('all')">All</button>
      <button class="filter-pill membership-pill" data-membership="managed" aria-pressed="false" onclick="setMembershipFilter('managed')">● Managed</button>
      <button class="filter-pill membership-pill" data-membership="unmanaged" aria-pressed="false" onclick="setMembershipFilter('unmanaged')">◌ Unmanaged</button>
    </div>
    <div class="filter-group" id="filter-group-kind">
      <span class="filter-group-label">KIND</span>
      <button class="filter-pill kind-filter-pill active" data-kind="all" aria-pressed="true" onclick="setKindFilter('all', this)">All</button>
      <button class="filter-pill kind-filter-pill" data-kind="skill" aria-pressed="false" onclick="setKindFilter('skill', this)">Skills</button>
      <button class="filter-pill kind-filter-pill" data-kind="agent" aria-pressed="false" onclick="setKindFilter('agent', this)">Agents</button>
      <button class="filter-pill kind-filter-pill" data-kind="command" aria-pressed="false" onclick="setKindFilter('command', this)">Commands</button>
      <button class="filter-pill kind-filter-pill" data-kind="mcp-server" aria-pressed="false" onclick="setKindFilter('mcp-server', this)">MCPs</button>
      <button class="filter-pill kind-filter-pill" data-kind="hook" aria-pressed="false" onclick="setKindFilter('hook', this)">Hooks</button>
      <button class="filter-pill kind-filter-pill" data-kind="rule" aria-pressed="false" onclick="setKindFilter('rule', this)">Rules</button>
    </div>
    <div class="filter-search" style="flex: 1; min-width: 160px;">
      <input type="text" class="search-input" id="searchBox" placeholder="Filter by name..." oninput="filterTable()">
    </div>
    <div class="filter-actions">
      <button class="btn btn-sm btn-primary update-all-btn" id="updateAllBtn" title="Update all (${updatesAvailable})" ${updatesAvailable === 0 ? 'disabled' : ''} onclick="triggerUpdateAll()">⟳</button>
    </div>
  </div>

  <table id="managedTable">
    <thead>
      <tr>
        <th style="cursor: pointer;" onclick="sortMatrix('kind')">Kind ↕</th>
        <th style="cursor: pointer;" onclick="sortMatrix('name')">Name ↕</th>
        <th>Places</th>
        <th style="cursor: pointer;" onclick="sortMatrix('worst-status')">Status ↕</th>
      </tr>
    </thead>
    <tbody id="unifiedTable">
      ${rowsHtml}
    </tbody>
  </table>

  <div id="detailPanel">
    <div class="detail-header">
      <div class="detail-header-title-row">
        <span id="detailKind" class="kind-pill"></span>
        <h3 id="detailTitle">Item Details</h3>
      </div>
      <div class="detail-header-meta">
        <span id="detailAssistant" class="detail-meta-item"></span>
        <span id="detailScope" class="detail-meta-item"></span>
      </div>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">Status</div>
      <div id="detailStatus"></div>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">Origin</div>
      <div id="detailOrigin"></div>
    </div>
    <div class="detail-section" id="locationSection">
      <div class="detail-section-title">Location</div>
      <div id="detailLocationContainer">
        <a href="#" id="detailLocation" class="detail-path-link" title="Click to preview file"></a>
      </div>
    </div>
    <div class="detail-section" id="crossFrameworkSection" style="display: none;">
      <div class="detail-section-title">Installed also in</div>
      <ul class="cross-framework-list" id="crossFrameworkList"></ul>
    </div>
    <div class="detail-actions" id="detailActions"></div>
  </div>
`;
  }

  public getHtml(
    sources: Source[],
    managed: ManagedInstallation[],
    observed: ObservedArtifact[],
    reports: DriftReport[],
    scanning: boolean = false,
    sourceFilter?: { id: string; scope: Scope }
  ): string {
    

    const totalInstalled = managed.length;
    const totalUnmanaged = observed.length;
    const updatesAvailable = reports.filter(
      (r) => r.status === 'update-available' || r.status === 'modified-and-update-available'
    ).length;
    const modifiedLocally = reports.filter(
      (r) => r.status === 'modified-locally' || r.status === 'modified-and-update-available'
    ).length;
    const identicalCount = observed.filter((o) => o.match?.status === 'identical').length;

    const reportMap = new Map(reports.map((r) => [getIdentityKey(r.installation), r]));

    const recGroup = this._availableProvider.getCachedRecommendedGroup?.();
    const pendingRecommendationsCount = recGroup ? recGroup.pending.length : 0;

    const presentAssistants = Array.from(new Set([...managed.map(m => m.assistant), ...observed.map(o => o.assistant)])).sort();
    const environmentPills = presentAssistants.map(a => {
      const iconUris = getAssistantIconPath(a as AssistantId, this._extensionUri);
      const iconSrc = this._panel.webview.asWebviewUri(iconUris.light);
      return `<button class="filter-pill env-pill" data-env="${this.escapeHtml(a)}" aria-pressed="false" onclick="setEnvFilter(${this.jsStringLiteral(a)})">
        <img src="${iconSrc}" class="assistant-icon" width="14" height="14" />
        ${this.escapeHtml(a)}
      </button>`;
    }).join('\n');

    const driftByKey = new Map<string, PlaceState | string>();
    for (const r of reports) {
      driftByKey.set(getIdentityKey(r.installation), r.status);
    }
    if (!scanning) {
      for (const m of managed) {
        const k = getIdentityKey(m);
        if (!driftByKey.has(k)) {
          driftByKey.set(k, 'up-to-date');
        }
      }
    }

    const tree = buildInstalledTree(managed, observed, { statusByKey: driftByKey });
    const rowsHtml = this.renderInstalledTree(tree, driftByKey);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Swissknife Dashboard</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --card-bg: var(--vscode-sideBar-background, #252526);
      --border: var(--vscode-panel-border, #333);
      --btn-bg: var(--vscode-button-background, #0e639c);
      --btn-fg: var(--vscode-button-foreground, #fff);
      --badge-success: #2ea043;
      --badge-info: #0969da;
      --badge-warning: #d29922;
      --badge-error: #cf222e;
    }
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      background-color: var(--bg);
      color: var(--fg);
      padding: 16px 20px;
      margin: 0;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border);
    }
    .title-group h1 {
      margin: 0 0 2px 0;
      font-size: 18px;
      font-weight: 600;
    }
    .title-group p {
      margin: 0;
      opacity: 0.7;
      font-size: 12px;
    }
    .header-actions {
      display: flex;
      gap: 8px;
    }
    .stats-ribbon {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 16px;
    }
    .stat-chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 12px;
    }
    .stat-num {
      font-size: 15px;
      font-weight: 700;
    }
    .stat-label {
      opacity: 0.8;
      font-size: 11px;
    }
    .stat-info .stat-num { color: #58a6ff; }
    .stat-warning .stat-num { color: #d29922; }
    .stat-success .stat-num { color: #3fb950; }
    .toolbar {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
      align-items: center;
    }
    .filters-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-bottom: 16px;
    }
    .filter-group {
      display: inline-flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 4px;
      padding: 3px 6px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--card-bg);
    }
    .filter-group-label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      opacity: 0.6;
      color: var(--fg);
      margin-right: 2px;
      user-select: none;
    }
    .filter-pill {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--fg);
      padding: 3px 8px;
      border-radius: 12px;
      cursor: pointer;
      font-size: 11px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      line-height: 1.2;
    }
    .filter-pill:hover {
      border-color: var(--fg);
    }
    .filter-pill.active {
      background: var(--btn-bg);
      color: var(--btn-fg);
      border-color: var(--btn-bg);
    }
    .filter-pill .scope-icon {
      margin-right: 0 !important;
    }
    .filter-pill.active .scope-icon {
      color: var(--btn-fg);
    }
    .assistant-icon { filter: grayscale(1) brightness(0.8); }
    .filter-pill.active .assistant-icon { filter: grayscale(0) brightness(1.2); }
    
    .breadcrumb { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; font-size: 12px; min-height: 24px;}
    .breadcrumb-text { opacity: 0.7; font-size: 11px; }
    .chip { display: inline-flex; align-items: center; gap: 4px; background: rgba(255, 255, 255, 0.1); border: 1px solid var(--border); border-radius: 4px; padding: 2px 6px; font-size: 11px; }
    .chip-close { cursor: pointer; opacity: 0.6; }
    .chip-close:hover { opacity: 1; color: var(--badge-error); }
    .search-input {
      flex: 1;
      background: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #fff);
      border: 1px solid var(--vscode-input-border, #555);
      border-radius: 4px;
      padding: 6px 10px;
      font-size: 12px;
    }
    .tabs {
      display: flex;
      gap: 6px;
    }
    .tab-btn {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--fg);
      padding: 5px 10px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
    }
    .tab-btn.active {
      background: var(--btn-bg);
      color: var(--btn-fg);
      border-color: var(--btn-bg);
    }
    .btn {
      background: var(--btn-bg);
      color: var(--btn-fg);
      border: none;
      border-radius: 4px;
      padding: 6px 12px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      min-width: 28px;
      text-align: center;
    }
    .btn-sm {
      padding: 3px 8px;
      font-size: 11px;
      min-width: 24px;
    }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.1);
      color: var(--fg);
      border: 1px solid var(--border);
    }
    .btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 6px;
      font-size: 12px;
    }
    th, td {
      padding: 8px 10px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    th {
      opacity: 0.8;
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .kind-pill {
      display: inline-block;
      padding: 2px 5px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .kind-skill { background: rgba(56, 139, 253, 0.2); color: #58a6ff; }
    .kind-agent { background: rgba(163, 113, 247, 0.2); color: #bc8cff; }
    .kind-command { background: rgba(210, 153, 34, 0.2); color: #d29922; }
    .kind-mcp-server { background: rgba(46, 160, 67, 0.2); color: #3fb950; }
    .scope-pill {
      display: inline-block;
      padding: 2px 5px;
      border-radius: 4px;
      font-size: 10px;
    }
    .scope-project { background: rgba(255, 255, 255, 0.1); }
    .scope-global { background: rgba(0, 150, 255, 0.15); }
    .scope-icon {
      vertical-align: middle;
      display: inline-block;
      color: inherit;
    }
    .scope-icon.scope-icon-global,
    .scope-icon.scope-global {
      color: var(--vscode-charts-blue, #58a6ff);
    }
    .scope-icon.scope-icon-project,
    .scope-icon.scope-project {
      color: inherit;
    }
    .badge {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 500;
    }
    .badge-success { background: rgba(46, 160, 67, 0.2); color: #3fb950; }
    .badge-info { background: rgba(56, 139, 253, 0.2); color: #58a6ff; }
    .badge-warning { background: rgba(210, 153, 34, 0.2); color: #d29922; }
    .badge-error { background: rgba(207, 34, 46, 0.2); color: #f85149; }
    .badge-unmanaged { background: rgba(255, 255, 255, 0.1); color: var(--fg); }
    .badge-pending { background: rgba(136, 136, 136, 0.2); color: #888888; }
    .parent-chips-cell { padding: 6px 10px; }
    .parent-chip { display: inline-flex; align-items: center; gap: 3px; padding: 2px 6px; }
    .parent-chip .scope-icon { margin-right: 0 !important; }
    .scan-indicator { font-size: 11px; opacity: 0.8; display: flex; align-items: center; gap: 6px; }
    .spinner { border: 2px solid rgba(136, 136, 136, 0.2); border-top-color: #888; border-radius: 50%; width: 10px; height: 10px; animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    
    .item-row { cursor: pointer; }
    .item-row:hover { background-color: rgba(255, 255, 255, 0.05); }
    .item-row.selected { background-color: rgba(255, 255, 255, 0.1); }
    
    #detailPanel {
      margin-top: 16px;
      padding: 16px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      display: none;
    }
    .detail-header {
      margin-bottom: 14px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border);
    }
    .detail-header-title-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    .detail-header-title-row h3 {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
    }
    .detail-header-meta {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 12px;
      opacity: 0.9;
    }
    .detail-meta-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .detail-section {
      margin-bottom: 12px;
      font-size: 12px;
    }
    .detail-section-title {
      font-weight: 600;
      margin-bottom: 4px;
      opacity: 0.8;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    #detailOrigin {
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.4;
    }
    .detail-path-link {
      color: var(--link-fg, #58a6ff);
      text-decoration: none;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      word-break: break-all;
      cursor: pointer;
    }
    .detail-path-link:hover {
      text-decoration: underline;
    }
    .cross-framework-list {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .cross-framework-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .cross-framework-item.fallback {
      border: 1px dashed var(--border);
      padding: 2px 4px;
      border-radius: 4px;
      opacity: 0.8;
    }
    .detail-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid var(--border);
    }
    .action-group {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .action-group-destructive {
      margin-left: auto;
    }
    .btn-destructive {
      color: var(--badge-error) !important;
      border-color: rgba(207, 34, 46, 0.3) !important;
    }
    .btn .btn-icon {
      margin-right: 4px;
    }
  
    .section-tab-btn.active {
      border-bottom-color: var(--btn-bg) !important;
      color: var(--btn-bg) !important;
    }
    .empty-state {
      padding: 40px;
      text-align: center;
      opacity: 0.6;
      border: 1px dashed var(--border);
      border-radius: 6px;
    }
</style>
</head>
<body>
  <div class="header">
    <div class="title-group">
      <h1>AI Swissknife Dashboard</h1>
      <p>Inventory, drift tracking, and unmanaged artifact promotion</p>
    </div>
    
    <div class="header-actions">
      ${scanning ? '<div class="scan-indicator" id="scan-indicator"><div class="spinner"></div>Scanning for updates…</div>' : ''}
      <button class="btn btn-primary" title="New Artifact" onclick="vscode.postMessage({ command: 'createArtifact' })">＋</button>
      <button class="btn btn-secondary" title="Refresh" onclick="refreshState()">↻</button>
      ${identicalCount > 0 ? '<button class="btn btn-primary" onclick="promoteAllIdentical()">Promote ' + identicalCount + ' Identical Source Items</button>' : ''}
    </div>
  </div>
  <div class="toolbar section-tabs" style="border-bottom: 1px solid var(--border); margin-bottom: 16px; padding-bottom: 0;">
    <div class="tabs" style="gap: 16px; margin-bottom: -1px;">
      <button class="tab-btn section-tab-btn" data-section="overview" onclick="switchSection('overview')" style="border: none; border-bottom: 2px solid transparent; border-radius: 0; padding: 8px 12px; font-size: 12px; background: transparent;">Overview</button>
      <button class="tab-btn section-tab-btn active" data-section="installed" onclick="switchSection('installed')" style="border: none; border-bottom: 2px solid var(--btn-bg); border-radius: 0; padding: 8px 12px; font-size: 12px; background: transparent; color: var(--fg);">Installed</button>
      <button class="tab-btn section-tab-btn" data-section="catalog" onclick="switchSection('catalog')" style="border: none; border-bottom: 2px solid transparent; border-radius: 0; padding: 8px 12px; font-size: 12px; background: transparent;">Sources &amp; Catalog</button>
      <button class="tab-btn section-tab-btn" data-section="recommendations" onclick="switchSection('recommendations')" style="border: none; border-bottom: 2px solid transparent; border-radius: 0; padding: 8px 12px; font-size: 12px; background: transparent;">Recommendations</button>
    </div>
  </div>

  <div id="section-overview" class="dashboard-section" style="display: none;">
    ${this.getOverviewHtml(sources, managed, reports, scanning, totalInstalled, totalUnmanaged, updatesAvailable, modifiedLocally, pendingRecommendationsCount)}
  </div>
  <div id="section-installed" class="dashboard-section" style="display: block;">
    ${this.getInstalledSectionHtml(sources, managed, observed, reports, scanning, totalInstalled, totalUnmanaged, updatesAvailable, modifiedLocally, identicalCount, environmentPills, rowsHtml)}
  </div>
  <div id="section-catalog" class="dashboard-section" style="display: none;">
    ${this.getSourcesCatalogHtml(sources)}
  </div>
  <div id="section-recommendations" class="dashboard-section" style="display: none;">
    ${this.getRecommendationsHtml()}
  </div>
  
  <script type="application/json" id="managedDataJson">${JSON.stringify(managed).replace(/</g, '\\u003c')}</script>
  <script type="application/json" id="observedDataJson">${JSON.stringify(observed).replace(/</g, '\\u003c')}</script>
  <script type="application/json" id="sourceFilterJson">${JSON.stringify(sourceFilter ?? null).replace(/</g, '\\u003c')}</script>

  <script>
    const vscode = acquireVsCodeApi();
    let currentSection = 'installed';
    function switchSection(sectionId) {
      currentSection = sectionId;
      document.querySelectorAll('.dashboard-section').forEach(el => el.style.display = 'none');
      document.querySelectorAll('.section-tab-btn').forEach(btn => btn.classList.remove('active'));
      
      const targetSection = document.getElementById('section-' + sectionId);
      if (targetSection) targetSection.style.display = 'block';
      
      const targetBtn = document.querySelector('.section-tab-btn[data-section="' + sectionId + '"]');
      if (targetBtn) targetBtn.classList.add('active');
    }

    function escapeHtmlClient(unsafe) {
      return (unsafe || '')
        .toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function toggleSource(rowEl, sourceId, scope) {
      const caret = rowEl.querySelector('.source-caret');
      const catalogDiv = document.getElementById('catalog-' + escapeHtmlClient(sourceId) + '-' + escapeHtmlClient(scope));
      if (!catalogDiv) return;
      if (catalogDiv.style.display === 'none') {
        catalogDiv.style.display = 'block';
        if (caret) caret.style.transform = 'rotate(90deg)';
        if (!catalogDiv.getAttribute('data-loaded')) {
          catalogDiv.innerHTML = '<div class="spinner" style="display:inline-block; margin-right: 6px; width: 10px; height: 10px;"></div><span style="opacity:0.7; font-size: 11px;">Loading catalog...</span>';
          vscode.postMessage({ command: 'requestCatalog', sourceId: sourceId, scope: scope });
        }
      } else {
        catalogDiv.style.display = 'none';
        if (caret) caret.style.transform = 'rotate(0deg)';
      }
    }

    function toggleFolder(folderId, rowEl) {
      const folderDiv = document.getElementById(folderId);
      const caret = rowEl ? rowEl.querySelector('.folder-icon') : null;
      if (!folderDiv) return;
      if (folderDiv.style.display === 'none') {
        folderDiv.style.display = '';
        if (caret) caret.style.transform = 'rotate(90deg)';
      } else {
        folderDiv.style.display = 'none';
        if (caret) caret.style.transform = 'rotate(0deg)';
      }
    }

    let managedData = JSON.parse(document.getElementById('managedDataJson').textContent);
    let observedData = JSON.parse(document.getElementById('observedDataJson').textContent);

    let currentKind = 'all';
    let currentEnv = 'all';
    let currentScope = 'all';
    let currentMembership = 'all';
    let currentSource = JSON.parse(document.getElementById('sourceFilterJson').textContent);
    let selectedItemKey = null;
    let detailItemData = null;

    const scopeProjectSvg = ${JSON.stringify(getScopeIconSvg('project'))};
    const scopeGlobalSvg = ${JSON.stringify(getScopeIconSvg('global'))};
    function getScopeLabelClient(scope) {
      return scope === 'project' ? 'Workspace' : 'Global';
    }

    function getScopeIconSvgClient(scope) {
      return scope === 'project' ? scopeProjectSvg : scopeGlobalSvg;
    }

    function computeItemOriginClient(membership, item, candidates) {
      if (membership === 'managed') {
        if (!item || !item.sourceId) return 'Local only: not found in any registered source';
        const commit = item.sourceRevision && item.sourceRevision.commit;
        const shortCommit = commit ? (commit.length > 7 ? commit.slice(0, 7) : commit) : '';
        return item.sourceId + (shortCommit ? '@' + shortCommit : '');
      }
      const cands = (candidates && candidates.length > 0)
        ? candidates
        : (item && item.candidates && item.candidates.length > 0)
          ? item.candidates
          : (item && item.match && item.match.status !== 'unmatched' && item.match.sourceId)
            ? [item.match]
            : [];
      if (cands.length === 0) {
        return 'Local only: not found in any registered source';
      }
      return cands.map(function(c) {
        const src = c.sourceId || 'unknown';
        if (c.status === 'identical') {
          return 'Matches registered source "' + src + '" — identical';
        } else if (c.status === 'different') {
          return 'Matches registered source "' + src + '" — differs (your copy was changed or is a different version)';
        } else {
          return 'Matches registered source "' + src + '"';
        }
      }).join('\\n');
    }

    function selectRow(rowEl, key) {
      document.querySelectorAll('.item-row').forEach(r => r.classList.remove('selected'));
      rowEl.classList.add('selected');
      selectedItemKey = key;
      document.getElementById('detailPanel').style.display = 'block';

      const name = rowEl.getAttribute('data-name') || '';
      const kind = rowEl.getAttribute('data-kind') || '';
      const asst = rowEl.getAttribute('data-assistant') || '';
      const scope = rowEl.getAttribute('data-scope') || '';

      const kindEl = document.getElementById('detailKind');
      if (kindEl) {
        kindEl.textContent = kind;
        kindEl.className = kind ? 'kind-pill kind-' + kind : 'kind-pill';
      }
      const titleEl = document.getElementById('detailTitle');
      if (titleEl) {
        titleEl.textContent = name || 'Item Details';
      }
      const asstEl = document.getElementById('detailAssistant');
      if (asstEl) {
        asstEl.innerHTML = asst ? '<span>' + escapeHtmlClient(asst) + '</span>' : '';
      }
      const scopeEl = document.getElementById('detailScope');
      if (scopeEl) {
        if (scope) {
          const scopeLabel = getScopeLabelClient(scope);
          const scopeIcon = getScopeIconSvgClient(scope);
          scopeEl.innerHTML = scopeIcon + '<span class="scope-label">' + escapeHtmlClient(scopeLabel) + '</span>';
        } else {
          scopeEl.innerHTML = '';
        }
      }

      document.getElementById('detailOrigin').innerHTML = '<div class="spinner"></div> Loading...';
      const statusEl = document.getElementById('detailStatus');
      if (statusEl) statusEl.innerHTML = '<span class="badge badge-pending">Loading…</span>';
      const locEl = document.getElementById('detailLocation');
      if (locEl) {
        locEl.textContent = '';
        locEl.onclick = null;
      }
      document.getElementById('crossFrameworkSection').style.display = 'none';
      document.getElementById('detailActions').innerHTML = '';
      
      vscode.postMessage({ command: 'requestDetail', key: key });
    }

    // Switches to the Installed tab and opens a specific row's detail
    // panel by identity key. Deliberately avoids building a CSS attribute
    // selector string out of the key (e.g. '[data-key="' + key + '"]') --
    // an artifact name containing a quote character would break that
    // selector string the same way it used to break onclick handlers built
    // via string concatenation; a plain attribute-value comparison over
    // the existing rows sidesteps CSS-selector escaping entirely.
    function jumpToInstalledRow(key) {
      switchSection('installed');
      const row = Array.from(document.querySelectorAll('#section-installed .item-row[data-key]'))
        .find(r => r.getAttribute('data-key') === key);
      if (row) {
        const subrowsTr = row.closest('tr[id^="subrows-"]');
        if (subrowsTr && subrowsTr.style.display === 'none') {
          subrowsTr.style.display = '';
          const parentRow = subrowsTr.previousElementSibling;
          const caret = parentRow ? parentRow.querySelector('.folder-icon') : null;
          if (caret) caret.style.transform = 'rotate(90deg)';
        }
        selectRow(row, key);
      }
    }

    function detailPreviewItem() {
      if (selectedItemKey) {
        vscode.postMessage({ command: 'previewInstalledArtifact', key: selectedItemKey });
      }
    }

    function detailDiffItem() {
      if (selectedItemKey) {
        vscode.postMessage({ command: 'diffInstalledArtifact', key: selectedItemKey });
      } else if (detailItemData) {
        vscode.postMessage({ command: 'diffItem', item: detailItemData });
      }
    }

    function diffItem() {
      detailDiffItem();
    }

    function detailEditItem() {
      if (detailItemData) {
        vscode.postMessage({ command: 'edit', installation: detailItemData });
      }
    }

    function detailPromoteItem() {
      if (detailItemData) {
        vscode.postMessage({ command: 'promote', observed: detailItemData });
      }
    }

    function detailCopyItem() {
      if (detailItemData) {
        vscode.postMessage({ command: 'copyItem', item: detailItemData });
      }
    }

    function detailMoveItem() {
      if (detailItemData) {
        vscode.postMessage({ command: 'moveItem', item: detailItemData });
      }
    }

    function detailUninstallItem() {
      if (selectedItemKey) {
        vscode.postMessage({ command: 'uninstallItem', key: selectedItemKey });
      }
    }

    function detailUpdateItem() {
      if (selectedItemKey) {
        vscode.postMessage({ command: 'updateItem', key: selectedItemKey });
      }
    }

    function triggerUpdateAll() {
      const filter = {};
      if (currentEnv !== 'all') filter.assistant = currentEnv;
      if (currentScope !== 'all') filter.scope = currentScope;
      if (currentKind !== 'all') filter.kind = currentKind;
      vscode.postMessage({ command: 'updateAll', filter });
    }

    function refreshState() {
      vscode.postMessage({ command: 'refresh' });
    }

    function editItem(index) {
      const item = managedData[index];
      vscode.postMessage({ command: 'edit', installation: item });
    }

    function promoteItem(keyOrIndex) {
      let item;
      if (typeof keyOrIndex === 'number') {
        item = observedData[keyOrIndex];
      } else if (typeof keyOrIndex === 'string') {
        item = observedData.find(o => {
          const k = o.assistant + ':' + o.scope + ':' + o.kind + ':' + (o.projectPath || '') + ':' + o.name;
          return k === keyOrIndex;
        });
      }
      if (item) {
        vscode.postMessage({ command: 'promote', observed: item });
      }
    }

    function promoteAllIdentical() {
      vscode.postMessage({ command: 'promoteAllIdentical', items: observedData });
    }

    function setEnvFilter(env) {
      currentEnv = env;
      document.querySelectorAll('.env-pill').forEach(b => {
        if (b.getAttribute('data-env') === env) {
          b.classList.add('active');
          if (b.setAttribute) b.setAttribute('aria-pressed', 'true');
        } else {
          b.classList.remove('active');
          if (b.setAttribute) b.setAttribute('aria-pressed', 'false');
        }
      });
      filterTable();
    }

    function setScopeFilter(scope) {
      currentScope = scope;
      document.querySelectorAll('.scope-pill').forEach(b => {
        if (b.getAttribute('data-scope') === scope) {
          b.classList.add('active');
          if (b.setAttribute) b.setAttribute('aria-pressed', 'true');
        } else {
          b.classList.remove('active');
          if (b.setAttribute) b.setAttribute('aria-pressed', 'false');
        }
      });
      filterTable();
    }

    function setMembershipFilter(mem) {
      currentMembership = mem;
      document.querySelectorAll('.membership-pill').forEach(b => {
        if (b.getAttribute('data-membership') === mem) {
          b.classList.add('active');
          if (b.setAttribute) b.setAttribute('aria-pressed', 'true');
        } else {
          b.classList.remove('active');
          if (b.setAttribute) b.setAttribute('aria-pressed', 'false');
        }
      });
      filterTable();
    }

    function setKindFilter(kind, btn) {
      currentKind = kind;
      document.querySelectorAll('.kind-filter-pill').forEach(b => {
        const k = b.getAttribute('data-kind');
        const matches = (k === kind) || (!k && (b.innerText && (b.innerText.toLowerCase().includes(kind) || (kind === 'all' && b.innerText.toLowerCase().includes('all')))));
        if (matches) {
          b.classList.add('active');
          if (b.setAttribute) b.setAttribute('aria-pressed', 'true');
        } else {
          b.classList.remove('active');
          if (b.setAttribute) b.setAttribute('aria-pressed', 'false');
        }
      });
      filterTable();
    }

    function removeChip(type) {
      if (type === 'env') { setEnvFilter('all'); }
      if (type === 'scope') { setScopeFilter('all'); }
      if (type === 'membership') { setMembershipFilter('all'); }
      if (type === 'kind') { setKindFilter('all', null); }
      if (type === 'source') { currentSource = null; filterTable(); }
    }

    function updateBreadcrumb() {
      const chipsContainer = document.getElementById('breadcrumb-chips');
      const chips = [];
      if (currentSource) chips.push('<span class="chip">' + escapeHtmlClient(currentSource.id) + ' (' + escapeHtmlClient(currentSource.scope) + ') <span class="chip-close" onclick="removeChip(\\'source\\')">✕</span></span>');
      if (currentEnv !== 'all') chips.push('<span class="chip">' + currentEnv + ' <span class="chip-close" onclick="removeChip(\\'env\\')">✕</span></span>');
      if (currentScope !== 'all') chips.push('<span class="chip">' + getScopeLabelClient(currentScope) + ' <span class="chip-close" onclick="removeChip(\\'scope\\')">✕</span></span>');
      if (currentMembership !== 'all') chips.push('<span class="chip">' + currentMembership + ' <span class="chip-close" onclick="removeChip(\\'membership\\')">✕</span></span>');
      if (currentKind !== 'all') chips.push('<span class="chip">' + currentKind + ' <span class="chip-close" onclick="removeChip(\\'kind\\')">✕</span></span>');
      
      if (chips.length > 0) {
        chipsContainer.innerHTML = chips.join(' · ');
        document.getElementById('breadcrumb').style.display = 'flex';
      } else {
        chipsContainer.innerHTML = '';
        document.getElementById('breadcrumb').style.display = 'none';
      }
    }

    let currentSortCol = 'name';
    let currentSortAsc = true;
    function sortMatrix(col) {
      if (currentSortCol === col) {
        currentSortAsc = !currentSortAsc;
      } else {
        currentSortCol = col;
        currentSortAsc = true;
      }
      
      const tbody = document.getElementById('unifiedTable');
      if (!tbody) return;
      
      const groups = Array.from(tbody.querySelectorAll('.matrix-group'));
      groups.sort((a, b) => {
        let valA, valB;
        if (col === 'worst-status') {
          const severities = {
            'missing-on-disk': 8,
            'modified-and-update-available': 7,
            'update-available': 6,
            'modified-locally': 5,
            'different': 4,
            'local-only': 3,
            'checking': 2,
            'checking…': 2,
            'identical': 1,
            'up-to-date': 0
          };
          valA = severities[a.getAttribute('data-worst-status') || 'checking…'] || 0;
          valB = severities[b.getAttribute('data-worst-status') || 'checking…'] || 0;
          // Sort descending for worst status by default
          if (valA < valB) return currentSortAsc ? 1 : -1;
          if (valA > valB) return currentSortAsc ? -1 : 1;
        } else if (col === 'scope' || col === 'scopes') {
          valA = a.getAttribute('data-scopes') || a.getAttribute('data-scope') || '';
          valB = b.getAttribute('data-scopes') || b.getAttribute('data-scope') || '';
          if (valA < valB) return currentSortAsc ? -1 : 1;
          if (valA > valB) return currentSortAsc ? 1 : -1;
        } else {
          valA = a.getAttribute('data-' + col) || '';
          valB = b.getAttribute('data-' + col) || '';
          if (valA < valB) return currentSortAsc ? -1 : 1;
          if (valA > valB) return currentSortAsc ? 1 : -1;
        }
        return 0;
      });
      
      groups.forEach(g => tbody.appendChild(g));
    }

    function filterTable() {
      updateBreadcrumb();
      const q = (document.getElementById('searchBox') ? document.getElementById('searchBox').value : '').toLowerCase();
      
      let visManaged = 0;
      let visUpdates = 0;
      let visModified = 0;
      let visUnmanaged = 0;
      let visUnmanagedIdentical = 0;

      const groups = document.querySelectorAll('.matrix-group');
      groups.forEach(group => {
        const kind = group.getAttribute('data-kind') || '';
        const name = (group.getAttribute('data-name') || '').toLowerCase();
        const text = group.innerText.toLowerCase();

        const matchesKind = currentKind === 'all' || kind === currentKind;
        const matchesQuery = !q || text.includes(q) || name.includes(q);

        let matchingChildrenCount = 0;

        group.querySelectorAll('.sub-row').forEach(child => {
          const childEnv = child.getAttribute('data-assistant') || '';
          const childScope = child.getAttribute('data-scope') || '';
          const childMem = child.getAttribute('data-membership') || '';
          const childStatus = child.getAttribute('data-status') || '';
          const childSourceId = child.getAttribute('data-source-id') || '';
          const childSourceScope = child.getAttribute('data-source-scope') || '';

          const matchesEnv = currentEnv === 'all' || childEnv === currentEnv;
          const matchesScope = currentScope === 'all' || childScope === currentScope;
          const matchesMem = currentMembership === 'all' || childMem === currentMembership;
          const matchesSource = !currentSource || (childSourceId === currentSource.id && (!currentSource.scope || childSourceScope === currentSource.scope));

          if (matchesEnv && matchesScope && matchesMem && matchesSource) {
            child.style.display = '';
            if (matchesKind && matchesQuery) {
              matchingChildrenCount++;
              if (childMem === 'managed') {
                visManaged++;
                if (childStatus === 'update-available' || childStatus === 'modified-and-update-available') visUpdates++;
                if (childStatus === 'modified-locally' || childStatus === 'modified-and-update-available') visModified++;
              } else {
                visUnmanaged++;
                if (childStatus === 'identical') visUnmanagedIdentical++;
              }
            }
          } else {
            child.style.display = 'none';
          }
        });

        if (matchesKind && matchesQuery && matchingChildrenCount > 0) {
          group.style.display = '';
        } else {
          group.style.display = 'none';
        }
      });
      
      const manStat = document.getElementById('stat-managed');
      if (manStat) manStat.textContent = visManaged;
      const overviewManStat = document.getElementById('overview-stat-managed');
      if (overviewManStat) overviewManStat.textContent = visManaged;
      
      const upStat = document.getElementById('stat-updates-available');
      if (upStat) upStat.textContent = visUpdates;
      const overviewUpStat = document.getElementById('overview-stat-updates');
      if (overviewUpStat) overviewUpStat.textContent = visUpdates;
      
      const modStat = document.getElementById('stat-modified-locally');
      if (modStat) modStat.textContent = visModified;
      const overviewModStat = document.getElementById('overview-stat-modified');
      if (overviewModStat) overviewModStat.textContent = visModified;
      
      const unmanStat = document.getElementById('stat-unmanaged');
      if (unmanStat) unmanStat.textContent = visUnmanaged;
      const overviewUnmanStat = document.getElementById('overview-stat-unmanaged');
      if (overviewUnmanStat) overviewUnmanStat.textContent = visUnmanaged;
      const unmanLbl = document.getElementById('stat-unmanaged-lbl');
      if (unmanLbl) unmanLbl.textContent = 'Unmanaged Discovered (' + visUnmanagedIdentical + ' identical, ' + (visUnmanaged - visUnmanagedIdentical) + ' custom)';

      const updateAllBtn = document.getElementById('updateAllBtn');
      if (updateAllBtn) {
        updateAllBtn.title = 'Update all (' + visUpdates + ')';
        updateAllBtn.disabled = visUpdates === 0;
      }
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.command === 'recommendationsData') {
        const recSection = document.getElementById('section-recommendations');
        if (recSection) recSection.innerHTML = msg.html;
        const pendingStat = document.getElementById('overview-stat-pending');
        if (pendingStat && msg.pendingCount !== undefined) pendingStat.textContent = msg.pendingCount;
      } else if (msg.command === 'inventoryData') {
        managedData = msg.managedData;
        observedData = msg.observedData;
        const rows = msg.rowsHtml;
        if (rows) {
          const tbody = document.getElementById('unifiedTable');
          if (tbody) {
            tbody.innerHTML = typeof rows === 'string' ? rows : '';
          }
        }
        const manStat = document.getElementById('stat-managed');
        if (manStat) manStat.textContent = msg.totalInstalled;
        const unmanStat = document.getElementById('stat-unmanaged');
        if (unmanStat) unmanStat.textContent = msg.totalUnmanaged;
        const unmanLbl = document.getElementById('stat-unmanaged-lbl');
        if (unmanLbl) unmanLbl.textContent = 'Unmanaged Discovered (' + msg.identicalCount + ' identical, ' + (msg.totalUnmanaged - msg.identicalCount) + ' custom)';
        
        // When phase A finishes, these are not computed yet so they might reset to 0 or previous values.
        // It's safer to not touch updatesAvailable/modifiedLocally in Phase A.
        // They will be updated in scanComplete.

        const overviewSourcesStat = document.getElementById('overview-stat-sources');
        if (overviewSourcesStat && msg.totalSources !== undefined) overviewSourcesStat.textContent = msg.totalSources;
        const overviewNeedsAttention = document.getElementById('overview-needs-attention');
        if (overviewNeedsAttention && msg.overviewNeedsAttentionHtml) {
          overviewNeedsAttention.innerHTML = msg.overviewNeedsAttentionHtml;
        }

        const envGroup = document.getElementById('filter-group-env');
        if (envGroup) {
          envGroup.innerHTML = '<span class="filter-group-label">ENV</span>' +
            '<button class="filter-pill env-pill ' + (currentEnv === 'all' ? 'active' : '') + '" data-env="all" aria-pressed="' + (currentEnv === 'all' ? 'true' : 'false') + '" onclick="setEnvFilter(\\'all\\')">All Env</button>\\n' + (msg.environmentPills || '');
          if (currentEnv !== 'all' && typeof envGroup.querySelector === 'function') {
            const pill = envGroup.querySelector('.env-pill[data-env="' + currentEnv + '"]');
            if (pill) {
              pill.classList.add('active');
              if (pill.setAttribute) pill.setAttribute('aria-pressed', 'true');
            }
          }
        }

        if (typeof msg.sourcesHtml === 'string') {
          const catalogSection = document.getElementById('section-catalog');
          if (catalogSection) catalogSection.innerHTML = msg.sourcesHtml;
        }

        let indicator = document.getElementById('scan-indicator');
        if (msg.scanning) {
          if (!indicator) {
            indicator = document.createElement('div');
            indicator.className = 'scan-indicator';
            indicator.id = 'scan-indicator';
            indicator.innerHTML = '<div class="spinner"></div>Scanning for updates…';
            const container = document.querySelector('.header-actions');
            if (container) container.insertBefore(indicator, container.firstChild);
          } else {
            indicator.style.display = 'flex';
          }
        } else {
          if (indicator) indicator.style.display = 'none';
        }
        
        filterTable();
      } else if (msg.command === 'driftResult') {
        const cell = document.querySelector('[data-drift-key="' + msg.key + '"]');
        if (cell) {
          const row = cell.closest('tr');
          if (row) row.setAttribute('data-status', msg.status);

          let badgeClass = 'badge-error';
          let badgeText = '● Managed · error';
          if (msg.status === 'up-to-date') { badgeClass = 'badge-success'; badgeText = '● Managed · up to date'; }
          else if (msg.status === 'update-available') { badgeClass = 'badge-info'; badgeText = '● Managed · update available'; }
          else if (msg.status === 'modified-locally' || msg.status === 'modified-and-update-available') { badgeClass = 'badge-warning'; badgeText = '● Managed · modified locally'; }
          else if (msg.status === 'missing-on-disk') { badgeClass = 'badge-error'; badgeText = '● Managed · missing on disk'; }
          else if (msg.status === 'checking' || msg.status === 'checking…') { badgeClass = 'badge-pending'; badgeText = '● Managed · checking…'; }
          
          cell.innerHTML = '<span class="badge ' + badgeClass + '">' + badgeText + '</span>';

          const diffBtn = row ? row.querySelector('.diff-btn') : null;
          if (diffBtn && (msg.status === 'modified-locally' || msg.status === 'modified-and-update-available')) {
            diffBtn.style.display = 'inline-block';
          }
          const updateBtn = row ? row.querySelector('.update-btn') : null;
          if (updateBtn && (msg.status === 'update-available' || msg.status === 'modified-and-update-available')) {
            updateBtn.style.display = 'inline-block';
          }

          const parentChip = document.querySelector('.parent-chip[data-parent-key="' + msg.key + '"]') || document.querySelector('.parent-badge[data-parent-key="' + msg.key + '"]');
          if (parentChip) {
            parentChip.className = 'badge ' + badgeClass + ' parent-chip parent-badge';
            const oldTitle = parentChip.getAttribute('title') || '';
            const parts = oldTitle.split(' · ');
            if (parts.length >= 2) {
              parentChip.setAttribute('title', parts[0] + ' · ' + parts[1] + ' · ' + msg.status);
            } else {
              parentChip.setAttribute('title', msg.status);
            }

            const groupBody = parentChip.closest('.matrix-group');
            if (groupBody) {
              const severities = {
                'missing-on-disk': 8,
                'modified-and-update-available': 7,
                'update-available': 6,
                'modified-locally': 5,
                'different': 4,
                'local-only': 3,
                'checking': 2,
                'checking…': 2,
                'identical': 1,
                'up-to-date': 0
              };

              let worstStatus = 'up-to-date';
              let maxSev = -1;
              groupBody.querySelectorAll('.sub-row').forEach(subRow => {
                const s = subRow.getAttribute('data-status') || 'checking…';
                const sev = severities[s] !== undefined ? severities[s] : -1;
                if (sev > maxSev) {
                  maxSev = sev;
                  worstStatus = s;
                }
              });

              groupBody.setAttribute('data-worst-status', worstStatus);

              const worstBadge = groupBody.querySelector('.worst-badge');
              if (worstBadge) {
                let wbClass = 'badge-pending';
                let wbText = worstStatus;
                if (worstStatus === 'up-to-date') { wbClass = 'badge-success'; wbText = 'Up to date'; }
                else if (worstStatus === 'update-available') { wbClass = 'badge-info'; wbText = 'Update available'; }
                else if (worstStatus === 'modified-locally') { wbClass = 'badge-warning'; wbText = 'Modified locally'; }
                else if (worstStatus === 'modified-and-update-available') { wbClass = 'badge-warning'; wbText = 'Modified & update available'; }
                else if (worstStatus === 'missing-on-disk') { wbClass = 'badge-error'; wbText = 'Missing on disk'; }
                else if (worstStatus === 'different') { wbClass = 'badge-warning'; wbText = 'Differs from source'; }
                else if (worstStatus === 'identical') { wbClass = 'badge-success'; wbText = 'Identical to source'; }
                else if (worstStatus === 'local-only') { wbClass = 'badge-unmanaged'; wbText = 'Local only'; }
                else if (worstStatus === 'checking' || worstStatus === 'checking…') { wbClass = 'badge-pending'; wbText = 'checking…'; }

                worstBadge.className = 'badge ' + wbClass + ' worst-badge';
                worstBadge.textContent = wbText;
              }
            }
          }

          filterTable();
        }
      } else if (msg.command === 'scanComplete') {
        const indicator = document.getElementById('scan-indicator');
        if (indicator) indicator.style.display = 'none';
        
        const overviewNeedsAttention = document.getElementById('overview-needs-attention');
        if (overviewNeedsAttention && msg.overviewNeedsAttentionHtml) {
          overviewNeedsAttention.innerHTML = msg.overviewNeedsAttentionHtml;
        }

        filterTable();
      } else if (msg.command === 'catalogData') {
        const catalogDiv = document.getElementById('catalog-' + escapeHtmlClient(msg.sourceId) + '-' + escapeHtmlClient(msg.scope));
        if (catalogDiv) {
          catalogDiv.innerHTML = msg.html;
          catalogDiv.setAttribute('data-loaded', 'true');
        }
      } else if (msg.command === 'itemDetail') {
        if (selectedItemKey && msg.key !== selectedItemKey) return;
        selectedItemKey = msg.key;
        detailItemData = msg.item;
        
        // 1. Header
        const kindEl = document.getElementById('detailKind');
        if (kindEl) {
          kindEl.textContent = (msg.item && msg.item.kind) || '';
          kindEl.className = (msg.item && msg.item.kind) ? 'kind-pill kind-' + msg.item.kind : 'kind-pill';
        }
        const titleEl = document.getElementById('detailTitle');
        if (titleEl) {
          titleEl.textContent = (msg.item && msg.item.name) || '';
        }
        const asstEl = document.getElementById('detailAssistant');
        if (asstEl) {
          const asstName = (msg.item && msg.item.assistant) || '';
          const iconImg = msg.assistantIconUri
            ? '<img src="' + escapeHtmlClient(msg.assistantIconUri) + '" class="assistant-icon" width="14" height="14" style="vertical-align: middle; margin-right: 4px;" />'
            : '';
          asstEl.innerHTML = iconImg + '<span>' + escapeHtmlClient(asstName) + '</span>';
        }
        const scopeEl = document.getElementById('detailScope');
        if (scopeEl && msg.item) {
          const scopeLabel = getScopeLabelClient(msg.item.scope);
          const scopeIcon = getScopeIconSvgClient(msg.item.scope);
          scopeEl.innerHTML = scopeIcon + '<span class="scope-label">' + escapeHtmlClient(scopeLabel) + '</span>';
        }

        // 2. Status line
        let badgeClass = 'badge-unmanaged';
        let badgeText = '◌ Unmanaged · local only';

        if (msg.membership === 'managed') {
          if (msg.status === 'up-to-date') {
            badgeClass = 'badge-success';
            badgeText = '● Managed · up to date';
          } else if (msg.status === 'update-available') {
            badgeClass = 'badge-info';
            badgeText = '● Managed · update available';
          } else if (msg.status === 'modified-locally') {
            badgeClass = 'badge-warning';
            badgeText = '● Managed · modified locally';
          } else if (msg.status === 'modified-and-update-available') {
            badgeClass = 'badge-warning';
            badgeText = '● Managed · modified locally & update available';
          } else if (msg.status === 'missing-on-disk') {
            badgeClass = 'badge-error';
            badgeText = '● Managed · missing on disk';
          } else {
            badgeClass = 'badge-error';
            badgeText = '● Managed · ' + msg.status;
          }
        } else {
          // unmanaged
          const match = (msg.item && msg.item.match) || (msg.candidates && msg.candidates[0]);
          if (match && match.status === 'identical') {
            badgeClass = 'badge-success';
            badgeText = '◌ Unmanaged · identical to ' + (match.sourceId || '');
          } else if (match && match.status === 'different') {
            badgeClass = 'badge-warning';
            badgeText = '◌ Unmanaged · differs from ' + (match.sourceId || '');
          } else {
            badgeClass = 'badge-unmanaged';
            badgeText = '◌ Unmanaged · local only';
          }
        }

        const statusEl = document.getElementById('detailStatus');
        if (statusEl) {
          statusEl.innerHTML = '<span class="badge ' + badgeClass + '">' + escapeHtmlClient(badgeText) + '</span>';
        }

        // 3. Origin
        const originText = msg.origin || computeItemOriginClient(msg.membership, msg.item, msg.candidates);
        const originEl = document.getElementById('detailOrigin');
        if (originEl) {
          originEl.textContent = originText;
        }

        // 4. Location
        const locEl = document.getElementById('detailLocation');
        if (locEl) {
          const itemPath = (msg.item && msg.item.path) || '';
          locEl.textContent = itemPath;
          locEl.title = itemPath ? 'Click to preview ' + itemPath : '';
          locEl.onclick = function(e) {
            if (e && e.preventDefault) e.preventDefault();
            detailPreviewItem();
            return false;
          };
        }

        // 6. Cross-framework list
        const cfList = document.getElementById('crossFrameworkList');
        if (msg.crossFramework && msg.crossFramework.length > 0) {
          cfList.innerHTML = msg.crossFramework.map(function(cf) {
            const scopeLabel = getScopeLabelClient(cf.scope);
            if (cf.strategy === 'name-fallback') {
              return '<li class="cross-framework-item fallback" title="Probable match based on name only">? ' + escapeHtmlClient(cf.assistant) + ' (' + escapeHtmlClient(scopeLabel) + ')</li>';
            }
            return '<li class="cross-framework-item">✓ ' + escapeHtmlClient(cf.assistant) + ' (' + escapeHtmlClient(scopeLabel) + ')</li>';
          }).join('');
          document.getElementById('crossFrameworkSection').style.display = 'block';
        } else {
          document.getElementById('crossFrameworkSection').style.display = 'none';
        }

        // 5. One Action Bar
        const primaryActions = [];
        const secondaryActions = [];
        const destructiveActions = [];

        if (msg.membership === 'unmanaged') {
          if (msg.candidates && msg.candidates.length > 0) {
            primaryActions.push('<button class="btn btn-sm btn-primary" title="Promote" onclick="detailPromoteItem()"><span class="btn-icon">⇧</span> Promote</button>');
          }
          secondaryActions.push('<button class="btn btn-sm btn-secondary" title="Preview" onclick="detailPreviewItem()"><span class="btn-icon">👁</span> Preview</button>');
          if (msg.diffAvailable) {
            secondaryActions.push('<button class="btn btn-sm btn-secondary" title="Diff vs. original" onclick="detailDiffItem()"><span class="btn-icon">⇄</span> Diff</button>');
          }
        } else {
          // managed
          if (msg.status === 'update-available' || msg.status === 'modified-and-update-available') {
            primaryActions.push('<button class="btn btn-sm btn-primary" title="Update to latest" onclick="detailUpdateItem()"><span class="btn-icon">⟳</span> Update</button>');
          }
          secondaryActions.push('<button class="btn btn-sm btn-secondary" title="Preview" onclick="detailPreviewItem()"><span class="btn-icon">👁</span> Preview</button>');
          if (msg.diffAvailable) {
            secondaryActions.push('<button class="btn btn-sm btn-secondary" title="Diff vs. original" onclick="detailDiffItem()"><span class="btn-icon">⇄</span> Diff</button>');
          }
          secondaryActions.push('<button class="btn btn-sm btn-secondary" title="Copy to..." onclick="detailCopyItem()"><span class="btn-icon">⧉</span> Copy</button>');
          if (msg.item && ['skill', 'agent', 'command', 'mcp-server'].includes(msg.item.kind)) {
            secondaryActions.push('<button class="btn btn-sm btn-secondary" title="Move to..." onclick="detailMoveItem()"><span class="btn-icon">⇥</span> Move</button>');
          }
          secondaryActions.push('<button class="btn btn-sm btn-secondary" title="Edit" onclick="detailEditItem()"><span class="btn-icon">✎</span> Edit</button>');
          destructiveActions.push('<button class="btn btn-sm btn-secondary btn-destructive" title="Uninstall" onclick="detailUninstallItem()"><span class="btn-icon">🗑</span> Uninstall</button>');
        }

        const groups = [];
        if (primaryActions.length > 0) {
          groups.push('<div class="action-group action-group-primary">' + primaryActions.join('') + '</div>');
        }
        if (secondaryActions.length > 0) {
          groups.push('<div class="action-group action-group-secondary">' + secondaryActions.join('') + '</div>');
        }
        if (destructiveActions.length > 0) {
          groups.push('<div class="action-group action-group-destructive">' + destructiveActions.join('') + '</div>');
        }
        document.getElementById('detailActions').innerHTML = groups.join('');
      } else if (msg.command === 'clearDetail') {
        document.getElementById('detailPanel').style.display = 'none';
        selectedItemKey = null;
        detailItemData = null;
      }
    });
  </script>
</body>
</html>`;
  }
}
