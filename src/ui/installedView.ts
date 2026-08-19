import * as vscode from 'vscode';
import type { ManagedInstallation, Source } from '../domain/types';
import { readState, readManifest, fromDesiredSource } from '../domain/registry';
import { analyzeLocalDrift, checkForUpstreamUpdate } from '../engine/drift';
import { planInstall } from '../engine/plan';
import { applyInstall } from '../engine/apply';
import { ClaudeAdapter } from '../adapters/claude';
import { KiloAdapter } from '../adapters/kilo';
import { CopilotAdapter } from '../adapters/copilot';
import type { DriftReport } from '../engine/types';
import { getWorkspaceRoot } from './workspacePicker';

export type InstalledTreeItem = InstalledGroupItem | InstalledInstallationItem;

export class InstalledGroupItem {
  constructor(
    public readonly groupKey: string,
    public readonly label: string,
    public readonly installations: ManagedInstallation[]
  ) {}
}

export class InstalledInstallationItem {
  constructor(
    public readonly installation: ManagedInstallation,
    public report?: DriftReport
  ) {}
}

export class InstalledTreeDataProvider
  implements vscode.TreeDataProvider<InstalledTreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    InstalledTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData: vscode.Event<
    InstalledTreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  private driftReports = new Map<string, DriftReport>();
  private claudeAdapter = new ClaudeAdapter();
  private kiloAdapter = new KiloAdapter();
  private copilotAdapter = new CopilotAdapter();

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: InstalledTreeItem): vscode.TreeItem {
    if (element instanceof InstalledGroupItem) {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.description = `${element.installations.length} installed`;
      item.contextValue = 'installedGroup';
      return item;
    }

    const inst = element.installation;
    const report = element.report ?? this.driftReports.get(this.getInstallKey(inst));

    let desc = `${inst.kind} (${inst.scope})`;
    let iconName = inst.kind === 'agent' ? 'robot' : inst.kind === 'command' ? 'terminal' : inst.kind === 'mcp-server' ? 'plug' : 'check';

    if (report) {
      if (report.status === 'modified-locally') {
        desc = `${inst.kind} [modified locally]`;
        iconName = 'diff-modified';
      } else if (report.status === 'update-available') {
        desc = `${inst.kind} [update available]`;
        iconName = 'cloud-download';
      } else if (report.status === 'modified-and-update-available') {
        desc = `${inst.kind} [modified & update available]`;
        iconName = 'warning';
      } else if (report.status === 'missing-on-disk') {
        desc = `${inst.kind} [missing on disk]`;
        iconName = 'error';
      }
    }

    const item = new vscode.TreeItem(
      inst.name,
      vscode.TreeItemCollapsibleState.None
    );
    item.description = desc;
    item.tooltip = `Name: ${inst.name}\nKind: ${inst.kind}\nAssistant: ${inst.assistant}\nScope: ${inst.scope}\nPath: ${inst.path}\nInstalled at: ${inst.installedAt}${
      report?.details ? `\nStatus: ${report.details}` : ''
    }${inst.sourceRevision?.commit ? `\nCommit: ${inst.sourceRevision.commit}` : ''}`;
    item.iconPath = new vscode.ThemeIcon(iconName);
    item.contextValue = 'installedInstallation';
    return item;
  }

  async getChildren(element?: InstalledTreeItem): Promise<InstalledTreeItem[]> {
    if (!element) {
      const allInstallations: ManagedInstallation[] = [];

      try {
        const globalState = await readState('global');
        allInstallations.push(...globalState.installations);
      } catch {
        // ignore
      }

      const folders = vscode.workspace.workspaceFolders;
      if (folders && folders.length > 0) {
        const projectRoot = folders[0].uri.fsPath;
        try {
          const projectState = await readState('project', projectRoot);
          allInstallations.push(...projectState.installations);
        } catch {
          // ignore
        }
      }

      const groups = new Map<string, ManagedInstallation[]>();
      for (const inst of allInstallations) {
        const key = `${inst.assistant} (${inst.scope})`;
        const list = groups.get(key) ?? [];
        list.push(inst);
        groups.set(key, list);
      }

      const result: InstalledGroupItem[] = [];
      for (const [key, list] of groups.entries()) {
        result.push(new InstalledGroupItem(key, key, list));
      }

      return result;
    }

    if (element instanceof InstalledGroupItem) {
      return element.installations.map((inst) => {
        const report = this.driftReports.get(this.getInstallKey(inst));
        return new InstalledInstallationItem(inst, report);
      });
    }

    return [];
  }

  async checkDrift(): Promise<void> {
    this.driftReports.clear();
    const allInstallations: ManagedInstallation[] = [];
    const allSources: Source[] = [];

    // Global
    try {
      const gState = await readState('global');
      allInstallations.push(...gState.installations);
      const gManifest = await readManifest('global');
      allSources.push(...gManifest.sources.map((d) => fromDesiredSource(d)));
    } catch {
      // ignore
    }

    // Project
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      const projectRoot = folders[0].uri.fsPath;
      try {
        const pState = await readState('project', projectRoot);
        allInstallations.push(...pState.installations);
        const pManifest = await readManifest('project', projectRoot);
        allSources.push(...pManifest.sources.map((d) => fromDesiredSource(d, projectRoot)));
      } catch {
        // ignore
      }
    }

    let modifiedCount = 0;
    let updateCount = 0;
    let missingCount = 0;

    for (const inst of allInstallations) {
      const matchingSource = allSources.find((s) => s.id === inst.sourceId);
      let report: DriftReport;
      if (matchingSource) {
        report = await checkForUpstreamUpdate(inst, matchingSource);
      } else {
        report = await analyzeLocalDrift(inst);
      }
      this.driftReports.set(this.getInstallKey(inst), report);

      if (report.status === 'modified-locally') modifiedCount++;
      if (report.status === 'update-available' || report.status === 'modified-and-update-available') updateCount++;
      if (report.status === 'missing-on-disk') missingCount++;
    }

    this.refresh();

    vscode.window.showInformationMessage(
      `Drift check complete: ${allInstallations.length} items checked (${updateCount} update(s), ${modifiedCount} modified locally, ${missingCount} missing on disk).`
    );
  }

  async updateInstallation(item?: InstalledInstallationItem): Promise<void> {
    if (!item) {
      vscode.window.showWarningMessage('Please select an installed item to update.');
      return;
    }

    const inst = item.installation;
    if (!inst.sourceId) {
      vscode.window.showWarningMessage(`Cannot update "${inst.name}": no source ID recorded.`);
      return;
    }

    // Find source
    let source: Source | undefined;
    let projectRoot: string | undefined;

    if (inst.scope === 'project') {
      projectRoot = inst.projectPath ?? (await getWorkspaceRoot());
      if (projectRoot) {
        const pManifest = await readManifest('project', projectRoot);
        const desired = pManifest.sources.find((s) => s.id === inst.sourceId);
        if (desired) source = fromDesiredSource(desired, projectRoot);
      }
    } else {
      const gManifest = await readManifest('global');
      const desired = gManifest.sources.find((s) => s.id === inst.sourceId);
      if (desired) source = fromDesiredSource(desired);
    }

    if (!source) {
      vscode.window.showErrorMessage(`Source "${inst.sourceId}" not found in manifest.`);
      return;
    }

    const targetAdapter =
      inst.assistant === 'claude-code'
        ? this.claudeAdapter
        : inst.assistant === 'github-copilot'
        ? this.copilotAdapter
        : this.kiloAdapter;

    const fakePkg = {
      id: inst.packageId ?? `${source.id}:${inst.name}`,
      sourceId: source.id,
      nativeFormat: 'raw',
      artifacts: [],
    };

    const fakeArtifact = {
      id: inst.artifactId ?? `${source.id}:${inst.name}`,
      packageId: fakePkg.id,
      kind: inst.kind,
      name: inst.name,
      nativeFormat: 'raw',
    };

    const prepared = await planInstall({
      source,
      pkg: fakePkg,
      artifact: fakeArtifact,
      targetAdapter,
      targetScope: inst.scope,
      projectRoot: inst.projectPath,
    });

    if (!prepared.supported) {
      vscode.window.showErrorMessage(`Failed to plan update for ${inst.name}: ${prepared.plan.reason}`);
      return;
    }

    const confirm = await vscode.window.showInformationMessage(
      `Update ${inst.kind} "${inst.name}" to latest version from source "${source.id}"?`,
      { modal: true },
      'Update'
    );
    if (confirm !== 'Update') return;

    const outcome = await applyInstall(prepared);
    if (outcome.status === 'applied') {
      vscode.window.showInformationMessage(`Successfully updated "${inst.name}".`);
      await this.checkDrift();
    } else {
      vscode.window.showErrorMessage(`Update failed: ${outcome.reason}`);
    }
  }

  private getInstallKey(inst: ManagedInstallation): string {
    return `${inst.assistant}:${inst.scope}:${inst.projectPath ?? ''}:${inst.name}`;
  }
}
