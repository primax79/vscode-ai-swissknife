import * as path from 'path';
import * as vscode from 'vscode';
import type { Source, Package, Artifact, AssistantId, Scope, ManagedInstallation } from '../domain/types';
import type { DetectionDiagnostic, SourceResolution } from '../sources/types';
import { readManifest, fromDesiredSource } from '../domain/registry';
import { getSourceResolver } from '../sources/registry';
import { getAdapter, getEnabledAdapters } from '../adapters/registry';
import { planInstall } from '../engine/plan';
import { applyInstall } from '../engine/apply';
import type { PreparedInstall } from '../engine/types';
import { getWorkspaceRoot } from './workspacePicker';
import { getKindIconName } from './kindIcons';
import { getScopeQuickPickItems } from './scopeIcons';
import { previewProvider } from './previewProvider';
import type { SourceItem } from './sourcesView';
import {
  ArtifactFileItem,
  getArtifactFileChildren,
  getArtifactFileTreeItem,
  getArtifactRootChildren,
  hasArtifactRootChildren,
  openArtifactFile,
  resolveArtifactPreviewPath,
} from './artifactFileTree';

import { resolveRecommendations, SourceResolutionAttempt, BrokenReason } from '../engine/recommendations';
import type { DesiredInstallation } from '../domain/registry';
import { readState } from '../domain/registry';

export type AvailableTreeItem =
  | AvailableSourceGroupItem
  | AvailableFolderItem
  | AvailableArtifactItem
  | DiagnosticTreeItem
  | RecommendedGroupItem
  | RecommendedBrokenItem
  | ArtifactFileItem;

export class RecommendedGroupItem {
  constructor(
    public readonly pending: { desired: DesiredInstallation; artifact: Artifact; pkg: Package; source: Source }[],
    public readonly broken: { desired: DesiredInstallation; reason: BrokenReason }[]
  ) {}
}

export class RecommendedBrokenItem {
  constructor(
    public readonly desired: DesiredInstallation,
    public readonly reason: BrokenReason
  ) {}
}

export class AvailableSourceGroupItem {
  constructor(
    public readonly source: Source,
    public readonly resolution: SourceResolution
  ) {}
}

export class AvailableFolderItem {
  constructor(
    public readonly source: Source,
    public readonly folderPath: string,
    public readonly label: string,
    public readonly items: Array<AvailableFolderItem | AvailableArtifactItem>
  ) {}

  getAllArtifacts(): AvailableArtifactItem[] {
    const result: AvailableArtifactItem[] = [];
    for (const child of this.items) {
      if (child instanceof AvailableArtifactItem) {
        result.push(child);
      } else if (child instanceof AvailableFolderItem) {
        result.push(...child.getAllArtifacts());
      }
    }
    return result;
  }
}

export class AvailableArtifactItem {
  constructor(
    public readonly source: Source,
    public readonly pkg: Package,
    public readonly artifact: Artifact,
    public readonly isRecommended?: boolean
  ) {}
}

export class DiagnosticTreeItem {
  constructor(public readonly diagnostic: DetectionDiagnostic) {}
}

interface RawTreeNode {
  segment: string;
  folders: Map<string, RawTreeNode>;
  artifacts: AvailableArtifactItem[];
}

export function buildHierarchy(
  source: Source,
  packages: Package[],
  recommendedSet?: Set<string>
): Array<AvailableFolderItem | AvailableArtifactItem> {
  const rootNode: RawTreeNode = {
    segment: '',
    folders: new Map(),
    artifacts: [],
  };

  for (const pkg of packages) {
    const prefix = `${source.id}:`;
    const pathId = pkg.id.startsWith(prefix) ? pkg.id.slice(prefix.length) : pkg.id;
    const normalized = pathId.split(path.sep).join('/');
    const parts = normalized.split('/').filter(Boolean);

    const folderParts = parts.length > 1 ? parts.slice(0, -1) : [];

    let current = rootNode;
    for (const part of folderParts) {
      if (!current.folders.has(part)) {
        current.folders.set(part, {
          segment: part,
          folders: new Map(),
          artifacts: [],
        });
      }
      current = current.folders.get(part)!;
    }

    for (const art of pkg.artifacts) {
      const isRecommended = recommendedSet?.has(`${source.id}:${art.id}`);
      current.artifacts.push(new AvailableArtifactItem(source, pkg, art, isRecommended));
    }
  }

  function convertNode(
    node: RawTreeNode,
    parentPath: string
  ): Array<AvailableFolderItem | AvailableArtifactItem> {
    const result: Array<AvailableFolderItem | AvailableArtifactItem> = [];

    for (const [segment, childNode] of node.folders.entries()) {
      let compactedSegment = segment;
      let targetNode = childNode;

      while (targetNode.folders.size === 1 && targetNode.artifacts.length === 0) {
        const [nextSegment, nextNode] = targetNode.folders.entries().next().value as [string, RawTreeNode];
        compactedSegment = `${compactedSegment}/${nextSegment}`;
        targetNode = nextNode;
      }

      const currentFolderPath = parentPath
        ? `${parentPath}/${compactedSegment}`
        : compactedSegment;
      const childItems = convertNode(targetNode, currentFolderPath);
      childItems.push(...targetNode.artifacts);

      result.push(
        new AvailableFolderItem(
          source,
          currentFolderPath,
          compactedSegment,
          childItems
        )
      );
    }

    return result;
  }

  const converted = convertNode(rootNode, '');
  converted.push(...rootNode.artifacts);
  return converted;
}

