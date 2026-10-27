import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import type { ManagedInstallation, ObservedArtifact, Source, AssistantId, Scope, ItemKind } from '../domain/types';
import { readState, writeState, readManifest, fromDesiredSource, withStateLock } from '../domain/registry';
import { analyzeLocalDrift, checkDriftForAll } from '../engine/drift';
import { scanInstalledInventory, promoteObservedArtifact } from '../engine/discovery';
import { planSync } from '../engine/sync';
import { applyInstall } from '../engine/apply';
import {
  planUpdate,
  planUpdateAll,
  applyUpdateAll,
  setHeld,
  type UpdateFilter,
  type UpdateItemOutcome,
} from '../engine/update';
import { softDeletePath } from '../engine/softDelete';
import { uninstallInstallation } from '../engine/uninstall';
import { getAdapter, getEnabledAdapters, ALL_ADAPTERS } from '../adapters/registry';
import { getScopeLabel, getScopeIconName, getScopeQuickPickItems } from './scopeIcons';
import type { DriftReport } from '../engine/types';
import { getWorkspaceRoot } from './workspacePicker';
import { getKindIconName } from './kindIcons';
import {
  ArtifactFileItem,
  getArtifactFileChildren,
  getArtifactFileTreeItem,
  isBrowsableDirectory,
  listArtifactFiles,
} from './artifactFileTree';

export type InstalledTreeItem =
  | ScopeGroupItem
  | KindGroupItem
  | InstalledInstallationItem
  | ObservedArtifactItem
  | ArtifactFileItem;

export { ArtifactFileItem };

export class ScopeGroupItem {
  constructor(
    public readonly assistant: AssistantId,
    public readonly scope: Scope,
    public readonly label: string,
    public readonly managed: ManagedInstallation[],
    public readonly observed: ObservedArtifact[]
  ) {}
}

export class KindGroupItem {
  constructor(
    public readonly kind: ItemKind,
    public readonly label: string,
    public readonly items: (InstalledInstallationItem | ObservedArtifactItem)[]
  ) {}
}

export class InstalledInstallationItem {
  constructor(
    public readonly installation: ManagedInstallation,
    public report?: DriftReport,
    public readonly isRecommended?: boolean,
    public readonly tooltipDescription?: string
  ) {}
}

export class ObservedArtifactItem {
  constructor(
    public readonly observed: ObservedArtifact,
    public readonly tooltipDescription?: string
  ) {}
}

import { extractSkillFrontmatter } from '../sources/detect';

