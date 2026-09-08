import * as vscode from 'vscode';
import type { ManagedInstallation, ObservedArtifact, Source, AssistantId, Scope } from '../domain/types';
import { readManifest, fromDesiredSource } from '../domain/registry';
import { scanInstalledInventory, promoteObservedArtifact } from '../engine/discovery';
import { analyzeLocalDrift, checkForUpstreamUpdate } from '../engine/drift';
import type { DriftReport } from '../engine/types';
import { FormEditorPanel } from './formEditor';
import { getAssistantIconPath } from './assistantIcons';
import type { InstalledTreeDataProvider } from './installedView';
import { findRelatedInstallations } from '../engine/crossFrameworkLookup';

export class DashboardPanel {
  public static currentPanel: DashboardPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _provider: InstalledTreeDataProvider;
  private _disposables: vscode.Disposable[] = [];

  private _sourceFilter?: { id: string; scope: Scope };

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, provider: InstalledTreeDataProvider) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._provider = provider;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'refresh':
            await this.update();
            break;
          case 'checkDrift':
            await this.update();
            break;
          case 'promote':
            if (message.observed) {
              await this._provider.doPromoteItem(message.observed as ObservedArtifact);
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
                  this.update();
                  this._provider.refresh();
                }
              );
            }
            break;
          case 'copyItem':
            if (message.item) {
              await this._provider.doSyncItem(message.item);
              await this.update();
            }
            break;
          case 'moveItem':
            if (message.item) {
              await this._provider.doMoveItem(message.item as ManagedInstallation);
              await this.update();
            }
            break;
          case 'diffItem':
            if (message.item) {
              await this._provider.doDiffAgainstOriginal(message.item);
            }
            break;
          case 'requestDetail':
            if (message.key) {
              await this.handleRequestDetail(message.key);
            }
            break;
        }
      },
      null,
      this._disposables
    );

    this.update();
  }

  public static render(extensionUri: vscode.Uri, provider: InstalledTreeDataProvider): DashboardPanel {
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

    DashboardPanel.currentPanel = new DashboardPanel(panel, extensionUri, provider);
    return DashboardPanel.currentPanel;
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

    const inst = allManaged.find(m => `${m.assistant}:${m.scope}:${m.name}` === key);
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
        membership: 'managed'
      });
      return;
    }

    const obs = allObserved.find(o => `${o.assistant}:${o.scope}:${o.name}` === key);
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
    this._panel.webview.html = this.getHtml(allSources, allManaged, allObserved, [], true, this._sourceFilter);

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
        key: `${inst.assistant}:${inst.scope}:${inst.name}`,
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
      modifiedLocally
    });
  }

  public getHtml(
    sources: Source[],
    managed: ManagedInstallation[],
    observed: ObservedArtifact[],
    reports: DriftReport[],
    scanning: boolean = false,
    sourceFilter?: { id: string; scope: Scope }
  ): string {
    const escapeHtml = (unsafe: string) => {
      return (unsafe || '')
        .toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    };

    const totalInstalled = managed.length;
    const totalUnmanaged = observed.length;
    const updatesAvailable = reports.filter(
      (r) => r.status === 'update-available' || r.status === 'modified-and-update-available'
    ).length;
    const modifiedLocally = reports.filter(
      (r) => r.status === 'modified-locally' || r.status === 'modified-and-update-available'
    ).length;
    const identicalCount = observed.filter((o) => o.match?.status === 'identical').length;

    const reportMap = new Map(reports.map((r) => [`${r.installation.assistant}:${r.installation.scope}:${r.installation.name}`, r]));

    const presentAssistants = Array.from(new Set([...managed.map(m => m.assistant), ...observed.map(o => o.assistant)])).sort();
    const environmentPills = presentAssistants.map(a => {
      const iconUris = getAssistantIconPath(a as AssistantId, this._extensionUri);
      const iconSrc = this._panel.webview.asWebviewUri(iconUris.light);
      return `<button class="filter-pill env-pill" data-env="${escapeHtml(a)}" onclick="setEnvFilter('${escapeHtml(a)}')">
        <img src="${iconSrc}" class="assistant-icon" width="14" height="14" />
        ${escapeHtml(a)}
      </button>`;
    }).join('\n');

    let rowsHtml = '';
    
    managed.forEach((inst, idx) => {
      const key = `${inst.assistant}:${inst.scope}:${inst.name}`;
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
        <tr class="item-row" data-kind="${escapeHtml(inst.kind)}" data-name="${escapeHtml(inst.name.toLowerCase())}" data-assistant="${escapeHtml(inst.assistant)}" data-scope="${escapeHtml(inst.scope)}" data-membership="managed" data-status="${escapeHtml(status)}" data-source-id="${escapeHtml(sourceId)}" data-source-scope="${escapeHtml(sourceScope)}" data-key="${escapeHtml(key)}" onclick="selectRow(this, '${escapeHtml(key)}')">
          <td><span class="kind-pill kind-${escapeHtml(inst.kind)}">${escapeHtml(inst.kind)}</span></td>
          <td><strong>${escapeHtml(inst.name)}</strong></td>
          <td>${escapeHtml(inst.assistant)}</td>
          <td><span class="scope-pill scope-${escapeHtml(inst.scope)}">${escapeHtml(inst.scope)}</span></td>
          <td data-drift-key="${escapeHtml(key)}"><span class="badge ${badgeClass}">${escapeHtml(badgeText)}</span></td>
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
        tooltip = ` title="${escapeHtml(obs.match.details || '')}"`;
      } else if (obs.match?.status === 'different') {
        badgeClass = 'badge-warning';
        badgeText = `◌ Unmanaged · differs from ${obs.match.sourceId}`;
        tooltip = ` title="${escapeHtml(obs.match.details || '')}"`;
      }

      let actionBtn = '';
      if ((obs.candidates?.length ?? 0) > 0) {
        actionBtn = `<button class="btn btn-sm btn-primary" onclick="promoteItem(${idx})">Promote</button>`;
      }

      const key = `${obs.assistant}:${obs.scope}:${obs.name}`;
      rowsHtml += `
        <tr class="item-row" data-kind="${escapeHtml(obs.kind)}" data-name="${escapeHtml(obs.name.toLowerCase())}" data-assistant="${escapeHtml(obs.assistant)}" data-scope="${escapeHtml(obs.scope)}" data-membership="unmanaged" data-status="unmanaged" data-source-id="${escapeHtml(sourceId)}" data-source-scope="${escapeHtml(sourceScope)}" data-key="${escapeHtml(key)}" onclick="selectRow(this, '${escapeHtml(key)}')">
          <td><span class="kind-pill kind-${escapeHtml(obs.kind)}">${escapeHtml(obs.kind)}</span></td>
          <td><strong>${escapeHtml(obs.name)}</strong></td>
          <td>${escapeHtml(obs.assistant)}</td>
          <td><span class="scope-pill scope-${escapeHtml(obs.scope)}">${escapeHtml(obs.scope)}</span></td>
          <td><span class="badge ${badgeClass}"${tooltip}>${escapeHtml(badgeText)}</span></td>
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
      <button class="btn btn-secondary" onclick="refreshState()">Refresh</button>
      ${identicalCount > 0 ? '<button class="btn btn-primary" onclick="promoteAllIdentical()">Promote ' + identicalCount + ' Identical Source Items</button>' : ''}
    </div>
  </div>

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

  <script type="application/json" id="managedDataJson">${JSON.stringify(managed).replace(/</g, '\\u003c')}</script>
  <script type="application/json" id="observedDataJson">${JSON.stringify(observed).replace(/</g, '\\u003c')}</script>
  <script type="application/json" id="sourceFilterJson">${JSON.stringify(sourceFilter ?? null).replace(/</g, '\\u003c')}</script>

  <script>
    const vscode = acquireVsCodeApi();
    function escapeHtmlClient(unsafe) {
      return (unsafe || '')
        .toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }
    const managedData = JSON.parse(document.getElementById('managedDataJson').textContent);
    const observedData = JSON.parse(document.getElementById('observedDataJson').textContent);

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
      const upStat = document.getElementById('stat-updates-available');
      if (upStat) upStat.textContent = visUpdates;
      const modStat = document.getElementById('stat-modified-locally');
      if (modStat) modStat.textContent = visModified;
      const unmanStat = document.getElementById('stat-unmanaged');
      if (unmanStat) unmanStat.textContent = visUnmanaged;
      const unmanLbl = document.getElementById('stat-unmanaged-lbl');
      if (unmanLbl) unmanLbl.textContent = \`Unmanaged Discovered (\${visUnmanagedIdentical} identical, \${visUnmanaged - visUnmanagedIdentical} custom)\`;
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.command === 'driftResult') {
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
        
        filterTable();
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
        }
        document.getElementById('detailActions').innerHTML = actions.join('');
      }
    });
  </script>
</body>
</html>`;
  }
}
