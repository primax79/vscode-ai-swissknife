import * as vscode from 'vscode';
import type { ManagedInstallation, ObservedArtifact, Source, AssistantId, Scope } from '../domain/types';
import { readState, writeState, readManifest, fromDesiredSource } from '../domain/registry';
import { analyzeLocalDrift, checkForUpstreamUpdate } from '../engine/drift';
import { scanInstalledInventory, promoteObservedArtifact } from '../engine/discovery';
import { planInstall } from '../engine/plan';
import { planSync } from '../engine/sync';
import { applyInstall } from '../engine/apply';
import { softDeletePath } from '../engine/softDelete';
import { ClaudeAdapter } from '../adapters/claude';
import { KiloAdapter } from '../adapters/kilo';
import { CopilotAdapter } from '../adapters/copilot';
import { CodexAdapter } from '../adapters/codex';
import { GeminiAdapter } from '../adapters/gemini';
import type { DriftReport } from '../engine/types';
import { getWorkspaceRoot } from './workspacePicker';
import { getAssistantIconPath } from './assistantIcons';

export type InstalledTreeItem =
  | InstalledGroupItem
  | UnmanagedGroupItem
  | InstalledInstallationItem
  | ObservedArtifactItem;

export class InstalledGroupItem {
  constructor(
    public readonly groupKey: string,
    public readonly label: string,
    public readonly installations: ManagedInstallation[],
    public readonly assistant: AssistantId
  ) {}
}

export class UnmanagedGroupItem {
  constructor(
    public readonly groupKey: string,
    public readonly label: string,
    public readonly observed: ObservedArtifact[]
  ) {}
}

export class InstalledInstallationItem {
  constructor(
    public readonly installation: ManagedInstallation,
    public report?: DriftReport,
    public readonly isRecommended?: boolean
  ) {}
}

export class ObservedArtifactItem {
  constructor(public readonly observed: ObservedArtifact) {}
}

