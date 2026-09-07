import * as vscode from 'vscode';
import type { ManagedInstallation, ObservedArtifact, Source } from '../domain/types';
import { readManifest, fromDesiredSource } from '../domain/registry';
import { scanInstalledInventory, promoteObservedArtifact } from '../engine/discovery';
import { analyzeLocalDrift, checkForUpstreamUpdate } from '../engine/drift';
import type { DriftReport } from '../engine/types';
import { FormEditorPanel } from './formEditor';

export class DashboardPanel {
  public static currentPanel: DashboardPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel) {
    this._panel = panel;
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
              await promoteObservedArtifact(message.observed);
              vscode.window.showInformationMessage(`Promoted "${message.observed.name}" to managed.`);
              await this.update();
            }
            break;
          case 'promoteAllIdentical':
            if (Array.isArray(message.items)) {
              let count = 0;
              for (const item of message.items) {
                if (item.match?.status === 'identical') {
                  await promoteObservedArtifact(item);
                  count++;
                }
              }
              vscode.window.showInformationMessage(`Promoted ${count} identical item(s) to managed installations.`);
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
                }
              );
            }
            break;
        }
      },
      null,
      this._disposables
    );

    this.update();
  }

  public static render(): DashboardPanel {
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
      }
    );

    DashboardPanel.currentPanel = new DashboardPanel(panel);
    return DashboardPanel.currentPanel;
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
    this._panel.webview.html = this.getHtml(allSources, allManaged, allObserved, [], true);

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
    scanning: boolean = false
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

    const reportMap = new Map(reports.map((r) => [`${r.installation.assistant}:${r.installation.scope}:${r.installation.name}`, r]));

    const managedRows = managed
      .map((inst, idx) => {
        const key = `${inst.assistant}:${inst.scope}:${inst.name}`;
        const report = reportMap.get(key);
        const isPending = scanning && !report;
        const status = report?.status ?? (scanning ? 'checking…' : 'up-to-date');
        const badgeClass =
          isPending
            ? 'badge-pending'
            : status === 'up-to-date'
            ? 'badge-success'
            : status === 'update-available'
            ? 'badge-info'
            : status === 'modified-locally'
            ? 'badge-warning'
            : status === 'modified-and-update-available'
            ? 'badge-warning'
            : 'badge-error';

        return `
        <tr class="item-row" data-kind="${inst.kind}" data-name="${inst.name.toLowerCase()}">
          <td><span class="kind-pill kind-${inst.kind}">${inst.kind}</span></td>
          <td><strong>${inst.name}</strong></td>
          <td>${inst.assistant}</td>
          <td><span class="scope-pill scope-${inst.scope}">${inst.scope}</span></td>
          <td data-drift-key="${key}"><span class="badge ${badgeClass}">${status}</span></td>
          <td>
            <button class="btn btn-sm btn-secondary" onclick="editItem(${idx})">Edit</button>
          </td>
        </tr>
      `;
      })
      .join('');

    const observedRows = observed
      .map((obs, idx) => {
        let matchBadge = '<span class="badge badge-unmanaged">local only</span>';
        if (obs.match?.status === 'identical') {
          matchBadge = `<span class="badge badge-success" title="${obs.match.details}">identical: ${obs.match.sourceId}</span>`;
        } else if (obs.match?.status === 'different') {
          matchBadge = `<span class="badge badge-warning" title="${obs.match.details}">differs: ${obs.match.sourceId}</span>`;
        }

        return `
        <tr class="unmanaged-row" data-kind="${obs.kind}" data-name="${obs.name.toLowerCase()}">
          <td><span class="kind-pill kind-${obs.kind}">${obs.kind}</span></td>
          <td><strong>${obs.name}</strong></td>
          <td>${obs.assistant}</td>
          <td><span class="scope-pill scope-${obs.scope}">${obs.scope}</span></td>
          <td>${matchBadge}</td>
          <td>
            <button class="btn btn-sm btn-primary" onclick="promoteItem(${idx})">Promote</button>
          </td>
        </tr>
      `;
      })
      .join('');

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
    .path-cell {
      font-size: 11px;
      opacity: 0.7;
      word-break: break-all;
    }
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin: 20px 0 8px 0;
    }
    .section-title {
      font-size: 14px;
      font-weight: 600;
      margin: 0;
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
    </div>
  </div>

  <div class="stats-ribbon">
    <div class="stat-chip">
      <span class="stat-num">${totalInstalled}</span>
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
      <span class="stat-num">${totalUnmanaged}</span>
      <span class="stat-label">Unmanaged Discovered (${identicalCount} identical, ${totalUnmanaged - identicalCount} custom)</span>
    </div>
  </div>

  <div class="toolbar">
    <input type="text" class="search-input" id="searchBox" placeholder="Filter artifacts by name, assistant, scope..." oninput="filterTable()">
    <div class="tabs">
      <button class="tab-btn active" onclick="setKindFilter('all', this)">All</button>
      <button class="tab-btn" onclick="setKindFilter('skill', this)">Skills</button>
      <button class="tab-btn" onclick="setKindFilter('agent', this)">Agents</button>
      <button class="tab-btn" onclick="setKindFilter('command', this)">Commands</button>
      <button class="tab-btn" onclick="setKindFilter('mcp-server', this)">MCPs</button>
      <button class="tab-btn" onclick="setKindFilter('hook', this)">Hooks</button>
      <button class="tab-btn" onclick="setKindFilter('rule', this)">Rules</button>
    </div>
  </div>

  <div class="section-header">
    <h2 class="section-title">Managed Artifacts (${totalInstalled})</h2>
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
    <tbody id="managedTable">
      ${managedRows || '<tr><td colspan="6" style="text-align:center; opacity:0.6;">No managed installations yet.</td></tr>'}
    </tbody>
  </table>

  ${
    observed.length > 0
      ? `
  <div class="section-header">
    <h2 class="section-title">Unmanaged Discovered Items (${totalUnmanaged})</h2>
    ${
      identicalCount > 0
        ? `<button class="btn btn-sm btn-primary" onclick="promoteAllIdentical()">Promote ${identicalCount} Identical Source Items</button>`
        : ''
    }
  </div>
  <table>
    <thead>
      <tr>
        <th>Kind</th>
        <th>Name</th>
        <th>Assistant</th>
        <th>Scope</th>
        <th>Source Match</th>
        <th>Action</th>
      </tr>
    </thead>
    <tbody id="observedTable">
      ${observedRows}
    </tbody>
  </table>
  `
      : ''
  }

  <script>
    const vscode = acquireVsCodeApi();
    const managedData = ${JSON.stringify(managed)};
    const observedData = ${JSON.stringify(observed)};

    let currentKind = 'all';

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

    function setKindFilter(kind, btn) {
      currentKind = kind;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filterTable();
    }

    function filterTable() {
      const q = document.getElementById('searchBox').value.toLowerCase();
      document.querySelectorAll('.item-row, .unmanaged-row').forEach(row => {
        const kind = row.getAttribute('data-kind');
        const name = row.getAttribute('data-name');
        const text = row.innerText.toLowerCase();

        const matchesKind = currentKind === 'all' || kind === currentKind;
        const matchesQuery = !q || text.includes(q) || name.includes(q);

        if (matchesKind && matchesQuery) {
          row.style.display = '';
        } else {
          row.style.display = 'none';
        }
      });
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.command === 'driftResult') {
        const cell = document.querySelector('[data-drift-key="' + msg.key + '"]');
        if (cell) {
          let badgeClass = 'badge-error';
          if (msg.status === 'up-to-date') badgeClass = 'badge-success';
          else if (msg.status === 'update-available') badgeClass = 'badge-info';
          else if (msg.status === 'modified-locally' || msg.status === 'modified-and-update-available') badgeClass = 'badge-warning';
          
          cell.innerHTML = '<span class="badge ' + badgeClass + '">' + msg.status + '</span>';
        }
      } else if (msg.command === 'scanComplete') {
        const indicator = document.getElementById('scan-indicator');
        if (indicator) indicator.style.display = 'none';
        
        const updatesStat = document.getElementById('stat-updates-available');
        if (updatesStat) updatesStat.textContent = msg.updatesAvailable;
        
        const modifiedStat = document.getElementById('stat-modified-locally');
        if (modifiedStat) modifiedStat.textContent = msg.modifiedLocally;
      }
    });
  </script>
</body>
</html>`;
  }
}
