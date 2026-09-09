import * as vscode from 'vscode';
import type { ManagedInstallation, ObservedArtifact, Source, AssistantId, Scope } from '../domain/types';
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
import { handleInstallRecommended, installResolvedArtifacts, unrecommendArtifactForWorkspace } from './recommendations';

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
              const allManaged: ManagedInstallation[] = [];
              try {
                const gInv = await scanInstalledInventory('global');
                allManaged.push(...gInv.managed);
              } catch { /* ignore */ }
              const folders = vscode.workspace.workspaceFolders;
              if (folders && folders.length > 0) {
                const projectRoot = folders[0].uri.fsPath;
                try {
                  const pInv = await scanInstalledInventory('project', projectRoot);
                  allManaged.push(...pInv.managed);
                } catch { /* ignore */ }
              }
              const inst = allManaged.find(m => getIdentityKey(m) === message.key);
              if (inst) {
                await this._provider.doUninstallItem(inst);
                this._refreshCallback();
                await this.update();
                this._panel.webview.postMessage({ command: 'clearDetail' });
              }
            }
            break;
          }
          case 'updateItem': {
            if (message.key) {
              const allManaged: ManagedInstallation[] = [];
              try {
                const gInv = await scanInstalledInventory('global');
                allManaged.push(...gInv.managed);
              } catch { /* ignore */ }
              const folders = vscode.workspace.workspaceFolders;
              if (folders && folders.length > 0) {
                const projectRoot = folders[0].uri.fsPath;
                try {
                  const pInv = await scanInstalledInventory('project', projectRoot);
                  allManaged.push(...pInv.managed);
                } catch { /* ignore */ }
              }
              const inst = allManaged.find(m => getIdentityKey(m) === message.key);
              if (inst) {
                await this._provider.doUpdateInstallation(inst);
                this._refreshCallback();
                await this.update();
              }
            }
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

      const crossFramework = findRelatedInstallations(inst, allManaged).map(r => ({
        assistant: r.installation.assistant,
        scope: r.installation.scope,
        strategy: r.strategy
      }));

      const origin = inst.sourceId ? `${inst.sourceId}${inst.sourceRevision?.commit ? '@' + inst.sourceRevision.commit : ''}` : 'local, no known origin';

      this._panel.webview.postMessage({
        command: 'itemDetail',
        key,
        origin,
        diffAvailable,
        crossFramework,
        candidates: [],
        item: inst,
        membership: 'managed',
        status: report ? report.status : 'up-to-date'
      });
      return;
    }

    const obs = allObserved.find(o => getIdentityKey(o) === key);
    if (obs) {
      this._panel.webview.postMessage({
        command: 'itemDetail',
        key,
        origin: 'local, no known origin',
        diffAvailable: obs.match?.status === 'different',
        crossFramework: [],
        candidates: obs.candidates ?? [],
        item: obs,
        membership: 'unmanaged'
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
        return `<button class="filter-pill env-pill" data-env="${this.escapeHtml(a)}" onclick="setEnvFilter('${this.escapeHtml(a)}')">
          <img src="${iconSrc}" class="assistant-icon" width="14" height="14" />
          ${this.escapeHtml(a)}
        </button>`;
      }).join('\n');

      let rowsHtml = '';
      allManaged.forEach((inst, idx) => {
        const key = getIdentityKey(inst);
        const matchingSource = allSources.find((s) => s.id === inst.sourceId);
        const sourceScope = matchingSource?.scope || '';
        const sourceId = inst.sourceId || '';
        const status = 'checking…';
        const badgeClass = 'badge-pending';
        const badgeText = '● Managed · checking…';
        rowsHtml += `
          <tr class="item-row" data-kind="${this.escapeHtml(inst.kind)}" data-name="${this.escapeHtml(inst.name.toLowerCase())}" data-assistant="${this.escapeHtml(inst.assistant)}" data-scope="${this.escapeHtml(inst.scope)}" data-membership="managed" data-status="${this.escapeHtml(status)}" data-source-id="${this.escapeHtml(sourceId)}" data-source-scope="${this.escapeHtml(sourceScope)}" data-key="${this.escapeHtml(key)}" onclick="selectRow(this, '${this.escapeHtml(key)}')">
            <td><span class="kind-pill kind-${this.escapeHtml(inst.kind)}">${this.escapeHtml(inst.kind)}</span></td>
            <td><strong>${this.escapeHtml(inst.name)}</strong></td>
            <td>${this.escapeHtml(inst.assistant)}</td>
            <td><span class="scope-pill scope-${this.escapeHtml(inst.scope)}">${this.escapeHtml(inst.scope)}</span></td>
            <td data-drift-key="${this.escapeHtml(key)}"><span class="badge ${badgeClass}">${this.escapeHtml(badgeText)}</span></td>
            <td>
              <button class="btn btn-sm btn-secondary" onclick="editItem(${idx})">Edit</button>
            </td>
          </tr>
        `;
      });

      allObserved.forEach((obs, idx) => {
        const sourceId = obs.match?.sourceId || '';
        const matchingSource = allSources.find((s) => s.id === sourceId);
        const sourceScope = matchingSource?.scope || '';
        let badgeClass = 'badge-unmanaged';
        let badgeText = '◌ Unmanaged · local only';
        let tooltip = '';
        if (obs.match?.status === 'identical') {
          badgeClass = 'badge-success';
          badgeText = `◌ Unmanaged · identical to ${obs.match.sourceId}`;
          tooltip = ` title="${this.escapeHtml(obs.match.details || '')}"`;
        } else if (obs.match?.status === 'different') {
          badgeClass = 'badge-warning';
          badgeText = `◌ Unmanaged · differs from ${obs.match.sourceId}`;
          tooltip = ` title="${this.escapeHtml(obs.match.details || '')}"`;
        }
        let actionBtn = '';
        if ((obs.candidates?.length ?? 0) > 0) {
          actionBtn = `<button class="btn btn-sm btn-primary" onclick="promoteItem(${idx})">Promote</button>`;
        }
        const key = getIdentityKey(obs);
        rowsHtml += `
          <tr class="item-row" data-kind="${this.escapeHtml(obs.kind)}" data-name="${this.escapeHtml(obs.name.toLowerCase())}" data-assistant="${this.escapeHtml(obs.assistant)}" data-scope="${this.escapeHtml(obs.scope)}" data-membership="unmanaged" data-status="unmanaged" data-source-id="${this.escapeHtml(sourceId)}" data-source-scope="${this.escapeHtml(sourceScope)}" data-key="${this.escapeHtml(key)}" onclick="selectRow(this, '${this.escapeHtml(key)}')">
            <td><span class="kind-pill kind-${this.escapeHtml(obs.kind)}">${this.escapeHtml(obs.kind)}</span></td>
            <td><strong>${this.escapeHtml(obs.name)}</strong></td>
            <td>${this.escapeHtml(obs.assistant)}</td>
            <td><span class="scope-pill scope-${this.escapeHtml(obs.scope)}">${this.escapeHtml(obs.scope)}</span></td>
            <td><span class="badge ${badgeClass}"${tooltip}>${this.escapeHtml(badgeText)}</span></td>
            <td>
              ${actionBtn}
            </td>
          </tr>
        `;
      });
      if (!rowsHtml) {
        rowsHtml = '<tr><td colspan="6" style="text-align:center; opacity:0.6;">No items found.</td></tr>';
      }

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
        <tr class="overview-item-row" style="cursor: pointer;" onclick="switchSection('installed'); const row = document.querySelector('#section-installed .item-row[data-key=\\'${this.escapeHtml(x.key)}\\']'); if (row) selectRow(row, '${this.escapeHtml(x.key)}');" onmouseover="this.style.backgroundColor='rgba(255, 255, 255, 0.05)'" onmouseout="this.style.backgroundColor=''">
          <td><span class="kind-pill kind-${this.escapeHtml(x.inst.kind)}">${this.escapeHtml(x.inst.kind)}</span></td>
          <td><strong>${this.escapeHtml(x.inst.name)}</strong></td>
          <td>${this.escapeHtml(x.inst.assistant)}</td>
          <td><span class="scope-pill scope-${this.escapeHtml(x.inst.scope)}">${this.escapeHtml(x.inst.scope)}</span></td>
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
        <div class="stat-chip stat-info">
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
                <button class="btn btn-sm btn-primary" onclick="vscode.postMessage({ command: 'installFolder', sourceId: '${this.escapeHtml(item.source.id)}', scope: '${this.escapeHtml(item.source.scope)}', folderPath: '${this.escapeHtml(item.folderPath)}' })">Install</button>
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
              <button class="btn btn-sm btn-secondary" onclick="vscode.postMessage({ command: 'previewArtifact', sourceId: '${this.escapeHtml(item.source.id)}', scope: '${this.escapeHtml(item.source.scope)}', artifactId: '${this.escapeHtml(item.artifact.id)}' })">Preview</button>
              <button class="btn btn-sm btn-primary" onclick="vscode.postMessage({ command: 'installArtifact', sourceId: '${this.escapeHtml(item.source.id)}', scope: '${this.escapeHtml(item.source.scope)}', artifactId: '${this.escapeHtml(item.artifact.id)}' })">Install</button>
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
        <button class="btn btn-primary" onclick="vscode.postMessage({ command: 'addSource' })">+ Add Source</button>
        <button class="btn btn-secondary" onclick="vscode.postMessage({ command: 'importConfig' })">Import</button>
        <button class="btn btn-secondary" onclick="vscode.postMessage({ command: 'exportConfig' })">Export All</button>
        <button class="btn btn-secondary" onclick="vscode.postMessage({ command: 'refreshCatalog' })">Refresh Catalog</button>
      </div>
    `;

    const renderSourceRow = (s: Source) => `
      <div class="source-container">
        <div class="item-row source-row" style="display: grid; grid-template-columns: 100px 180px 1fr auto 180px; align-items: center; gap: 10px; padding: 8px 10px; border-bottom: 1px solid var(--border); cursor: pointer;" onclick="toggleSource(this, '${this.escapeHtml(s.id)}', '${this.escapeHtml(s.scope)}')">
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
            <button class="btn btn-sm btn-primary" onclick="vscode.postMessage({ command: 'installSourceGroup', sourceId: '${this.escapeHtml(s.id)}', scope: '${this.escapeHtml(s.scope)}' })">Install</button>
            <button class="btn btn-sm btn-secondary" onclick="vscode.postMessage({ command: 'exportSource', sourceId: '${this.escapeHtml(s.id)}', scope: '${this.escapeHtml(s.scope)}' })">Export</button>
            <button class="btn btn-sm btn-secondary" style="color: var(--badge-error); border-color: rgba(207, 34, 46, 0.3);" onclick="vscode.postMessage({ command: 'removeSource', sourceId: '${this.escapeHtml(s.id)}', scope: '${this.escapeHtml(s.scope)}' })">Remove</button>
          </div>
        </div>
        <div class="source-catalog" id="catalog-${this.escapeHtml(s.id)}-${this.escapeHtml(s.scope)}" style="display: none; padding: 8px 10px 8px 30px; background: rgba(0,0,0,0.1); border-bottom: 1px solid var(--border);">
        </div>
      </div>
    `;

    html += `<div class="scope-group">
      <div class="scope-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 8px; margin-bottom: 8px;">
        <h3 style="margin: 0; font-size: 13px;">Global Sources</h3>
        <button class="btn btn-sm btn-secondary" onclick="vscode.postMessage({ command: 'addSource', scope: 'global' })">+ Add</button>
      </div>
      <div class="source-list">
        ${globalSources.length > 0 ? globalSources.map(renderSourceRow).join('') : '<div class="empty-state" style="padding: 20px;">No global sources</div>'}
      </div>
    </div>`;

    html += `<div class="scope-group" style="margin-top: 24px;">
      <div class="scope-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 8px; margin-bottom: 8px;">
        <h3 style="margin: 0; font-size: 13px;">Project Sources</h3>
        <button class="btn btn-sm btn-secondary" onclick="vscode.postMessage({ command: 'addSource', scope: 'project' })">+ Add</button>
      </div>
      <div class="source-list">
        ${projectSources.length > 0 ? projectSources.map(renderSourceRow).join('') : '<div class="empty-state" style="padding: 20px;">No project sources</div>'}
      </div>
    </div>`;

    return html;
  }

  private getRecommendationsHtml(pending: any[] = [], broken: any[] = []): string {
    let html = `
      <div class="toolbar" style="margin-bottom: 16px;">
        <button class="btn btn-primary" onclick="vscode.postMessage({ command: 'installRecommended' })">Install All Actionable</button>
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
              <button class="btn btn-sm btn-primary" onclick="vscode.postMessage({ command: 'installRecommendation', sourceId: '${this.escapeHtml(p.source.id)}', scope: '${this.escapeHtml(p.source.scope)}', artifactId: '${this.escapeHtml(p.artifact.id)}', assistant: '${this.escapeHtml(p.desired.assistant)}' })">Install</button>
              <button class="btn btn-sm btn-secondary" style="color: var(--badge-error); border-color: rgba(207, 34, 46, 0.3);" onclick="vscode.postMessage({ command: 'unrecommendRecommendation', sourceId: '${this.escapeHtml(p.desired.sourceId)}', artifactId: '${this.escapeHtml(p.desired.artifactId)}', assistant: '${this.escapeHtml(p.desired.assistant)}' })">Unrecommend</button>
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
              <button class="btn btn-sm btn-secondary" style="color: var(--badge-error); border-color: rgba(207, 34, 46, 0.3);" onclick="vscode.postMessage({ command: 'unrecommendRecommendation', sourceId: '${this.escapeHtml(b.desired.sourceId)}', artifactId: '${this.escapeHtml(b.desired.artifactId)}', assistant: '${this.escapeHtml(b.desired.assistant)}' })">Unrecommend</button>
            </div>
          </div>
        `;
      }
      html += `</div></div>`;
    }

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
    <div class="stat-chip stat-info">
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
    <div class="filter-group">
      <button class="filter-pill env-pill active" data-env="all" onclick="setEnvFilter('all')">All Env</button>
      ${environmentPills}
    </div>
    <div class="filter-group">
      <select class="filter-select" id="scopeFilter" onchange="setScopeFilter(this.value)">
        <option value="all">Scope: All</option>
        <option value="global">Scope: Global</option>
        <option value="project">Scope: Project</option>
      </select>
    </div>
    <div class="filter-group">
      <select class="filter-select" id="membershipFilter" onchange="setMembershipFilter(this.value)">
        <option value="all">Membership: All</option>
        <option value="managed">Membership: Managed</option>
        <option value="unmanaged">Membership: Unmanaged</option>
      </select>
    </div>
    <div class="filter-group" style="flex: 1;">
      <input type="text" class="search-input" id="searchBox" placeholder="Filter by name..." oninput="filterTable()">
    </div>
  </div>
  
  <div class="toolbar">
    <div class="tabs">
      <button class="tab-btn active" onclick="setKindFilter('all', this)">All Kinds</button>
      <button class="tab-btn" onclick="setKindFilter('skill', this)">Skills</button>
      <button class="tab-btn" onclick="setKindFilter('agent', this)">Agents</button>
      <button class="tab-btn" onclick="setKindFilter('command', this)">Commands</button>
      <button class="tab-btn" onclick="setKindFilter('mcp-server', this)">MCPs</button>
      <button class="tab-btn" onclick="setKindFilter('hook', this)">Hooks</button>
      <button class="tab-btn" onclick="setKindFilter('rule', this)">Rules</button>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Kind</th>
        <th>Name</th>
        <th>Assistant</th>
        <th>Scope</th>
        <th>Drift / Status</th>
        <th>Action</th>
      </tr>
    </thead>
    <tbody id="unifiedTable">
      ${rowsHtml}
    </tbody>
  </table>

  <div id="detailPanel">
    <h3 id="detailTitle">Item Details</h3>
    <div class="detail-section">
      <div class="detail-section-title">Origin</div>
      <div id="detailOrigin"></div>
    </div>
    <div class="detail-section" id="diffSection" style="display: none;">
      <button class="btn btn-sm btn-secondary" onclick="diffItem()">Diff vs. original</button>
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
      return `<button class="filter-pill env-pill" data-env="${this.escapeHtml(a)}" onclick="setEnvFilter('${this.escapeHtml(a)}')">
        <img src="${iconSrc}" class="assistant-icon" width="14" height="14" />
        ${this.escapeHtml(a)}
      </button>`;
    }).join('\n');

    let rowsHtml = '';
    
    managed.forEach((inst, idx) => {
      const key = getIdentityKey(inst);
      const matchingSource = sources.find((s) => s.id === inst.sourceId);
      const sourceScope = matchingSource?.scope || '';
      const sourceId = inst.sourceId || '';
      const report = reportMap.get(key);
      const isPending = scanning && !report;
      const status = report?.status ?? (scanning ? 'checking…' : 'up-to-date');
      let badgeClass = 'badge-pending';
      let badgeText = '● Managed · checking…';
      
      if (!isPending) {
        if (status === 'up-to-date') { badgeClass = 'badge-success'; badgeText = '● Managed · up to date'; }
        else if (status === 'update-available') { badgeClass = 'badge-info'; badgeText = '● Managed · update available'; }
        else if (status === 'modified-locally' || status === 'modified-and-update-available') { badgeClass = 'badge-warning'; badgeText = '● Managed · modified locally'; }
        else { badgeClass = 'badge-error'; badgeText = `● Managed · ${status}`; }
      }

      rowsHtml += `
        <tr class="item-row" data-kind="${this.escapeHtml(inst.kind)}" data-name="${this.escapeHtml(inst.name.toLowerCase())}" data-assistant="${this.escapeHtml(inst.assistant)}" data-scope="${this.escapeHtml(inst.scope)}" data-membership="managed" data-status="${this.escapeHtml(status)}" data-source-id="${this.escapeHtml(sourceId)}" data-source-scope="${this.escapeHtml(sourceScope)}" data-key="${this.escapeHtml(key)}" onclick="selectRow(this, '${this.escapeHtml(key)}')">
          <td><span class="kind-pill kind-${this.escapeHtml(inst.kind)}">${this.escapeHtml(inst.kind)}</span></td>
          <td><strong>${this.escapeHtml(inst.name)}</strong></td>
          <td>${this.escapeHtml(inst.assistant)}</td>
          <td><span class="scope-pill scope-${this.escapeHtml(inst.scope)}">${this.escapeHtml(inst.scope)}</span></td>
          <td data-drift-key="${this.escapeHtml(key)}"><span class="badge ${badgeClass}">${this.escapeHtml(badgeText)}</span></td>
          <td>
            <button class="btn btn-sm btn-secondary" onclick="editItem(${idx})">Edit</button>
          </td>
        </tr>
      `;
    });

    observed.forEach((obs, idx) => {
      const sourceId = obs.match?.sourceId || '';
      const matchingSource = sources.find((s) => s.id === sourceId);
      const sourceScope = matchingSource?.scope || '';
      let badgeClass = 'badge-unmanaged';
      let badgeText = '◌ Unmanaged · local only';
      let tooltip = '';
      
      if (obs.match?.status === 'identical') {
        badgeClass = 'badge-success';
        badgeText = `◌ Unmanaged · identical to ${obs.match.sourceId}`;
        tooltip = ` title="${this.escapeHtml(obs.match.details || '')}"`;
      } else if (obs.match?.status === 'different') {
        badgeClass = 'badge-warning';
        badgeText = `◌ Unmanaged · differs from ${obs.match.sourceId}`;
        tooltip = ` title="${this.escapeHtml(obs.match.details || '')}"`;
      }

      let actionBtn = '';
      if ((obs.candidates?.length ?? 0) > 0) {
        actionBtn = `<button class="btn btn-sm btn-primary" onclick="promoteItem(${idx})">Promote</button>`;
      }

      const key = getIdentityKey(obs);
      rowsHtml += `
        <tr class="item-row" data-kind="${this.escapeHtml(obs.kind)}" data-name="${this.escapeHtml(obs.name.toLowerCase())}" data-assistant="${this.escapeHtml(obs.assistant)}" data-scope="${this.escapeHtml(obs.scope)}" data-membership="unmanaged" data-status="unmanaged" data-source-id="${this.escapeHtml(sourceId)}" data-source-scope="${this.escapeHtml(sourceScope)}" data-key="${this.escapeHtml(key)}" onclick="selectRow(this, '${this.escapeHtml(key)}')">
          <td><span class="kind-pill kind-${this.escapeHtml(obs.kind)}">${this.escapeHtml(obs.kind)}</span></td>
          <td><strong>${this.escapeHtml(obs.name)}</strong></td>
          <td>${this.escapeHtml(obs.assistant)}</td>
          <td><span class="scope-pill scope-${this.escapeHtml(obs.scope)}">${this.escapeHtml(obs.scope)}</span></td>
          <td><span class="badge ${badgeClass}"${tooltip}>${this.escapeHtml(badgeText)}</span></td>
          <td>
            ${actionBtn}
          </td>
        </tr>
      `;
    });

    if (!rowsHtml) {
      rowsHtml = '<tr><td colspan="6" style="text-align:center; opacity:0.6;">No items found.</td></tr>';
    }

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
    .filters-bar { flex-wrap: wrap; }
    .filter-group { display: flex; align-items: center; gap: 6px; }
    .filter-select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border); padding: 4px; font-size: 11px; border-radius: 4px; outline: none; }
    .filter-pill { background: transparent; border: 1px solid var(--border); color: var(--fg); padding: 4px 8px; border-radius: 12px; cursor: pointer; font-size: 11px; display: inline-flex; align-items: center; gap: 4px; }
    .filter-pill.active { background: var(--btn-bg); color: var(--btn-fg); border-color: var(--btn-bg); }
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
    }
    .btn-sm {
      padding: 3px 8px;
      font-size: 11px;
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
    #detailPanel h3 {
      margin: 0 0 12px 0;
      font-size: 14px;
      font-weight: 600;
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
      gap: 8px;
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid var(--border);
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
      <button class="btn btn-primary" onclick="vscode.postMessage({ command: 'createArtifact' })">+ New Artifact</button>
      <button class="btn btn-secondary" onclick="refreshState()">Refresh</button>
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
      const caret = rowEl.querySelector('.folder-icon');
      if (!folderDiv) return;
      if (folderDiv.style.display === 'none') {
        folderDiv.style.display = 'block';
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

    function selectRow(rowEl, key) {
      document.querySelectorAll('.item-row').forEach(r => r.classList.remove('selected'));
      rowEl.classList.add('selected');
      selectedItemKey = key;
      document.getElementById('detailPanel').style.display = 'block';
      document.getElementById('detailOrigin').innerHTML = '<div class="spinner"></div> Loading...';
      document.getElementById('diffSection').style.display = 'none';
      document.getElementById('crossFrameworkSection').style.display = 'none';
      document.getElementById('detailActions').innerHTML = '';
      document.getElementById('detailTitle').textContent = rowEl.getAttribute('data-name') + ' (' + rowEl.getAttribute('data-kind') + ')';
      
      vscode.postMessage({ command: 'requestDetail', key: key });
    }

    function diffItem() {
      if (detailItemData) {
        vscode.postMessage({ command: 'diffItem', item: detailItemData });
      }
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

    function refreshState() {
      vscode.postMessage({ command: 'refresh' });
    }

    function editItem(index) {
      const item = managedData[index];
      vscode.postMessage({ command: 'edit', installation: item });
    }

    function promoteItem(index) {
      const item = observedData[index];
      vscode.postMessage({ command: 'promote', observed: item });
    }

    function promoteAllIdentical() {
      vscode.postMessage({ command: 'promoteAllIdentical', items: observedData });
    }

    function setEnvFilter(env) {
      currentEnv = env;
      document.querySelectorAll('.env-pill').forEach(b => {
        if (b.getAttribute('data-env') === env) b.classList.add('active');
        else b.classList.remove('active');
      });
      filterTable();
    }

    function setScopeFilter(scope) {
      currentScope = scope;
      document.getElementById('scopeFilter').value = scope;
      filterTable();
    }

    function setMembershipFilter(mem) {
      currentMembership = mem;
      document.getElementById('membershipFilter').value = mem;
      filterTable();
    }

    function setKindFilter(kind, btn) {
      currentKind = kind;
      if (btn) {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      } else {
        document.querySelectorAll('.tab-btn').forEach(b => {
          if (b.innerText.toLowerCase().includes(kind) || (kind === 'all' && b.innerText === 'All Kinds')) b.classList.add('active');
          else b.classList.remove('active');
        });
      }
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
      if (currentSource) chips.push(\`<span class="chip">\${escapeHtmlClient(currentSource.id)} (\${escapeHtmlClient(currentSource.scope)}) <span class="chip-close" onclick="removeChip('source')">✕</span></span>\`);
      if (currentEnv !== 'all') chips.push(\`<span class="chip">\${currentEnv} <span class="chip-close" onclick="removeChip('env')">✕</span></span>\`);
      if (currentScope !== 'all') chips.push(\`<span class="chip">\${currentScope} <span class="chip-close" onclick="removeChip('scope')">✕</span></span>\`);
      if (currentMembership !== 'all') chips.push(\`<span class="chip">\${currentMembership} <span class="chip-close" onclick="removeChip('membership')">✕</span></span>\`);
      if (currentKind !== 'all') chips.push(\`<span class="chip">\${currentKind} <span class="chip-close" onclick="removeChip('kind')">✕</span></span>\`);
      
      if (chips.length > 0) {
        chipsContainer.innerHTML = chips.join(' · ');
        document.getElementById('breadcrumb').style.display = 'flex';
      } else {
        chipsContainer.innerHTML = '';
        document.getElementById('breadcrumb').style.display = 'none';
      }
    }

    function filterTable() {
      updateBreadcrumb();
      const q = document.getElementById('searchBox').value.toLowerCase();
      
      let visManaged = 0;
      let visUpdates = 0;
      let visModified = 0;
      let visUnmanaged = 0;
      let visUnmanagedIdentical = 0;

      document.querySelectorAll('.item-row').forEach(row => {
        const kind = row.getAttribute('data-kind');
        const name = row.getAttribute('data-name');
        const env = row.getAttribute('data-assistant');
        const scope = row.getAttribute('data-scope');
        const mem = row.getAttribute('data-membership');
        const text = row.innerText.toLowerCase();
        const rowSourceId = row.getAttribute('data-source-id');
        const rowSourceScope = row.getAttribute('data-source-scope');

        const matchesKind = currentKind === 'all' || kind === currentKind;
        const matchesEnv = currentEnv === 'all' || env === currentEnv;
        const matchesScope = currentScope === 'all' || scope === currentScope;
        const matchesMem = currentMembership === 'all' || mem === currentMembership;
        const matchesQuery = !q || text.includes(q) || name.includes(q);
        const matchesSource = !currentSource || (rowSourceId === currentSource.id && rowSourceScope === currentSource.scope);

        if (matchesKind && matchesEnv && matchesScope && matchesMem && matchesQuery && matchesSource) {
          row.style.display = '';
          if (mem === 'managed') {
            visManaged++;
            const status = row.getAttribute('data-status');
            if (status === 'update-available' || status === 'modified-and-update-available') visUpdates++;
            if (status === 'modified-locally' || status === 'modified-and-update-available') visModified++;
          } else {
            visUnmanaged++;
            if (text.includes('identical to')) visUnmanagedIdentical++;
          }
        } else {
          row.style.display = 'none';
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
      if (unmanLbl) unmanLbl.textContent = \`Unmanaged Discovered (\${visUnmanagedIdentical} identical, \${visUnmanaged - visUnmanagedIdentical} custom)\`;
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
        const tbody = document.getElementById('unifiedTable');
        if (tbody) tbody.innerHTML = msg.rowsHtml;
        const manStat = document.getElementById('stat-managed');
        if (manStat) manStat.textContent = msg.totalInstalled;
        const unmanStat = document.getElementById('stat-unmanaged');
        if (unmanStat) unmanStat.textContent = msg.totalUnmanaged;
        const unmanLbl = document.getElementById('stat-unmanaged-lbl');
        if (unmanLbl) unmanLbl.textContent = \`Unmanaged Discovered (\${msg.identicalCount} identical, \${msg.totalUnmanaged - msg.identicalCount} custom)\`;
        
        // When phase A finishes, these are not computed yet so they might reset to 0 or previous values.
        // It's safer to not touch updatesAvailable/modifiedLocally in Phase A.
        // They will be updated in scanComplete.

        const overviewSourcesStat = document.getElementById('overview-stat-sources');
        if (overviewSourcesStat && msg.totalSources !== undefined) overviewSourcesStat.textContent = msg.totalSources;
        const overviewNeedsAttention = document.getElementById('overview-needs-attention');
        if (overviewNeedsAttention && msg.overviewNeedsAttentionHtml) {
          overviewNeedsAttention.innerHTML = msg.overviewNeedsAttentionHtml;
        }

        const filterGroup = document.querySelector('.filters-bar .filter-group');
        if (filterGroup) {
          filterGroup.innerHTML = \`<button class="filter-pill env-pill \${currentEnv === 'all' ? 'active' : ''}" data-env="all" onclick="setEnvFilter('all')">All Env</button>\\n\` + msg.environmentPills;
          if (currentEnv !== 'all') {
            const pill = filterGroup.querySelector('.env-pill[data-env="' + currentEnv + '"]');
            if (pill) pill.classList.add('active');
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
          
          cell.innerHTML = '<span class="badge ' + badgeClass + '">' + badgeText + '</span>';
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
        if (msg.key !== selectedItemKey) return;
        
        detailItemData = msg.item;
        document.getElementById('detailOrigin').textContent = msg.origin;
        
        if (msg.diffAvailable) {
          document.getElementById('diffSection').style.display = 'block';
        } else {
          document.getElementById('diffSection').style.display = 'none';
        }
        
        const cfList = document.getElementById('crossFrameworkList');
        if (msg.crossFramework && msg.crossFramework.length > 0) {
          cfList.innerHTML = msg.crossFramework.map(cf => {
            if (cf.strategy === 'name-fallback') {
              return '<li class="cross-framework-item fallback" title="Probable match based on name only">? ' + escapeHtmlClient(cf.assistant) + ' (' + escapeHtmlClient(cf.scope) + ')</li>';
            }
            return '<li class="cross-framework-item">✓ ' + escapeHtmlClient(cf.assistant) + ' (' + escapeHtmlClient(cf.scope) + ')</li>';
          }).join('');
          document.getElementById('crossFrameworkSection').style.display = 'block';
        } else {
          document.getElementById('crossFrameworkSection').style.display = 'none';
        }

        const actions = [];
        if (msg.membership === 'unmanaged') {
          if (msg.candidates && msg.candidates.length > 0) {
            actions.push('<button class="btn btn-sm btn-primary" onclick="detailPromoteItem()">Promote</button>');
          }
        } else {
          actions.push('<button class="btn btn-sm btn-secondary" onclick="detailCopyItem()">Copy to...</button>');
          if (['skill', 'agent', 'command', 'mcp-server'].includes(msg.item.kind)) {
            actions.push('<button class="btn btn-sm btn-secondary" onclick="detailMoveItem()">Move to...</button>');
          }
          actions.push('<button class="btn btn-sm btn-secondary" onclick="detailEditItem()">Edit</button>');
          if (msg.status === 'update-available' || msg.status === 'modified-and-update-available') {
            actions.push('<button class="btn btn-sm btn-primary" onclick="detailUpdateItem()">Update to latest</button>');
          }
          actions.push('<button class="btn btn-sm btn-secondary" style="color: var(--badge-error); border-color: rgba(207, 34, 46, 0.3);" onclick="detailUninstallItem()">Uninstall</button>');
        }
        document.getElementById('detailActions').innerHTML = actions.join('');
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