export class InstalledTreeDataProvider
  implements vscode.TreeDataProvider<InstalledTreeItem>
{
  constructor(private readonly extensionUri: vscode.Uri) {}

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
  private codexAdapter = new CodexAdapter();
  private geminiAdapter = new GeminiAdapter();

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: InstalledTreeItem): vscode.TreeItem {
    if (element instanceof InstalledGroupItem) {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.description = `${element.installations.length} managed`;
      item.contextValue = 'installedGroup';
      item.iconPath = getAssistantIconPath(element.assistant, this.extensionUri);
      return item;
    }

    if (element instanceof UnmanagedGroupItem) {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      item.description = `${element.observed.length} unmanaged`;
      item.iconPath = new vscode.ThemeIcon('eye');
      item.contextValue = 'unmanagedGroup';
      return item;
    }

    if (element instanceof ObservedArtifactItem) {
      const obs = element.observed;
      let desc = `${obs.kind} [unmanaged]`;
      let iconName = 'eye';

      if (obs.match?.status === 'identical') {
        desc = `${obs.kind} [identical to ${obs.match.sourceId}]`;
        iconName = 'pass';
      } else if (obs.match?.status === 'different') {
        desc = `${obs.kind} [differs from ${obs.match.sourceId}]`;
        iconName = 'diff-modified';
      } else if (obs.match?.status === 'unmatched') {
        desc = `${obs.kind} [local only]`;
        iconName = 'eye';
      }

      const item = new vscode.TreeItem(
        obs.name,
        vscode.TreeItemCollapsibleState.None
      );
      item.description = desc;
      item.tooltip = `Name: ${obs.name}\nKind: ${obs.kind}\nAssistant: ${obs.assistant}\nScope: ${obs.scope}\nPath: ${obs.path}\nDiscovered: ${obs.discoveredAt}${
        obs.match?.details ? `\nFeedback: ${obs.match.details}` : ''
      }`;
      item.iconPath = new vscode.ThemeIcon(iconName);
      item.contextValue = 'observedArtifactItem';
      return item;
    }

    const inst = element.installation;
    const report = element.report ?? this.driftReports.get(this.getInstallKey(inst));

    let desc = `${inst.kind} (${inst.scope})`;
    if (element.isRecommended) {
      desc += ' ★';
    }
    let iconName =
      inst.kind === 'agent'
        ? 'robot'
        : inst.kind === 'command'
        ? 'terminal'
        : inst.kind === 'mcp-server'
        ? 'plug'
        : inst.kind === 'hook'
        ? 'zap'
        : inst.kind === 'rule'
        ? 'book'
        : 'check';

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
    item.contextValue = element.isRecommended ? 'installedInstallation:recommended' : 'installedInstallation';
    return item;
  }

  async getChildren(element?: InstalledTreeItem): Promise<InstalledTreeItem[]> {
    if (!element) {
      const allManaged: ManagedInstallation[] = [];
      const allObserved: ObservedArtifact[] = [];

      try {
        const globalInv = await scanInstalledInventory('global');
        allManaged.push(...globalInv.managed);
        allObserved.push(...globalInv.observed);
      } catch {
        // ignore
      }

      const folders = vscode.workspace.workspaceFolders;
      if (folders && folders.length > 0) {
        const projectRoot = folders[0].uri.fsPath;
        try {
          const projectInv = await scanInstalledInventory('project', projectRoot);
          allManaged.push(...projectInv.managed);
          allObserved.push(...projectInv.observed);
        } catch {
          // ignore
        }
      }

      const result: InstalledTreeItem[] = [];

      const managedGroups = new Map<string, ManagedInstallation[]>();
      for (const inst of allManaged) {
        const key = `${inst.assistant} (${inst.scope})`;
        const list = managedGroups.get(key) ?? [];
        list.push(inst);
        managedGroups.set(key, list);
      }

      for (const [key, list] of managedGroups.entries()) {
        result.push(new InstalledGroupItem(key, key, list, list[0].assistant));
      }

      const unmanagedGroups = new Map<string, ObservedArtifact[]>();
      for (const obs of allObserved) {
        const key = `Unmanaged: ${obs.assistant} (${obs.scope})`;
        const list = unmanagedGroups.get(key) ?? [];
        list.push(obs);
        unmanagedGroups.set(key, list);
      }

      for (const [key, list] of unmanagedGroups.entries()) {
        result.push(new UnmanagedGroupItem(key, key, list));
      }

      return result;
    }

    if (element instanceof InstalledGroupItem) {
      const recommendedSet = new Set<string>();
      try {
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
          const projectRoot = folders[0].uri.fsPath;
          const manifest = await readManifest('project', projectRoot);
          for (const d of manifest.desiredInstallations) {
            recommendedSet.add(`${d.sourceId}:${d.artifactId}:${d.assistant}`);
          }
        }
      } catch {
        // ignore
      }

      return element.installations.map((inst) => {
        const report = this.driftReports.get(this.getInstallKey(inst));
        const isRecommended =
          inst.scope === 'project' &&
          inst.sourceId &&
          inst.artifactId &&
          recommendedSet.has(`${inst.sourceId}:${inst.artifactId}:${inst.assistant}`);
        return new InstalledInstallationItem(inst, report, !!isRecommended);
      });
    }

    if (element instanceof UnmanagedGroupItem) {
      return element.observed.map((obs) => new ObservedArtifactItem(obs));
    }

    return [];
  }

  async checkDrift(): Promise<void> {
    this.driftReports.clear();
    const allInstallations: ManagedInstallation[] = [];
    const allSources: Source[] = [];

    try {
      const gState = await readState('global');
      allInstallations.push(...gState.installations);
      const gManifest = await readManifest('global');
      allSources.push(...gManifest.sources.map((d) => fromDesiredSource(d)));
    } catch {
      // ignore
    }

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
        : inst.assistant === 'codex-cli'
        ? this.codexAdapter
        : inst.assistant === 'gemini-cli'
        ? this.geminiAdapter
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

  async syncItem(item?: InstalledInstallationItem | ObservedArtifactItem): Promise<void> {
    if (!item) {
      vscode.window.showWarningMessage('Please select an item to copy / synchronize.');
      return;
    }

    const sourceItem =
      item instanceof InstalledInstallationItem ? item.installation : item.observed;

    const assistantPick = await vscode.window.showQuickPick(
      (['claude-code', 'kilo-code', 'github-copilot', 'codex-cli', 'gemini-cli'] as const).map(
        (id) => ({
          label: id,
          iconPath: getAssistantIconPath(id, this.extensionUri),
        })
      ),
      {
        placeHolder: `Select target assistant to copy "${sourceItem.name}" to`,
      }
    );
    if (!assistantPick) return;
    const targetAssistant = assistantPick.label as AssistantId;

    const scopePick = await vscode.window.showQuickPick(['project', 'global'], {
      placeHolder: `Select target scope for copied ${sourceItem.kind}`,
    });
    if (!scopePick) return;
    const targetScope = scopePick as Scope;

    let targetProjectRoot: string | undefined;
    if (targetScope === 'project') {
      targetProjectRoot = await getWorkspaceRoot();
      if (!targetProjectRoot) return;
    }

    const prepared = await planSync({
      sourceItem,
      targetAssistant,
      targetScope,
      targetProjectRoot,
    });

    if (!prepared.supported) {
      vscode.window.showErrorMessage(`Failed to plan copy: ${prepared.plan.reason}`);
      return;
    }

    if (prepared.plan.conflict) {
      const conflictChoice = await vscode.window.showWarningMessage(
        `Item "${sourceItem.name}" already exists in target ${targetAssistant} (${targetScope}). Overwrite?`,
        { modal: true },
        'Overwrite'
      );
      if (conflictChoice !== 'Overwrite') return;
    }

    const confirm = await vscode.window.showInformationMessage(
      `Copy ${sourceItem.kind} "${sourceItem.name}" from ${sourceItem.assistant} (${sourceItem.scope}) to ${targetAssistant} (${targetScope})?`,
      { modal: true },
      'Copy'
    );
    if (confirm !== 'Copy') return;

    const outcome = await applyInstall(prepared);
    if (outcome.status === 'applied') {
      vscode.window.showInformationMessage(
        `Successfully copied "${sourceItem.name}" to ${targetAssistant} (${targetScope}).`
      );
      this.refresh();
    } else {
      vscode.window.showErrorMessage(`Copy failed: ${outcome.reason}`);
    }
  }

  async promoteItem(item?: ObservedArtifactItem): Promise<void> {
    if (!item) {
      vscode.window.showWarningMessage('Please select an unmanaged item to promote.');
      return;
    }

    const obs = item.observed;
    let confirmPrompt = `Promote unmanaged ${obs.kind} "${obs.name}" (${obs.assistant}, ${obs.scope}) to managed installation?`;

    if (obs.match?.status === 'identical') {
      confirmPrompt = `Observed ${obs.kind} "${obs.name}" is identical to registered source "${obs.match.sourceId}". Promote to managed installation and attach source provenance?`;
    } else if (obs.match?.status === 'different') {
      confirmPrompt = `Observed ${obs.kind} "${obs.name}" differs from registered source "${obs.match.sourceId}". Promote local copy to managed installation?`;
    }

    const confirm = await vscode.window.showInformationMessage(
      confirmPrompt,
      { modal: true },
      'Promote'
    );

    if (confirm !== 'Promote') return;

    try {
      await promoteObservedArtifact(obs);
      vscode.window.showInformationMessage(`Successfully promoted "${obs.name}" to managed installation.`);
      this.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to promote "${obs.name}": ${msg}`);
    }
  }


  async moveItem(item?: InstalledInstallationItem): Promise<void> {
    if (!item) {
      vscode.window.showWarningMessage('Please select a managed item to move.');
      return;
    }

    const inst = item.installation;
    if (inst.kind === 'hook' || inst.kind === 'rule') {
      vscode.window.showErrorMessage("Move isn't supported for this kind yet.");
      return;
    }

    const assistantPick = await vscode.window.showQuickPick(
      (['claude-code', 'kilo-code', 'github-copilot', 'codex-cli', 'gemini-cli'] as const).map(
        (id) => ({
          label: id,
          iconPath: getAssistantIconPath(id, this.extensionUri),
        })
      ),
      {
        placeHolder: `Select target assistant to move "${inst.name}" to`,
      }
    );
    if (!assistantPick) return;
    const targetAssistant = assistantPick.label as AssistantId;

    const scopePick = await vscode.window.showQuickPick(['project', 'global'], {
      placeHolder: `Select target scope for moved ${inst.kind}`,
    });
    if (!scopePick) return;
    const targetScope = scopePick as Scope;

    let targetProjectRoot: string | undefined;
    if (targetScope === 'project') {
      targetProjectRoot = await getWorkspaceRoot();
      if (!targetProjectRoot) return;
    }

    const prepared = await planSync({
      sourceItem: inst,
      targetAssistant,
      targetScope,
      targetProjectRoot,
    });

    if (!prepared.supported) {
      vscode.window.showErrorMessage(`Failed to plan move: ${prepared.plan.reason}`);
      return;
    }

    if (prepared.plan.conflict) {
      const conflictChoice = await vscode.window.showWarningMessage(
        `Item "${inst.name}" already exists in target ${targetAssistant} (${targetScope}). Overwrite?`,
        { modal: true },
        'Overwrite'
      );
      if (conflictChoice !== 'Overwrite') return;
    }

    const confirm = await vscode.window.showInformationMessage(
      `Move ${inst.kind} "${inst.name}" from ${inst.assistant} (${inst.scope}) to ${targetAssistant} (${targetScope})?`,
      { modal: true },
      'Move'
    );
    if (confirm !== 'Move') return;

    const outcome = await applyInstall(prepared);
    if (outcome.status === 'applied') {
      try {
        if (inst.kind === 'mcp-server') {
          const originAdapter =
            inst.assistant === 'claude-code'
              ? this.claudeAdapter
              : inst.assistant === 'github-copilot'
              ? this.copilotAdapter
              : inst.assistant === 'codex-cli'
              ? this.codexAdapter
              : inst.assistant === 'gemini-cli'
              ? this.geminiAdapter
              : this.kiloAdapter;
          await originAdapter.removeMcpServer(inst.name, {
            scope: inst.scope,
            projectRoot: inst.projectPath,
          });
        } else {
          await softDeletePath(
            inst.path,
            inst.kind,
            inst.name,
            inst.scope,
            inst.projectPath
          );
        }

        const state = await readState(inst.scope, inst.projectPath);
        state.installations = state.installations.filter(
          (i) => !(i.assistant === inst.assistant && i.kind === inst.kind && i.name === inst.name)
        );
        await writeState(inst.scope, state, inst.projectPath);

        vscode.window.showInformationMessage(
          `Successfully moved "${inst.name}" to ${targetAssistant} (${targetScope}).`
        );
        this.refresh();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(
          `CRITICAL: Moved "${inst.name}" to ${targetAssistant} (${targetScope}) successfully, but removing the original at ${inst.assistant} (${inst.scope}) failed: ${msg}. Manual cleanup needed. Path requiring inspection: ${inst.path}`,
          { modal: true }
        );
      }
    } else {
      vscode.window.showErrorMessage(`Move failed: ${outcome.reason}`);
    }
  }

  private getInstallKey(inst: ManagedInstallation): string {
    return `${inst.assistant}:${inst.scope}:${inst.projectPath ?? ''}:${inst.name}`;
  }
}
