import * as vscode from 'vscode';
import type { ManagedInstallation, ObservedArtifact, Source } from '../domain/types';
import { readManifest, fromDesiredSource } from '../domain/registry';
import { scanInstalledInventory, promoteObservedArtifact } from '../engine/discovery';
import { analyzeLocalDrift, checkForUpstreamUpdate } from '../engine/drift';
import type { DriftReport } from '../engine/types';

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

    // Drift
    for (const inst of allManaged) {
      const matchingSource = allSources.find((s) => s.id === inst.sourceId);
      let report: DriftReport;
      if (matchingSource) {
        report = await checkForUpstreamUpdate(inst, matchingSource);
      } else {
        report = await analyzeLocalDrift(inst);
      }
      driftReports.push(report);
    }

    this._panel.webview.html = this.getHtml(allSources, allManaged, allObserved, driftReports);
  }

  public getHtml(
    sources: Source[],
    managed: ManagedInstallation[],
    observed: ObservedArtifact[],
    reports: DriftReport[]
  ): string {
    const totalInstalled = managed.length;
    const totalUnmanaged = observed.length;
    const updatesAvailable = reports.filter(
      (r) => r.status === 'update-available' || r.status === 'modified-and-update-available'
    ).length;
    const modifiedLocally = reports.filter(
      (r) => r.status === 'modified-locally' || r.status === 'modified-and-update-available'
    ).length;

    const reportMap = new Map(reports.map((r) => [`${r.installation.assistant}:${r.installation.scope}:${r.installation.name}`, r]));

    const managedRows = managed
      .map((inst) => {
        const report = reportMap.get(`${inst.assistant}:${inst.scope}:${inst.name}`);
        const status = report?.status ?? 'up-to-date';
        const badgeClass =
          status === 'up-to-date'
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
          <td><span class="badge ${badgeClass}">${status}</span></td>
          <td><code class="path-cell">${inst.path}</code></td>
        </tr>
      `;
      })
      .join('');

    const observedRows = observed
      .map((obs, idx) => {
        return `
        <tr class="unmanaged-row" data-kind="${obs.kind}" data-name="${obs.name.toLowerCase()}">
          <td><span class="kind-pill kind-${obs.kind}">${obs.kind}</span></td>
          <td><strong>${obs.name}</strong></td>
          <td>${obs.assistant}</td>
          <td><span class="scope-pill scope-${obs.scope}">${obs.scope}</span></td>
          <td><span class="badge badge-unmanaged">unmanaged</span></td>
          <td>
            <button class="btn btn-primary" onclick="promoteItem(${idx})">Promote</button>
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
      padding: 24px;
      margin: 0;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }
    .title-group h1 {
      margin: 0 0 4px 0;
      font-size: 24px;
      font-weight: 600;
    }
    .title-group p {
      margin: 0;
      opacity: 0.8;
      font-size: 13px;
    }
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .metric-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }
    .metric-value {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .metric-label {
      font-size: 12px;
      opacity: 0.7;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
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
      padding: 8px 12px;
      font-size: 13px;
    }
    .tabs {
      display: flex;
      gap: 8px;
    }
    .tab-btn {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--fg);
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
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
      padding: 8px 14px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
      font-size: 13px;
    }
    th, td {
      padding: 10px 12px;
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
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .kind-skill { background: rgba(56, 139, 253, 0.2); color: #58a6ff; }
    .kind-agent { background: rgba(163, 113, 247, 0.2); color: #bc8cff; }
    .kind-command { background: rgba(210, 153, 34, 0.2); color: #d29922; }
    .kind-mcp-server { background: rgba(46, 160, 67, 0.2); color: #3fb950; }
    .scope-pill {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
    }
    .scope-project { background: rgba(255, 255, 255, 0.1); }
    .scope-global { background: rgba(0, 150, 255, 0.15); }
    .badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 500;
    }
    .badge-success { background: rgba(46, 160, 67, 0.2); color: #3fb950; }
    .badge-info { background: rgba(56, 139, 253, 0.2); color: #58a6ff; }
    .badge-warning { background: rgba(210, 153, 34, 0.2); color: #d29922; }
    .badge-error { background: rgba(207, 34, 46, 0.2); color: #f85149; }
    .badge-unmanaged { background: rgba(255, 255, 255, 0.1); color: var(--fg); }
    .path-cell {
      font-size: 11px;
      opacity: 0.7;
      word-break: break-all;
    }
    .section-title {
      margin: 32px 0 12px 0;
      font-size: 16px;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title-group">
      <h1>AI Swissknife Dashboard</h1>
      <p>Cross-assistant inventory management, drift tracking, and updates</p>
    </div>
    <div>
      <button class="btn" onclick="refreshState()">Refresh</button>
    </div>
  </div>

  <div class="metrics-grid">
    <div class="metric-card">
      <div class="metric-value">${totalInstalled}</div>
      <div class="metric-label">Managed Installations</div>
    </div>
    <div class="metric-card">
      <div class="metric-value" style="color: #58a6ff;">${updatesAvailable}</div>
      <div class="metric-label">Updates Available</div>
    </div>
    <div class="metric-card">
      <div class="metric-value" style="color: #d29922;">${modifiedLocally}</div>
      <div class="metric-label">Modified Locally</div>
    </div>
    <div class="metric-card">
      <div class="metric-value">${totalUnmanaged}</div>
      <div class="metric-label">Unmanaged Discovered</div>
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
    </div>
  </div>

  <div class="section-title">Managed Artifacts</div>
  <table>
    <thead>
      <tr>
        <th>Kind</th>
        <th>Name</th>
        <th>Assistant</th>
        <th>Scope</th>
        <th>Drift / Status</th>
        <th>Path</th>
      </tr>
    </thead>
    <tbody id="managedTable">
      ${managedRows || '<tr><td colspan="6" style="text-align:center; opacity:0.6;">No managed installations yet.</td></tr>'}
    </tbody>
  </table>

  ${
    observed.length > 0
      ? `
  <div class="section-title">Unmanaged Discovered Items</div>
  <table>
    <thead>
      <tr>
        <th>Kind</th>
        <th>Name</th>
        <th>Assistant</th>
        <th>Scope</th>
        <th>Status</th>
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
    const observedData = ${JSON.stringify(observed)};

    let currentKind = 'all';

    function refreshState() {
      vscode.postMessage({ command: 'refresh' });
    }

    function promoteItem(index) {
      const item = observedData[index];
      vscode.postMessage({ command: 'promote', observed: item });
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
  </script>
</body>
</html>`;
  }
}