function getArtifactDescription(kind: ItemKind, artifactPath: string): string | undefined {
  try {
    if (kind === 'skill') {
      const skillMdPath = path.join(artifactPath, 'SKILL.md');
      if (fs.existsSync(skillMdPath)) {
        const content = fs.readFileSync(skillMdPath, 'utf8');
        const fm = extractSkillFrontmatter(content);
        return fm.description;
      }
    } else if (kind === 'agent' || kind === 'command') {
      if (fs.existsSync(artifactPath)) {
        const content = fs.readFileSync(artifactPath, 'utf8');
        const fm = extractSkillFrontmatter(content);
        return fm.description;
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}

const KIND_ORDER: ItemKind[] = ['skill', 'agent', 'command', 'mcp-server', 'hook', 'rule'];

const KIND_LABELS: Record<ItemKind, string> = {
  skill: 'Skills',
  agent: 'Agents',
  command: 'Commands',
  'mcp-server': 'MCP Servers',
  hook: 'Hooks',
  rule: 'Rules',
};

function groupByKind<T extends InstalledInstallationItem | ObservedArtifactItem>(
  items: T[],
  getKind: (item: T) => ItemKind
): KindGroupItem[] {
  const buckets = new Map<ItemKind, T[]>();
  for (const item of items) {
    const kind = getKind(item);
    const list = buckets.get(kind) ?? [];
    list.push(item);
    buckets.set(kind, list);
  }

  const result: KindGroupItem[] = [];
  for (const kind of KIND_ORDER) {
    const list = buckets.get(kind);
    if (list && list.length > 0) {
      result.push(new KindGroupItem(kind, `${KIND_LABELS[kind]} (${list.length})`, list));
    }
  }
  return result;
}

export class InstalledTreeDataProvider {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly homeRoot?: string
  ) {}

  private outputChannel?: vscode.OutputChannel;

  private getOutputChannel(): vscode.OutputChannel {
    if (!this.outputChannel) {
      this.outputChannel = vscode.window.createOutputChannel('AI Swissknife');
    }
    return this.outputChannel;
  }

  updateContextKeys(reports?: DriftReport[]): void {
    const effectiveReports = reports ?? Array.from(this.driftReports.values());
    for (const adapter of ALL_ADAPTERS) {
      const hasUpdates = effectiveReports.some(
        (r) =>
          r.installation.assistant === adapter.assistant &&
          (r.status === 'update-available' || r.status === 'modified-and-update-available')
      );
      vscode.commands.executeCommand(
        'setContext',
        `aiSwissknife.updatesAvailable.${adapter.assistant}`,
        hasUpdates
      );
      vscode.commands.executeCommand(
        'setContext',
        `aiSwissknife.hasUpdates.${adapter.assistant}`,
        hasUpdates
      );
    }
  }

  private _onDidChangeTreeData = new vscode.EventEmitter<
    InstalledTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData: vscode.Event<
    InstalledTreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  private driftReports = new Map<string, DriftReport>();

  private rawInventoryCache: Promise<{ allManaged: ManagedInstallation[]; allObserved: ObservedArtifact[] }> | null = null;

  refresh(): void {
    this.rawInventoryCache = null;
    this._onDidChangeTreeData.fire();
  }

  private getRawInventory(): Promise<{ allManaged: ManagedInstallation[]; allObserved: ObservedArtifact[] }> {
    if (!this.rawInventoryCache) {
      this.rawInventoryCache = this.scanRawInventory();
    }
    return this.rawInventoryCache;
  }

  private async scanRawInventory(): Promise<{ allManaged: ManagedInstallation[]; allObserved: ObservedArtifact[] }> {
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

    return { allManaged, allObserved };
  }

  getTreeItem(element: InstalledTreeItem): vscode.TreeItem {
    if (element instanceof ScopeGroupItem) {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.description = `${element.managed.length} managed, ${element.observed.length} unmanaged`;
      item.contextValue = 'scopeGroup';
      item.iconPath = new vscode.ThemeIcon(getScopeIconName(element.scope));
      return item;
    }

    if (element instanceof KindGroupItem) {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      item.iconPath = new vscode.ThemeIcon(getKindIconName(element.kind));
      item.contextValue = 'kindGroup';
      return item;
    }

    if (element instanceof ArtifactFileItem) {
      return getArtifactFileTreeItem(element);
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

      const isDir = isBrowsableDirectory(obs.path);

      const item = new vscode.TreeItem(
        obs.name,
        isDir ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
      );
      item.description = desc;
      item.tooltip = `Name: ${obs.name}\nKind: ${obs.kind}\nAssistant: ${obs.assistant}\nScope: ${obs.scope}\nPath: ${obs.path}\nDiscovered: ${obs.discoveredAt}${
        element.tooltipDescription ? `\nDescription: ${element.tooltipDescription}` : ''
      }${obs.match?.details ? `\nFeedback: ${obs.match.details}` : ''}`;
      item.iconPath = new vscode.ThemeIcon(iconName);
      if (!isDir) {
        item.command = {
          command: 'vscode.open',
          title: 'Open File',
          arguments: [vscode.Uri.file(obs.path)],
        };
      }

      let candidateContext = 'observedArtifactItem:none';
      if (obs.candidates && obs.candidates.length === 1) {
        candidateContext = 'observedArtifactItem:one';
      } else if (obs.candidates && obs.candidates.length > 1) {
        candidateContext = 'observedArtifactItem:many';
      }
      if (obs.match?.status) {
        candidateContext += `:${obs.match.status}`;
      }
      item.contextValue = candidateContext;
      
      return item;
    }

    if (element instanceof InstalledInstallationItem) {
      const inst = element.installation;
      const report = element.report ?? this.driftReports.get(this.getInstallKey(inst));

      let desc = `${inst.kind} [managed]`;
      if (element.isRecommended) {
        desc += ' ★';
      }
      let iconName = getKindIconName(inst.kind);

      if (report) {
        if (report.status === 'modified-locally') {
          desc = `${inst.kind} [managed, modified locally]`;
          iconName = 'diff-modified';
        } else if (report.status === 'update-available') {
          desc = `${inst.kind} [managed, update available]`;
          iconName = 'cloud-download';
        } else if (report.status === 'modified-and-update-available') {
          desc = `${inst.kind} [managed, modified & update available]`;
          iconName = 'warning';
        } else if (report.status === 'missing-on-disk') {
          desc = `${inst.kind} [managed, missing on disk]`;
          iconName = 'error';
        }
      }

      if (element.isRecommended) {
        desc += ' ★';
      }
      if (inst.held) {
        desc += ' held';
      }

      const isDir = isBrowsableDirectory(inst.path);

      const item = new vscode.TreeItem(
        inst.name,
        isDir ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
      );
      item.description = desc;
      let tooltip = `Name: ${inst.name}\nKind: ${inst.kind}\nAssistant: ${inst.assistant}\nScope: ${inst.scope}\nPath: ${inst.path}\nInstalled at: ${inst.installedAt}${
        element.tooltipDescription ? `\nDescription: ${element.tooltipDescription}` : ''
      }${report?.details ? `\nStatus: ${report.details}` : ''}${inst.sourceRevision?.commit ? `\nCommit: ${inst.sourceRevision.commit}` : ''}`;
      if (inst.held) {
        tooltip += `\nHeld: skipped by Update all`;
      }
      item.tooltip = tooltip;
      item.iconPath = new vscode.ThemeIcon(iconName);
      if (!isDir) {
        item.command = {
          command: 'vscode.open',
          title: 'Open File',
          arguments: [vscode.Uri.file(inst.path)],
        };
      }
      const baseContext = element.isRecommended ? 'installedInstallation:recommended' : 'installedInstallation';
      let ctx = report ? `${baseContext}:${report.status}` : baseContext;
      if (inst.held) {
        ctx += ':held';
      }
      item.contextValue = ctx;
      return item;
    }

    return new vscode.TreeItem('Unknown item');
  }

  async getChildren(element?: InstalledTreeItem, overrideAssistantId?: AssistantId): Promise<InstalledTreeItem[]> {
    if (element instanceof ArtifactFileItem) {
      return getArtifactFileChildren(element);
    }

    if (element instanceof InstalledInstallationItem) {
      const inst = element.installation;
      if (isBrowsableDirectory(inst.path)) {
        return listArtifactFiles(inst.path);
      }
      return [];
    }

    if (element instanceof ObservedArtifactItem) {
      const obs = element.observed;
      if (isBrowsableDirectory(obs.path)) {
        return listArtifactFiles(obs.path);
      }
      return [];
    }

    if (!element) {
      const rawInventory = await this.getRawInventory();
      const allManaged = rawInventory.allManaged.filter(
        (m) => !overrideAssistantId || m.assistant === overrideAssistantId
      );
      const allObserved = rawInventory.allObserved.filter(
        (o) => !overrideAssistantId || o.assistant === overrideAssistantId
      );

      const scopes = new Set<Scope>();
      const managedByScope = new Map<Scope, ManagedInstallation[]>();
      const observedByScope = new Map<Scope, ObservedArtifact[]>();

      for (const inst of allManaged) {
        scopes.add(inst.scope);
        const list = managedByScope.get(inst.scope) ?? [];
        list.push(inst);
        managedByScope.set(inst.scope, list);
      }
      for (const obs of allObserved) {
        scopes.add(obs.scope);
        const list = observedByScope.get(obs.scope) ?? [];
        list.push(obs);
        observedByScope.set(obs.scope, list);
      }

      const scopeGroups: ScopeGroupItem[] = [];
      for (const scope of Array.from(scopes).sort()) {
        const managed = managedByScope.get(scope) ?? [];
        const observed = observedByScope.get(scope) ?? [];
        // Use overrideAssistantId, or if somehow missing, take from the first managed/observed item or fallback
        const assistant = overrideAssistantId ?? managed[0]?.assistant ?? observed[0]?.assistant ?? 'claude-code';
        scopeGroups.push(new ScopeGroupItem(assistant, scope, getScopeLabel(scope), managed, observed));
      }

      return scopeGroups;
    }

    if (element instanceof ScopeGroupItem) {
      const recommendedSet = new Set<string>();
      if (element.scope === 'project') {
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
      }

      const items: (InstalledInstallationItem | ObservedArtifactItem)[] = [];
      for (const inst of element.managed) {
        const report = this.driftReports.get(this.getInstallKey(inst));
        const isRecommended =
          inst.scope === 'project' &&
          inst.sourceId &&
          inst.artifactId &&
          recommendedSet.has(`${inst.sourceId}:${inst.artifactId}:${inst.assistant}`);
        const desc = getArtifactDescription(inst.kind, inst.path);
        items.push(new InstalledInstallationItem(inst, report, !!isRecommended, desc));
      }
      for (const obs of element.observed) {
        const desc = getArtifactDescription(obs.kind, obs.path);
        items.push(new ObservedArtifactItem(obs, desc));
      }
      return groupByKind(items, (item) => item instanceof InstalledInstallationItem ? item.installation.kind : item.observed.kind);
    }

    if (element instanceof KindGroupItem) {
      // Return the direct items inside this KindGroupItem (the actual installations/observations)
      // They are rendered as ObservedArtifactItem or InstalledInstallationItem
      return element.items;
    }

    return [];
  }

  async checkDrift(): Promise<void> {
    this.driftReports.clear();
    const allInstallations: ManagedInstallation[] = [];
    const allSources: Source[] = [];

    try {
      const gState = await readState('global', undefined, this.homeRoot);
      allInstallations.push(...gState.installations);
      const gManifest = await readManifest('global', undefined, this.homeRoot);
      allSources.push(...gManifest.sources.map((d) => fromDesiredSource(d)));
    } catch {
      // ignore
    }

    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      const projectRoot = folders[0].uri.fsPath;
      try {
        const pState = await readState('project', projectRoot, this.homeRoot);
        allInstallations.push(...pState.installations);
        const pManifest = await readManifest('project', projectRoot, this.homeRoot);
        allSources.push(...pManifest.sources.map((d) => fromDesiredSource(d, projectRoot)));
      } catch {
        // ignore
      }
    }

    let modifiedCount = 0;
    let updateCount = 0;
    let missingCount = 0;

    const reports = await checkDriftForAll(allInstallations, allSources, this.homeRoot);

    for (const report of reports) {
      this.driftReports.set(this.getInstallKey(report.installation), report);

      if (report.status === 'modified-locally') modifiedCount++;
      if (report.status === 'update-available' || report.status === 'modified-and-update-available') updateCount++;
      if (report.status === 'missing-on-disk') missingCount++;
    }

    this.updateContextKeys(reports);
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

    await this.doUpdateInstallation(item.installation);
  }

  async holdItem(item?: InstalledInstallationItem | ManagedInstallation): Promise<void> {
    const inst = item instanceof InstalledInstallationItem ? item.installation : item;
    if (!inst) {
      vscode.window.showWarningMessage('Please select an item to hold.');
      return;
    }
    await this.setInstallationHeld(inst, true);
  }

  async releaseItem(item?: InstalledInstallationItem | ManagedInstallation): Promise<void> {
    const inst = item instanceof InstalledInstallationItem ? item.installation : item;
    if (!inst) {
      vscode.window.showWarningMessage('Please select an item to release.');
      return;
    }
    await this.setInstallationHeld(inst, false);
  }

  async setInstallationHeld(inst: ManagedInstallation, held: boolean): Promise<void> {
    await setHeld(inst, held, { homeRoot: this.homeRoot });
    this.refresh();
  }

  async toggleHeldInstallation(inst: ManagedInstallation): Promise<void> {
    await this.setInstallationHeld(inst, !inst.held);
  }

  async doUpdateInstallation(inst: ManagedInstallation): Promise<void> {
    if (!inst.sourceId) {
      vscode.window.showWarningMessage(`Cannot update "${inst.name}": no source ID recorded.`);
      return;
    }

    let source: Source | undefined;
    let projectRoot: string | undefined;

    if (inst.scope === 'project') {
      projectRoot = inst.projectPath ?? (await getWorkspaceRoot());
      if (projectRoot) {
        const pManifest = await readManifest('project', projectRoot, this.homeRoot);
        const desired = pManifest.sources.find((s) => s.id === inst.sourceId);
        if (desired) source = fromDesiredSource(desired, projectRoot);
      }
    } else {
      const gManifest = await readManifest('global', undefined, this.homeRoot);
      const desired = gManifest.sources.find((s) => s.id === inst.sourceId);
      if (desired) source = fromDesiredSource(desired);
    }

    if (!source) {
      vscode.window.showErrorMessage(`Source "${inst.sourceId}" not found in manifest.`);
      return;
    }

    const prepared = await planUpdate(inst, source, { homeRoot: this.homeRoot });

    if (!prepared.supported) {
      vscode.window.showErrorMessage(`Failed to plan update for ${inst.name}: ${prepared.plan.reason}`);
      return;
    }

    const report = this.driftReports.get(this.getInstallKey(inst)) ?? (await analyzeLocalDrift(inst, this.homeRoot));
    const isModified =
      report?.status === 'modified-locally' ||
      report?.status === 'modified-and-update-available';

    let confirmMsg = `Update ${inst.kind} "${inst.name}" to latest version from source "${source.id}"?`;
    if (inst.held) {
      confirmMsg += ` This item is held.`;
    }
    if (isModified) {
      confirmMsg += ` This item is modified locally (it will lose your edits).`;
    }

    const confirm = await vscode.window.showInformationMessage(
      confirmMsg,
      { modal: true },
      'Update'
    );
    if (confirm !== 'Update') return;

    const outcome = await applyInstall(prepared, this.homeRoot);
    if (outcome.status === 'applied') {
      vscode.window.showInformationMessage(`Successfully updated "${inst.name}".`);
      await this.checkDrift();
    } else {
      vscode.window.showErrorMessage(`Update failed: ${outcome.reason}`);
    }
  }

  async doUpdateAll(filterOrAssistant?: UpdateFilter | AssistantId): Promise<void> {
    let filter: UpdateFilter | undefined;
    if (typeof filterOrAssistant === 'string') {
      filter = { assistant: filterOrAssistant };
    } else if (filterOrAssistant && typeof filterOrAssistant === 'object') {
      filter = filterOrAssistant;
    }

    const allInstallations: ManagedInstallation[] = [];
    const allSources: Source[] = [];

    try {
      const gState = await readState('global', undefined, this.homeRoot);
      allInstallations.push(...gState.installations);
      const gManifest = await readManifest('global', undefined, this.homeRoot);
      allSources.push(...gManifest.sources.map((d) => fromDesiredSource(d)));
    } catch {
      // ignore
    }

    const folders = vscode.workspace.workspaceFolders;
    let projectRoot: string | undefined;
    if (folders && folders.length > 0) {
      projectRoot = folders[0].uri.fsPath;
      try {
        const pState = await readState('project', projectRoot, this.homeRoot);
        allInstallations.push(...pState.installations);
        const pManifest = await readManifest('project', projectRoot, this.homeRoot);
        allSources.push(...pManifest.sources.map((d) => fromDesiredSource(d, projectRoot)));
      } catch {
        // ignore
      }
    }

    // 1. Drift check once
    const reports = await checkDriftForAll(allInstallations, allSources, this.homeRoot);
    for (const report of reports) {
      this.driftReports.set(this.getInstallKey(report.installation), report);
    }
    this.updateContextKeys(reports);

    // 2. Plan update all
    const plan = await planUpdateAll({
      installations: allInstallations,
      sources: allSources,
      reports,
      filter,
      homeRoot: this.homeRoot,
      projectRoot,
    });

    const N = plan.counts.toUpdate;
    const M = plan.counts.skippedModified;
    const K = plan.counts.cannotUpdate;
    const H = plan.counts.held;

    if (N === 0 && M === 0) {
      if (K > 0 || H > 0) {
        const parts: string[] = [];
        if (H > 0) parts.push(`${H} item(s) held`);
        if (K > 0) parts.push(`${K} item(s) cannot be updated`);
        vscode.window.showInformationMessage(
          `No updates can be applied (${parts.join(', ')}).`
        );
      } else {
        vscode.window.showInformationMessage('All items are up to date.');
      }
      return;
    }

    // 3. Modal summary
    const names = plan.toUpdate.map((i) => i.installation.name);
    const namesStr = names.length > 10
      ? `${names.slice(0, 10).join(', ')}, and ${names.length - 10} more`
      : names.join(', ');

    const lines: string[] = [
      `${N} update(s) will be applied (${namesStr}).`
    ];

    if (H > 0) {
      lines.push(`${H} item(s) are held and will be skipped.`);
    }

    if (M > 0) {
      lines.push(`${M} item(s) are modified locally and will be skipped (they would lose your edits).`);
    }

    if (K > 0) {
      const reasonCounts = new Map<string, number>();
      for (const item of plan.cannotUpdate) {
        reasonCounts.set(item.reason, (reasonCounts.get(item.reason) ?? 0) + 1);
      }
      const reasonStr = Array.from(reasonCounts.entries())
        .map(([reason, count]) => `${count} ${reason}`)
        .join(', ');
      lines.push(`${K} item(s) cannot be updated (${reasonStr}).`);
    }

    const message = lines.join('\n\n');

    const btnPlain = `Update ${N}`;
    const btnModified = `Update ${N} + ${M} modified (your version is saved to the trash first)`;
    const actions: string[] = [btnPlain];
    if (M > 0) {
      actions.push(btnModified);
    }
    actions.push('Cancel');

    const choice = await vscode.window.showInformationMessage(
      message,
      { modal: true },
      ...actions
    );

    if (!choice || choice === 'Cancel') {
      return;
    }

    // 4. Determine final plan
    let finalPlan = plan;
    if (choice === btnModified) {
      finalPlan = await planUpdateAll({
        installations: allInstallations,
        sources: allSources,
        reports,
        filter,
        includeModified: true,
        homeRoot: this.homeRoot,
        projectRoot,
      });
    }

    // 5. Apply with progress
    let outcomes: UpdateItemOutcome[] = [];
    if (typeof vscode.window.withProgress === 'function') {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Updating artifacts...',
          cancellable: false,
        },
        async (progress) => {
          outcomes = await applyUpdateAll(finalPlan, {
            homeRoot: this.homeRoot,
            onProgress: (item) => {
              progress.report({ message: item.installation.name });
            },
          });
        }
      );
    } else {
      outcomes = await applyUpdateAll(finalPlan, {
        homeRoot: this.homeRoot,
      });
    }

    // 6. Compute outcome counts and final message
    const X = outcomes.filter((o) => o.status === 'applied').length;
    const Y = finalPlan.counts.skippedModified + outcomes.filter((o) => o.status === 'refused').length;
    const Z = outcomes.filter((o) => o.status === 'failed' || o.status === 'rolled-back' || o.status === 'manual-recovery-required').length + finalPlan.counts.cannotUpdate;
    const heldCount = finalPlan.counts.held;

    const summaryParts = [`Updated ${X}`, `skipped ${Y}`];
    if (heldCount > 0) {
      summaryParts.push(`${heldCount} held`);
    }
    summaryParts.push(`failed ${Z}`);

    const finalChoice = await vscode.window.showInformationMessage(
      summaryParts.join(', '),
      'Show details'
    );

    if (finalChoice === 'Show details') {
      const channel = this.getOutputChannel();
      channel.clear();
      channel.appendLine(`=== AI Swissknife Update Details ===`);
      channel.appendLine(`Updated: ${X}, Skipped: ${Y}${heldCount > 0 ? `, Held: ${heldCount}` : ''}, Failed: ${Z}\n`);
      for (const o of outcomes) {
        const scopeLabel = getScopeLabel(o.installation.scope);
        if (o.status === 'applied') {
          channel.appendLine(`✓ [APPLIED] ${o.installation.name} (${o.installation.assistant}, ${scopeLabel})`);
          if (o.backupPath) {
            channel.appendLine(`  Backup saved to: ${o.backupPath}`);
          }
          if (o.warnings && o.warnings.length > 0) {
            channel.appendLine(`  Warnings: ${o.warnings.join(', ')}`);
          }
        } else if (o.status === 'refused') {
          channel.appendLine(`- [SKIPPED] ${o.installation.name} (${o.installation.assistant}, ${scopeLabel}): ${o.reason ?? 'refused'}`);
        } else {
          channel.appendLine(`✗ [FAILED] ${o.installation.name} (${o.installation.assistant}, ${scopeLabel}): ${o.reason ?? o.status}`);
          if (o.backupPath) {
            channel.appendLine(`  Backup saved to: ${o.backupPath}`);
          }
        }
      }
      for (const item of finalPlan.held) {
        const scopeLabel = getScopeLabel(item.installation.scope);
        channel.appendLine(`- [HELD] ${item.installation.name} (${item.installation.assistant}, ${scopeLabel}): ${item.reason ?? 'held'}`);
      }
      for (const item of finalPlan.skippedModified) {
        const scopeLabel = getScopeLabel(item.installation.scope);
        channel.appendLine(`- [SKIPPED] ${item.installation.name} (${item.installation.assistant}, ${scopeLabel}): ${item.reason ?? 'modified locally'}`);
      }
      for (const item of finalPlan.cannotUpdate) {
        const scopeLabel = getScopeLabel(item.installation.scope);
        channel.appendLine(`✗ [CANNOT UPDATE] ${item.installation.name} (${item.installation.assistant}, ${scopeLabel}): ${item.reason}`);
      }
      channel.show();
    }

    // 7. ONE refresh at the end
    this.refresh();
  }

  async syncItem(item?: InstalledInstallationItem | ObservedArtifactItem): Promise<void> {
    if (!item) {
      vscode.window.showWarningMessage('Please select an item to copy / synchronize.');
      return;
    }

    const sourceItem =
      item instanceof InstalledInstallationItem ? item.installation : item.observed;

    await this.doSyncItem(sourceItem);
  }

  async doSyncItem(sourceItem: ManagedInstallation | ObservedArtifact): Promise<void> {
    const assistantPick = await vscode.window.showQuickPick(
      getEnabledAdapters().map(
        (a) => ({
          label: a.assistant,
          iconPath: new vscode.ThemeIcon(a.iconId),
        })
      ),
      {
        placeHolder: `Select target assistant to copy "${sourceItem.name}" to`,
      }
    );
    if (!assistantPick) return;
    const targetAssistant = assistantPick.label as AssistantId;

    const scopePick = await vscode.window.showQuickPick(getScopeQuickPickItems(), {
      placeHolder: `Select target scope for copied ${sourceItem.kind}`,
    });
    if (!scopePick) return;
    const targetScope = typeof scopePick === 'string' ? (scopePick as Scope) : scopePick.value;

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

    await this.doPromoteItem(item.observed);
  }

  async doPromoteItem(obs: ObservedArtifact): Promise<void> {
    const candidates = obs.candidates ?? [];
    
    if (candidates.length === 0) {
      vscode.window.showErrorMessage(`Cannot promote "${obs.name}": no known source candidates.`);
      return;
    }

    let chosenCandidate = candidates.length === 1 ? candidates[0] : undefined;

    if (candidates.length > 1) {
      const picks = candidates.map(c => ({
        label: c.sourceId ?? 'Unknown',
        description: c.status,
        candidate: c
      }));
      const picked = await vscode.window.showQuickPick(picks, {
        placeHolder: `Select source provenance for ${obs.kind} "${obs.name}"`
      });
      if (!picked) return;
      chosenCandidate = picked.candidate;
    } else {
      let confirmPrompt = `Promote unmanaged ${obs.kind} "${obs.name}" (${obs.assistant}, ${obs.scope}) to managed installation?`;
      if (chosenCandidate?.status === 'identical') {
        confirmPrompt = `Observed ${obs.kind} "${obs.name}" is identical to registered source "${chosenCandidate.sourceId}". Promote to managed installation and attach source provenance?`;
      } else if (chosenCandidate?.status === 'different') {
        confirmPrompt = `Observed ${obs.kind} "${obs.name}" differs from registered source "${chosenCandidate.sourceId}". Promote local copy to managed installation?`;
      }

      const confirm = await vscode.window.showInformationMessage(
        confirmPrompt,
        { modal: true },
        'Promote'
      );
      if (confirm !== 'Promote') return;
    }

    try {
      await promoteObservedArtifact(obs, chosenCandidate!);
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

    await this.doMoveItem(item.installation);
  }

  async doMoveItem(inst: ManagedInstallation): Promise<void> {
    if (inst.kind === 'hook' || inst.kind === 'rule') {
      vscode.window.showErrorMessage("Move isn't supported for this kind yet.");
      return;
    }

    const assistantPick = await vscode.window.showQuickPick(
      getEnabledAdapters().map(
        (a) => ({
          label: a.assistant,
          iconPath: new vscode.ThemeIcon(a.iconId),
        })
      ),
      {
        placeHolder: `Select target assistant to move "${inst.name}" to`,
      }
    );
    if (!assistantPick) return;
    const targetAssistant = assistantPick.label as AssistantId;

    const scopePick = await vscode.window.showQuickPick(getScopeQuickPickItems(), {
      placeHolder: `Select target scope for moved ${inst.kind}`,
    });
    if (!scopePick) return;
    const targetScope = typeof scopePick === 'string' ? (scopePick as Scope) : scopePick.value;

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
        await this.removeManagedInstallation(inst);
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

  /**
   * Deletes a managed installation's files (or MCP server entry) from disk
   * and drops its record from state.json. Shared by moveItem (remove the
   * origin after copying to the target) and uninstallItem.
   */
  private async removeManagedInstallation(inst: ManagedInstallation): Promise<void> {
    await uninstallInstallation(inst, {
      mode: 'soft',
      homeRoot: this.homeRoot,
      projectRoot: inst.projectPath,
    });
  }

  async uninstallItem(item?: InstalledInstallationItem): Promise<void> {
    if (!item) {
      vscode.window.showWarningMessage('Please select a managed item to uninstall.');
      return;
    }

    await this.doUninstallItem(item.installation);
  }

  async doUninstallItem(inst: ManagedInstallation): Promise<void> {
    const isMissing = !fs.existsSync(inst.path);
    const confirmPrompt = isMissing
      ? `Remove missing ${inst.kind} "${inst.name}" from ${inst.assistant} (${inst.scope})? This drops its record from the registry.`
      : `Uninstall ${inst.kind} "${inst.name}" from ${inst.assistant} (${inst.scope})? This deletes it from disk.`;
    const actionLabel = isMissing ? 'Remove' : 'Uninstall';

    const confirm = await vscode.window.showInformationMessage(
      confirmPrompt,
      { modal: true },
      actionLabel
    );
    if (confirm !== actionLabel) return;

    try {
      await this.removeManagedInstallation(inst);
      vscode.window.showInformationMessage(
        `${isMissing ? 'Removed' : 'Uninstalled'} "${inst.name}" from ${inst.assistant} (${inst.scope}).`
      );
      this.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to ${isMissing ? 'remove' : 'uninstall'} "${inst.name}": ${msg}`);
    }
  }

  async doRemoveObservedItem(obs: ObservedArtifact): Promise<void> {
    const confirmPrompt = `Remove unmanaged ${obs.kind} "${obs.name}" from ${obs.assistant} (${obs.scope})?`;
    const choice = await vscode.window.showWarningMessage(
      confirmPrompt,
      { modal: true },
      'Move to Trash',
      'Delete Permanently'
    );
    if (!choice) return;

    try {
      if (choice === 'Move to Trash') {
        const { softDeletePath } = await import('../engine/softDelete');
        await softDeletePath(
          obs.path,
          obs.kind,
          obs.name,
          obs.scope,
          obs.projectPath,
          this.homeRoot,
          { assistant: obs.assistant }
        );
        vscode.window.showInformationMessage(
          `Moved "${obs.name}" to trash. It can be restored anytime.`
        );
      } else {
        await fs.promises.rm(obs.path, { recursive: true, force: true });
        vscode.window.showInformationMessage(
          `Permanently deleted "${obs.name}" from ${obs.assistant}.`
        );
      }
      this.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to remove "${obs.name}": ${msg}`);
    }
  }

  async diffAgainstOriginal(item?: InstalledInstallationItem | ObservedArtifactItem): Promise<void> {
    if (!item) {
      vscode.window.showWarningMessage('Please select an item to diff.');
      return;
    }

    const sourceItem = item instanceof InstalledInstallationItem ? item.installation : item.observed;
    await this.doDiffAgainstOriginal(sourceItem);
  }

  async doDiffAgainstOriginal(item: ManagedInstallation | ObservedArtifact): Promise<void> {
    let sourceId: string | undefined;
    let artifactId: string | undefined;
    let assistant: AssistantId;
    let scope: Scope;
    let projectRoot: string | undefined;
    let kind: ItemKind;
    let name: string;
    let localDiskPath: string;

    if ('installedAt' in item) {
      const inst = item;
      sourceId = inst.sourceId;
      artifactId = inst.artifactId;
      assistant = inst.assistant;
      scope = inst.scope;
      projectRoot = inst.projectPath;
      kind = inst.kind;
      name = inst.name;
      localDiskPath = inst.path;
    } else {
      const obs = item;
      if (obs.match?.status === 'different') {
        sourceId = obs.match.sourceId;
        artifactId = obs.match.artifactId;
      }
      assistant = obs.assistant;
      scope = obs.scope;
      projectRoot = obs.projectPath;
      kind = obs.kind;
      name = obs.name;
      localDiskPath = obs.path;
    }

    if (!sourceId) {
      vscode.window.showWarningMessage('No known source to diff against.');
      return;
    }

    let source: Source | undefined;
    if (scope === 'project') {
      const pRoot = projectRoot ?? await getWorkspaceRoot();
      if (pRoot) {
        try {
          const pManifest = await readManifest('project', pRoot);
          const desired = pManifest.sources.find((s) => s.id === sourceId);
          if (desired) source = fromDesiredSource(desired, pRoot);
        } catch { /* ignore */ }
      }
    }
    if (!source) {
      try {
        const gManifest = await readManifest('global');
        const desired = gManifest.sources.find((s) => s.id === sourceId);
        if (desired) source = fromDesiredSource(desired);
      } catch { /* ignore */ }
    }

    if (!source) {
      vscode.window.showErrorMessage(`Source "${sourceId}" not found in manifest.`);
      return;
    }

    let resolution;
    try {
      const { getSourceResolver } = await import('../sources/registry');
      const resolver = getSourceResolver(source.type);
      resolution = await resolver.resolve(source);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to resolve source: ${msg}`);
      return;
    }

    if (!resolution) return;

    let foundPkg;
    let foundArt;
    for (const pkg of resolution.packages) {
      for (const art of pkg.artifacts) {
        if (
          (artifactId && art.id === artifactId) ||
          (!artifactId && art.kind === kind && art.name === name)
        ) {
          foundPkg = pkg;
          foundArt = art;
          break;
        }
      }
      if (foundArt) break;
    }

    if (!foundPkg || !foundArt) {
      vscode.window.showErrorMessage(`Artifact not found in source "${sourceId}".`);
      return;
    }

    let translated;
    try {
      const { resolveAndTranslate } = await import('../engine/plan');
      const result = await resolveAndTranslate(source, foundPkg, foundArt, assistant);
      translated = result.translated;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to translate original content: ${msg}`);
      return;
    }

    let originalContentStr = '';
    let localUri: vscode.Uri | undefined;
    const title = `${name} (Original ↔ Local)`;
    const id = `${assistant}-${kind}-${name}-diff-${Date.now()}`;
    
    if (kind === 'skill') {
      const skill = translated as import('../adapters/types').CanonicalSkill;
      const { serializeSkillMarkdown } = await import('../adapters/claude');
      originalContentStr = serializeSkillMarkdown(skill);
      localUri = vscode.Uri.file(path.join(localDiskPath, 'SKILL.md'));
      
      const { readSkill } = await import('../adapters/codec');
      try {
        const localSkill = await readSkill(localDiskPath);
        const originalResourceHashes = new Map(skill.files.map(f => [f.path, crypto.createHash('sha256').update(f.content).digest('hex')]));
        const diffFiles: string[] = [];
        for (const lf of localSkill.files) {
          const lHash = crypto.createHash('sha256').update(lf.content).digest('hex');
          if (originalResourceHashes.get(lf.path) !== lHash) {
             diffFiles.push(lf.path);
          }
        }
        for (const of of skill.files) {
          if (!localSkill.files.find(f => f.path === of.path)) diffFiles.push(of.path);
        }
        if (diffFiles.length > 0) {
          vscode.window.showInformationMessage(`Note: Resource files also differ (${diffFiles.join(', ')})`);
        }
      } catch { /* ignore */ }

    } else if (kind === 'agent') {
      const agent = translated as import('../adapters/types').CanonicalAgent;
      const { serializeKiloAgentMarkdown } = await import('../adapters/kilo');
      const { serializeClaudeAgentMarkdown } = await import('../adapters/claude');
      originalContentStr = assistant === 'kilo-code' ? serializeKiloAgentMarkdown(agent) : serializeClaudeAgentMarkdown(agent);
      localUri = vscode.Uri.file(localDiskPath);
    } else if (kind === 'command') {
      const cmd = translated as import('../adapters/types').CanonicalCommand;
      const { serializeKiloCommandMarkdown } = await import('../adapters/kilo');
      const { serializeClaudeCommandMarkdown } = await import('../adapters/claude');
      originalContentStr = assistant === 'kilo-code' ? serializeKiloCommandMarkdown(cmd) : serializeClaudeCommandMarkdown(cmd);
      localUri = vscode.Uri.file(localDiskPath);
    } else if (kind === 'rule') {
      const rule = translated as import('../adapters/types').CanonicalRule;
      const markerStart = `<!-- ai-swissknife:managed:${sourceId} -->`;
      const markerEnd = '<!-- /ai-swissknife:managed -->';
      originalContentStr = `${markerStart}\n${rule.content.trim()}\n${markerEnd}\n`;
      
      try {
         const localFullContent = fs.readFileSync(localDiskPath, 'utf-8');
         const markerRegex = new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`);
         const match = localFullContent.match(markerRegex);
         const localBlockContentStr = match ? match[0] + '\n' : '';
         const { previewProvider } = await import('./previewProvider');
         const localId = `local-${id}`;
         localUri = previewProvider.setDiffContent(localId, localBlockContentStr, '.md');
      } catch {
         localUri = vscode.Uri.file(localDiskPath);
      }
    } else if (kind === 'mcp-server') {
       const mcp = translated as import('../adapters/types').CanonicalMcpServer;
       originalContentStr = JSON.stringify(mcp, null, 2);
       try {
         const adapter = getAdapter(assistant);
         
         if (adapter && adapter.readMcpServer) {
           const localMcp = await adapter.readMcpServer(name, { scope, projectRoot });
           const localMcpStr = localMcp ? JSON.stringify(localMcp, null, 2) : '';
           const { previewProvider } = await import('./previewProvider');
           const localId = `local-${id}`;
           localUri = previewProvider.setDiffContent(localId, localMcpStr, '.json');
         } else {
           localUri = vscode.Uri.file(localDiskPath);
         }
       } catch {
          localUri = vscode.Uri.file(localDiskPath);
       }
    } else if (kind === 'hook') {
      const hook = translated as import('../adapters/types').CanonicalHook;
      const payload = {
        event: hook.event,
        command: hook.command,
        ...(hook.timeout ? { timeout: hook.timeout } : {}),
        ...hook.extraFields,
      };
      originalContentStr = JSON.stringify(payload, null, 2) + '\n';
      localUri = vscode.Uri.file(localDiskPath);
    } else {
      originalContentStr = 'Unknown kind.';
      localUri = vscode.Uri.file(localDiskPath);
    }

    const { previewProvider } = await import('./previewProvider');
    const ext = (kind === 'mcp-server' || kind === 'hook') ? '.json' : '.md';
    const originalUri = previewProvider.setDiffContent(`orig-${id}`, originalContentStr, ext);

    if (!localUri) return;
    await vscode.commands.executeCommand('vscode.diff', originalUri, localUri, title);
  }

  private getInstallKey(inst: ManagedInstallation): string {
    return getIdentityKey(inst);
  }
}

/**
 * Composite identity key for managed installations and observed artifacts.
 * We add this as a new exported helper rather than just modifying the private
 * getInstallKey so that DashboardPanel can use the exact same logic, ensuring
 * keys don't drift between the sidebar tree and the webview. We include kind
 * so that artifacts with the same name but different kinds (e.g. skill vs agent)
 * don't collide.
 */
export function getIdentityKey(item: { assistant: AssistantId; scope: Scope; kind: ItemKind; name: string; projectPath?: string }): string {
  return `${item.assistant}:${item.scope}:${item.kind}:${item.projectPath ?? ''}:${item.name}`;
}

export class AssistantTreeDataProvider implements vscode.TreeDataProvider<InstalledTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<InstalledTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<InstalledTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  constructor(
    private readonly provider: InstalledTreeDataProvider,
    private readonly assistantId: AssistantId
  ) {
    this.provider.onDidChangeTreeData(e => this._onDidChangeTreeData.fire(e));
  }

  getTreeItem(element: InstalledTreeItem): vscode.TreeItem {
    return this.provider.getTreeItem(element);
  }

  getChildren(element?: InstalledTreeItem): vscode.ProviderResult<InstalledTreeItem[]> {
    return this.provider.getChildren(element, this.assistantId);
  }
}