export class AvailableTreeDataProvider
  implements vscode.TreeDataProvider<AvailableTreeItem>
{
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly homeRoot?: string
  ) {}

  private _onDidChangeTreeData = new vscode.EventEmitter<
    AvailableTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData: vscode.Event<
    AvailableTreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  private cachedSourceGroups: AvailableSourceGroupItem[] = [];
  private cachedRecommendedGroup?: RecommendedGroupItem;
  private installedByArtifactKey = new Map<string, AssistantId[]>();
  private onInstalledRefreshCallback?: () => void;
  private refreshInFlight?: Promise<void>;
  private sources: Source[] = [];
  private resolutionAttempts = new Map<string, SourceResolutionAttempt>();
  private sourceRefreshInFlight = new Map<string, Promise<void>>();
  private loadingSources = new Set<string>();

  isSourceLoading(sourceId: string, scope: Scope): boolean {
    return this.loadingSources.has(`${scope}:${sourceId}`);
  }

  isRefreshing(): boolean {
    return this.refreshInFlight !== undefined;
  }

  setInstalledRefreshCallback(cb: () => void) {
    this.onInstalledRefreshCallback = cb;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getCachedSourceGroups(): AvailableSourceGroupItem[] {
    return this.cachedSourceGroups;
  }

  getCachedRecommendedGroup(): RecommendedGroupItem | undefined {
    return this.cachedRecommendedGroup;
  }

  async ensureCatalogLoaded(): Promise<void> {
    if (this.cachedSourceGroups.length === 0 && !this.cachedRecommendedGroup) {
      await this.refreshCatalog();
    }
  }

  private indexInstalledByArtifact(installations: ManagedInstallation[]): void {
    for (const inst of installations) {
      if (!inst.sourceId || !inst.artifactId) continue;
      const key = `${inst.sourceId}:${inst.artifactId}`;
      const list = this.installedByArtifactKey.get(key) ?? [];
      if (!list.includes(inst.assistant)) {
        list.push(inst.assistant);
      }
      this.installedByArtifactKey.set(key, list);
    }
  }

  getInstalledAssistants(sourceId: string, artifactId: string): AssistantId[] {
    return this.installedByArtifactKey.get(`${sourceId}:${artifactId}`) ?? [];
  }

  /**
   * Deduped: a concurrent caller while a resolve is already in flight awaits
   * that same run instead of starting a second, independent one — without
   * this, a slow/hung source (e.g. an SSH auth hang) left a window where
   * every re-render of the tree kicked off its own full resolve, each
   * looping through every source independently.
   */
  async refreshCatalog(): Promise<void> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }
    this.refreshInFlight = this.doRefreshCatalog();
    try {
      await this.refreshInFlight;
    } finally {
      this.refreshInFlight = undefined;
    }
  }

  private async doRefreshCatalog(): Promise<void> {
    this.cachedSourceGroups = [];
    this.cachedRecommendedGroup = undefined;
    this.installedByArtifactKey = new Map();

    try {
      const globalState = await readState('global', undefined, this.homeRoot);
      this.indexInstalledByArtifact(globalState.installations);
    } catch {
      // ignore
    }
    const installedFolders = vscode.workspace.workspaceFolders;
    if (installedFolders && installedFolders.length > 0) {
      try {
        const projectState = await readState('project', installedFolders[0].uri.fsPath);
        this.indexInstalledByArtifact(projectState.installations);
      } catch {
        // ignore
      }
    }

    this.sources = await this.loadSources();
    this.resolutionAttempts = new Map<string, SourceResolutionAttempt>();

    try {
      for (const src of this.sources) {
        const key = `${src.scope}:${src.id}`;
        this.loadingSources.add(key);
        this.refresh();
        try {
          const { group, attempt } = await this.resolveSourceGroup(src);
          this.cachedSourceGroups.push(group);
          this.resolutionAttempts.set(src.id, attempt);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.cachedSourceGroups.push(
            new AvailableSourceGroupItem(src, {
              packages: [],
              diagnostics: [
                {
                  code: 'unreadable-skill',
                  severity: 'error',
                  path: src.url ?? src.localPath ?? src.id,
                  message: `Failed to resolve source: ${msg}`,
                },
              ],
            })
          );
          this.resolutionAttempts.set(src.id, { status: 'failed', source: src, error: msg });
        } finally {
          this.loadingSources.delete(key);
        }
        this.refresh();
      }
    } finally {
      this.loadingSources.clear();
    }

    await this.recomputeRecommendedGroup();

    this.refresh();
  }

  private async loadSources(): Promise<Source[]> {
    const sources: Source[] = [];

    // Load global sources
    try {
      const globalManifest = await readManifest('global', undefined, this.homeRoot);
      for (const d of globalManifest.sources) {
        sources.push(fromDesiredSource(d));
      }
    } catch {
      // ignore
    }

    // Load project sources if workspace is open
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      const projectRoot = folders[0].uri.fsPath;
      try {
        const projectManifest = await readManifest('project', projectRoot);
        for (const d of projectManifest.sources) {
          sources.push(fromDesiredSource(d, projectRoot));
        }
      } catch {
        // ignore
      }
    }

    return sources;
  }

  private async resolveSourceGroup(
    src: Source
  ): Promise<{ group: AvailableSourceGroupItem; attempt: SourceResolutionAttempt }> {
    try {
      const resolver = getSourceResolver(src.type);
      const resolution: SourceResolution = await resolver.resolve(src, { homeRoot: this.homeRoot });
      return {
        group: new AvailableSourceGroupItem(src, resolution),
        attempt: { status: 'resolved', source: src, packages: resolution.packages },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        group: new AvailableSourceGroupItem(src, {
          packages: [],
          diagnostics: [
            {
              code: 'unreadable-skill',
              severity: 'error',
              path: src.url ?? src.localPath ?? src.id,
              message: `Failed to resolve source: ${msg}`,
            },
          ],
        }),
        attempt: { status: 'failed', source: src, error: msg },
      };
    }
  }

  private async recomputeRecommendedGroup(): Promise<void> {
    this.cachedRecommendedGroup = undefined;
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      const projectRoot = folders[0].uri.fsPath;
      try {
        const projectManifest = await readManifest('project', projectRoot);
        const projectState = await readState('project', projectRoot);
        const desired = projectManifest.desiredInstallations;
        if (desired.length > 0) {
          const resolved = resolveRecommendations(
            desired,
            projectState.installations,
            this.sources,
            this.resolutionAttempts
          );
          if (resolved.pending.length > 0 || resolved.broken.length > 0) {
            this.cachedRecommendedGroup = new RecommendedGroupItem(resolved.pending, resolved.broken);
          }
        }
      } catch {
        // ignore
      }
    }
  }

  async refreshSource(sourceId: string, scope: Scope): Promise<void> {
    const key = `${scope}:${sourceId}`;
    const inFlight = this.sourceRefreshInFlight.get(key);
    if (inFlight) {
      return inFlight;
    }

    const promise = this.doRefreshSource(sourceId, scope);
    this.sourceRefreshInFlight.set(key, promise);
    try {
      await promise;
    } finally {
      this.sourceRefreshInFlight.delete(key);
    }
  }

  private async doRefreshSource(sourceId: string, scope: Scope): Promise<void> {
    while (this.refreshInFlight) {
      await this.refreshInFlight;
    }

    const run = async () => {
      const key = `${scope}:${sourceId}`;
      this.loadingSources.add(key);
      this.refresh();

      try {
        const freshSources = await this.loadSources();
        this.sources = freshSources;

        const matchingSource = freshSources.find(
          (s) => s.id === sourceId && s.scope === scope
        );

        if (!matchingSource) {
          const groupIndex = this.cachedSourceGroups.findIndex(
            (g) => g.source.id === sourceId && g.source.scope === scope
          );
          if (groupIndex !== -1) {
            this.cachedSourceGroups.splice(groupIndex, 1);
          }

          const remainingSource = freshSources.find((s) => s.id === sourceId);
          if (remainingSource) {
            const remainingGroup = this.cachedSourceGroups.find(
              (g) => g.source.id === sourceId && g.source.scope === remainingSource.scope
            );
            if (remainingGroup) {
              if (
                remainingGroup.resolution.diagnostics.length > 0 &&
                remainingGroup.resolution.packages.length === 0
              ) {
                this.resolutionAttempts.set(sourceId, {
                  status: 'failed',
                  source: remainingSource,
                  error: remainingGroup.resolution.diagnostics[0]?.message ?? 'Failed to resolve source',
                });
              } else {
                this.resolutionAttempts.set(sourceId, {
                  status: 'resolved',
                  source: remainingSource,
                  packages: remainingGroup.resolution.packages,
                });
              }
            } else {
              this.resolutionAttempts.delete(sourceId);
            }
          } else {
            this.resolutionAttempts.delete(sourceId);
          }

          await this.recomputeRecommendedGroup();
          return;
        }

        try {
          const { group, attempt } = await this.resolveSourceGroup(matchingSource);

          const groupIndex = this.cachedSourceGroups.findIndex(
            (g) => g.source.id === sourceId && g.source.scope === scope
          );
          if (groupIndex !== -1) {
            this.cachedSourceGroups[groupIndex] = group;
          } else {
            this.cachedSourceGroups.push(group);
          }

          this.resolutionAttempts.set(sourceId, attempt);
          await this.recomputeRecommendedGroup();
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          const failGroup = new AvailableSourceGroupItem(matchingSource, {
            packages: [],
            diagnostics: [
              {
                code: 'unreadable-skill',
                severity: 'error',
                path: matchingSource.url ?? matchingSource.localPath ?? matchingSource.id,
                message: `Failed to resolve source: ${msg}`,
              },
            ],
          });
          const groupIndex = this.cachedSourceGroups.findIndex(
            (g) => g.source.id === sourceId && g.source.scope === scope
          );
          if (groupIndex !== -1) {
            this.cachedSourceGroups[groupIndex] = failGroup;
          } else {
            this.cachedSourceGroups.push(failGroup);
          }
          this.resolutionAttempts.set(sourceId, { status: 'failed', source: matchingSource, error: msg });
          await this.recomputeRecommendedGroup();
        }
      } finally {
        this.loadingSources.delete(key);
        this.refresh();
      }
    };

    if (typeof vscode.window.withProgress === 'function') {
      await vscode.window.withProgress(
        { location: { viewId: 'aiSwissknife.sources' } },
        run
      );
    } else if (typeof vscode.window.setStatusBarMessage === 'function') {
      const msg = vscode.window.setStatusBarMessage(`Refreshing source ${sourceId}...`);
      try {
        await run();
      } finally {
        msg?.dispose();
      }
    } else {
      await run();
    }
  }

  getTreeItem(element: AvailableTreeItem): vscode.TreeItem {
    if (element instanceof RecommendedGroupItem) {
      const item = new vscode.TreeItem('Recommended', vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon('star');
      item.description = `${element.pending.length} pending, ${element.broken.length} broken`;
      item.contextValue = 'recommendedGroup';
      return item;
    }

    if (element instanceof RecommendedBrokenItem) {
      const item = new vscode.TreeItem(element.desired.artifactId, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('error');
      
      let reasonText = '';
      if (element.reason.kind === 'source-not-registered') {
        reasonText = 'Source not registered';
      } else if (element.reason.kind === 'source-resolution-failed') {
        reasonText = `Resolution failed (${element.reason.error})`;
      } else {
        reasonText = 'Artifact not found in source';
      }
      
      item.description = `${reasonText} [${element.desired.assistant}]`;
      item.tooltip = `Source: ${element.desired.sourceId}\nReason: ${reasonText}`;
      item.contextValue = 'recommendedBroken';
      return item;
    }

    if (element instanceof AvailableSourceGroupItem) {
      const source = element.source;
      if (this.isSourceLoading(source.id, source.scope)) {
        const item = new vscode.TreeItem(
          source.name ?? source.id,
          vscode.TreeItemCollapsibleState.Expanded
        );
        item.description = 'Refreshing...';
        item.iconPath = new vscode.ThemeIcon('sync~spin');
        item.contextValue = 'availableSourceGroup';
        return item;
      }
      const count = element.resolution.packages.length;
      const diagCount = element.resolution.diagnostics.length;
      const item = new vscode.TreeItem(
        source.name ?? source.id,
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.description = `${count} item(s)${diagCount > 0 ? ` [${diagCount} diagnostic(s)]` : ''}`;
      item.contextValue = 'availableSourceGroup';
      return item;
    }

    if (element instanceof AvailableFolderItem) {
      const allArts = element.getAllArtifacts();
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      item.description = `${allArts.length} item(s)`;
      item.contextValue = 'availableFolder';
      item.iconPath = new vscode.ThemeIcon('folder');
      item.tooltip = `Folder: ${element.folderPath}\nContains ${allArts.length} item(s)`;
      return item;
    }

    if (element instanceof DiagnosticTreeItem) {
      const diag = element.diagnostic;
      const item = new vscode.TreeItem(
        `[${diag.code}] ${diag.message}`,
        vscode.TreeItemCollapsibleState.None
      );
      item.description = diag.path;
      item.iconPath = new vscode.ThemeIcon(
        diag.severity === 'error' ? 'error' : 'warning'
      );
      item.tooltip = `${diag.severity.toUpperCase()}: ${diag.message}\nPath: ${diag.path}`;
      return item;
    }

    if (element instanceof ArtifactFileItem) {
      return getArtifactFileTreeItem(element);
    }

    const artifact = element.artifact;
    const installedIn = this.getInstalledAssistants(element.source.id, artifact.id);
    const isExpandable = hasArtifactRootChildren(artifact.path);
    const item = new vscode.TreeItem(
      artifact.name,
      isExpandable ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );
    const descriptionParts: string[] = [];
    if (installedIn.length > 0) {
      descriptionParts.push(`installed: ${installedIn.join(', ')}`);
    }
    if (artifact.description) {
      descriptionParts.push(artifact.description);
    }
    let description = descriptionParts.join(' — ');
    if (element.isRecommended) {
      description = `${description} ★`.trim();
    }
    item.description = description || undefined;
    item.tooltip = `Kind: ${artifact.kind}\nSource: ${element.source.id}\nPackage: ${element.pkg.id}${
      artifact.description ? `\nDescription: ${artifact.description}` : ''
    }${installedIn.length > 0 ? `\nInstalled in: ${installedIn.join(', ')}` : ''}`;
    item.contextValue = element.isRecommended ? 'availableArtifact:recommended' : 'availableArtifact';
    item.iconPath = new vscode.ThemeIcon(getKindIconName(artifact.kind));
    item.command = {
      command: 'aiSwissknife.previewAvailableArtifact',
      title: `Preview ${artifact.kind}`,
      arguments: [element],
    };
    return item;
  }

  async getChildren(element?: AvailableTreeItem): Promise<AvailableTreeItem[]> {
    if (!element) {
      if (!this.refreshInFlight) {
        await this.ensureCatalogLoaded();
      }
      const children: AvailableTreeItem[] = [];
      if (this.cachedRecommendedGroup) {
        children.push(this.cachedRecommendedGroup);
      }
      children.push(...this.cachedSourceGroups);
      return children;
    }

    if (element instanceof RecommendedGroupItem) {
      const children: AvailableTreeItem[] = [];
      for (const p of element.pending) {
        children.push(new AvailableArtifactItem(p.source, p.pkg, p.artifact, true));
      }
      for (const b of element.broken) {
        children.push(new RecommendedBrokenItem(b.desired, b.reason));
      }
      return children;
    }

    if (element instanceof AvailableSourceGroupItem) {
      const children: AvailableTreeItem[] = [];

      for (const diag of element.resolution.diagnostics) {
        children.push(new DiagnosticTreeItem(diag));
      }

      const recommendedSet = new Set<string>();
      if (element.source.scope === 'project') {
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
          try {
            const manifest = await readManifest('project', folders[0].uri.fsPath);
            for (const d of manifest.desiredInstallations) {
              if (d.sourceId === element.source.id) {
                recommendedSet.add(`${d.sourceId}:${d.artifactId}`);
              }
            }
          } catch {
            // ignore
          }
        }
      }

      const hierarchy = buildHierarchy(element.source, element.resolution.packages, recommendedSet);
      children.push(...hierarchy);

      return children;
    }

    if (element instanceof AvailableFolderItem) {
      return element.items;
    }

    if (element instanceof ArtifactFileItem) {
      return getArtifactFileChildren(element);
    }

    if (element instanceof AvailableArtifactItem) {
      // Files from local-folder sources are the user's own, editable copy;
      // everything else (git-*, remote-url) lives in a replaceable local
      // clone/cache, so it's browsed read-only.
      const readonly = element.source.type !== 'local-folder';
      return getArtifactRootChildren(element.artifact.path, readonly);
    }

    return [];
  }

  async previewArtifact(item?: AvailableArtifactItem): Promise<void> {
    if (!item) {
      vscode.window.showWarningMessage('Please select an available item to preview.');
      return;
    }

    const previewPath = resolveArtifactPreviewPath(item.artifact.path, item.artifact.kind);
    if (!previewPath) {
      vscode.window.showWarningMessage(`No local file to preview for "${item.artifact.name}".`);
      return;
    }

    const readonly = item.source.type !== 'local-folder';
    await openArtifactFile(previewPath, readonly);
  }

  async installArtifact(item?: AvailableArtifactItem): Promise<void> {
    if (!item) {
      vscode.window.showWarningMessage('Please select an available item to install.');
      return;
    }

    const { source, pkg, artifact } = item;

    const assistantPick = await vscode.window.showQuickPick(
      getEnabledAdapters().map(
        (adapter) => ({
          label: adapter.assistant,
          iconPath: new vscode.ThemeIcon(adapter.iconId),
        })
      ),
      {
        placeHolder: 'Select target AI assistant',
      }
    );
    if (!assistantPick) return;
    const targetAssistant = assistantPick.label as AssistantId;
    const targetAdapter = getAdapter(targetAssistant);

    const scopePick = await vscode.window.showQuickPick(getScopeQuickPickItems(), {
      placeHolder: 'Select installation scope',
    });
    if (!scopePick) return;
    const targetScope = (typeof scopePick === 'string' ? scopePick : scopePick.value) as Scope;

    let projectRoot: string | undefined;
    if (targetScope === 'project') {
      projectRoot = await getWorkspaceRoot();
      if (!projectRoot) return;
    }

    const prepared = await planInstall({
      source,
      pkg,
      artifact,
      targetAdapter,
      targetScope,
      projectRoot,
    });

    if (!prepared.supported) {
      vscode.window.showErrorMessage(`Cannot install ${artifact.kind}: ${prepared.plan.reason}`);
      return;
    }

    const plan = prepared.plan;
    const itemName = prepared.kind === 'mcp-server' ? prepared.content.id : (prepared.content.name ?? 'unnamed');

    if (plan.conflict) {
      let conflictChoice: string | undefined;
      let promptUser = true;
      while (promptUser) {
        conflictChoice = await vscode.window.showWarningMessage(
          `${artifact.kind} "${itemName}" already exists at "${plan.targetDir}". Overwrite existing installation?`,
          { modal: true },
          'Preview',
          'Overwrite'
        );
        if (conflictChoice === 'Preview') {
          await this.showPreview(prepared, itemName);
          continue;
        }
        promptUser = false;
      }
      if (conflictChoice !== 'Overwrite') {
        return;
      }
    } else {
      let confirmChoice: string | undefined;
      let promptUser = true;
      while (promptUser) {
        const confirmMessage = `Install ${artifact.kind} "${itemName}" to ${targetAssistant} (${targetScope})?\nTarget path: ${plan.targetDir}\nFiles proposed: ${plan.proposedFiles.length} file(s)`;
        confirmChoice = await vscode.window.showInformationMessage(
          confirmMessage,
          { modal: true },
          'Preview',
          'Install'
        );
        if (confirmChoice === 'Preview') {
          await this.showPreview(prepared, itemName);
          continue;
        }
        promptUser = false;
      }

      if (confirmChoice !== 'Install') {
        return;
      }
    }

    const outcome = await applyInstall(prepared);

    switch (outcome.status) {
      case 'applied': {
        let msg = `Successfully installed "${itemName}" to ${targetAssistant} (${targetScope}).`;
        if (outcome.warnings && outcome.warnings.length > 0) {
          msg += ` Warnings: ${outcome.warnings.join('; ')}`;
        }
        vscode.window.showInformationMessage(msg);
        this.onInstalledRefreshCallback?.();
        break;
      }
      case 'refused': {
        vscode.window.showWarningMessage(`Installation refused: ${outcome.reason}`);
        break;
      }
      case 'rolled-back': {
        vscode.window.showErrorMessage(`Installation failed and was rolled back: ${outcome.reason}`);
        break;
      }
      case 'manual-recovery-required': {
        vscode.window.showErrorMessage(
          `CRITICAL: Installation failed and automatic recovery could not complete. Reason: ${outcome.reason}. Paths requiring inspection: ${outcome.paths.join(', ')}`,
          { modal: true }
        );
        break;
      }
    }
  }

  async installFolder(folderItem?: AvailableFolderItem): Promise<void> {
    if (!folderItem) {
      vscode.window.showWarningMessage('Please select a folder to install.');
      return;
    }
    const artifacts = folderItem.getAllArtifacts();
    await this.installBatch(artifacts, `folder "${folderItem.label}"`);
  }

  async installSourceGroup(sourceItem?: SourceItem): Promise<void> {
    if (!sourceItem) {
      vscode.window.showWarningMessage('Please select a source to install.');
      return;
    }
    await this.ensureCatalogLoaded();
    const group = this.cachedSourceGroups.find(
      (g) => g.source.id === sourceItem.source.id && g.source.scope === sourceItem.source.scope
    );
    if (!group) {
      vscode.window.showWarningMessage(`No available items found for source "${sourceItem.source.id}".`);
      return;
    }
    const artifacts: AvailableArtifactItem[] = [];
    for (const pkg of group.resolution.packages) {
      for (const art of pkg.artifacts) {
        artifacts.push(new AvailableArtifactItem(group.source, pkg, art));
      }
    }
    await this.installBatch(artifacts, `source "${group.source.name ?? group.source.id}"`);
  }

  resolveArtifactById(sourceId: string, scope: Scope, artifactId: string): AvailableArtifactItem | undefined {
    const group = this.cachedSourceGroups.find(
      (g) => g.source.id === sourceId && g.source.scope === scope
    );
    if (!group) return undefined;

    for (const pkg of group.resolution.packages) {
      for (const art of pkg.artifacts) {
        if (art.id === artifactId) {
          return new AvailableArtifactItem(group.source, pkg, art);
        }
      }
    }
    return undefined;
  }

  async doInstallArtifact(sourceId: string, scope: Scope, artifactId: string): Promise<void> {
    await this.ensureCatalogLoaded();
    const item = this.resolveArtifactById(sourceId, scope, artifactId);
    if (!item) {
      vscode.window.showWarningMessage(`Artifact "${artifactId}" not found in source "${sourceId}".`);
      return;
    }
    await this.installArtifact(item);
  }

  async doInstallSourceGroup(sourceId: string, scope: Scope): Promise<void> {
    await this.ensureCatalogLoaded();
    const group = this.cachedSourceGroups.find(
      (g) => g.source.id === sourceId && g.source.scope === scope
    );
    if (!group) {
      vscode.window.showWarningMessage(`No available items found for source "${sourceId}".`);
      return;
    }
    const artifacts: AvailableArtifactItem[] = [];
    for (const pkg of group.resolution.packages) {
      for (const art of pkg.artifacts) {
        artifacts.push(new AvailableArtifactItem(group.source, pkg, art));
      }
    }
    await this.installBatch(artifacts, `source "${group.source.name ?? group.source.id}"`);
  }

  async doInstallFolder(sourceId: string, scope: Scope, folderPath: string): Promise<void> {
    await this.ensureCatalogLoaded();
    const group = this.cachedSourceGroups.find(
      (g) => g.source.id === sourceId && g.source.scope === scope
    );
    if (!group) {
      vscode.window.showWarningMessage(`No available items found for source "${sourceId}".`);
      return;
    }

    const hierarchy = buildHierarchy(group.source, group.resolution.packages);
    
    const findFolder = (
      items: Array<AvailableFolderItem | AvailableArtifactItem>,
      targetPath: string
    ): AvailableFolderItem | undefined => {
      for (const item of items) {
        if (item instanceof AvailableFolderItem) {
          if (item.folderPath === targetPath) {
            return item;
          }
          const found = findFolder(item.items, targetPath);
          if (found) return found;
        }
      }
      return undefined;
    };

    const targetFolder = findFolder(hierarchy, folderPath);
    if (!targetFolder) {
      vscode.window.showWarningMessage(`Folder "${folderPath}" not found in source "${sourceId}".`);
      return;
    }

    const artifacts = targetFolder.getAllArtifacts();
    await this.installBatch(artifacts, `folder "${targetFolder.label}"`);
  }

  async installBatch(
    items: AvailableArtifactItem[],
    groupLabel: string
  ): Promise<void> {
    if (items.length === 0) {
      vscode.window.showWarningMessage(`No items found in ${groupLabel}.`);
      return;
    }

    const assistantPick = await vscode.window.showQuickPick(
      getEnabledAdapters().map(
        (adapter) => ({
          label: adapter.assistant,
          iconPath: new vscode.ThemeIcon(adapter.iconId),
        })
      ),
      {
        placeHolder: `Select target AI assistant for ${items.length} item(s)`,
      }
    );
    if (!assistantPick) return;
    const targetAssistant = assistantPick.label as AssistantId;
    const targetAdapter = getAdapter(targetAssistant);

    const scopePick = await vscode.window.showQuickPick(getScopeQuickPickItems(), {
      placeHolder: 'Select installation scope',
    });
    if (!scopePick) return;
    const targetScope = (typeof scopePick === 'string' ? scopePick : scopePick.value) as Scope;

    let projectRoot: string | undefined;
    if (targetScope === 'project') {
      projectRoot = await getWorkspaceRoot();
      if (!projectRoot) return;
    }

    const preparedList: PreparedInstall[] = [];
    let supportedCount = 0;
    let conflictCount = 0;

    for (const item of items) {
      const prepared = await planInstall({
        source: item.source,
        pkg: item.pkg,
        artifact: item.artifact,
        targetAdapter,
        targetScope,
        projectRoot,
      });
      preparedList.push(prepared);
      if (prepared.supported) {
        supportedCount++;
        if (prepared.plan.conflict) {
          conflictCount++;
        }
      }
    }

    if (supportedCount === 0) {
      vscode.window.showErrorMessage(`None of the ${items.length} item(s) could be planned for installation.`);
      return;
    }

    if (conflictCount > 0) {
      let conflictChoice: string | undefined;
      let promptUser = true;
      while (promptUser) {
        conflictChoice = await vscode.window.showWarningMessage(
          `${conflictCount} of ${supportedCount} item(s) already exist at target. Overwrite existing installations?`,
          { modal: true },
          'Preview',
          'Overwrite All'
        );
        if (conflictChoice === 'Preview') {
          await this.showBatchPreview(preparedList);
          continue;
        }
        promptUser = false;
      }
      if (conflictChoice !== 'Overwrite All') {
        return;
      }
    } else {
      let confirmChoice: string | undefined;
      let promptUser = true;
      while (promptUser) {
        const confirmMessage = `Install ${supportedCount} item(s) from ${groupLabel} to ${targetAssistant} (${targetScope})?`;
        confirmChoice = await vscode.window.showInformationMessage(
          confirmMessage,
          { modal: true },
          'Preview',
          'Install All'
        );
        if (confirmChoice === 'Preview') {
          await this.showBatchPreview(preparedList);
          continue;
        }
        promptUser = false;
      }
      if (confirmChoice !== 'Install All') {
        return;
      }
    }

    let appliedCount = 0;
    const failedNames: string[] = [];

    for (const prepared of preparedList) {
      if (!prepared.supported) continue;
      const outcome = await applyInstall(prepared);
      const itemName = prepared.kind === 'mcp-server' ? prepared.content.id : (prepared.content.name ?? 'unnamed');
      if (outcome.status === 'applied') {
        appliedCount++;
      } else {
        failedNames.push(`${itemName} (${outcome.status})`);
      }
    }

    if (appliedCount > 0) {
      let msg = `Successfully installed ${appliedCount}/${supportedCount} item(s) to ${targetAssistant} (${targetScope}).`;
      if (failedNames.length > 0) {
        msg += ` Failures: ${failedNames.join(', ')}`;
      }
      vscode.window.showInformationMessage(msg);
      this.onInstalledRefreshCallback?.();
    } else {
      vscode.window.showErrorMessage(`Failed to install items. ${failedNames.join(', ')}`);
    }
  }

  private async showPreview(prepared: PreparedInstall, itemName: string): Promise<void> {
    const uri = previewProvider.setPreviewContent(itemName, prepared);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  private async showBatchPreview(preparedList: PreparedInstall[]): Promise<void> {
    const supported = preparedList.filter(
      (p): p is Extract<PreparedInstall, { supported: true }> => p.supported
    );
    const items = supported.map((p) => {
      const itemName = p.kind === 'mcp-server' ? p.content.id : (p.content.name ?? 'unnamed');
      return {
        label: itemName,
        description: p.kind,
        prepared: p
      };
    });

    const choice = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select an item to preview'
    });

    if (choice) {
      const p = choice.prepared as Extract<PreparedInstall, { supported: true }>;
      const itemName = p.kind === 'mcp-server' ? p.content.id : (p.content.name ?? 'unnamed');
      await this.showPreview(choice.prepared, itemName);
    }
  }
}

