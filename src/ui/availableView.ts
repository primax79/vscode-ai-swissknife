import * as path from 'path';
import * as vscode from 'vscode';
import type { Source, Package, Artifact, AssistantId, Scope } from '../domain/types';
import type { DetectionDiagnostic, SourceResolution } from '../sources/types';
import { readManifest, fromDesiredSource } from '../domain/registry';
import { resolveLocalFolder } from '../sources/localFolder';
import { resolveGitCustom } from '../sources/gitCustom';
import { ClaudeAdapter } from '../adapters/claude';
import { KiloAdapter } from '../adapters/kilo';
import { planInstall } from '../engine/plan';
import { applyInstall } from '../engine/apply';
import type { PreparedInstall } from '../engine/types';
import { getWorkspaceRoot } from './workspacePicker';

export type AvailableTreeItem =
  | AvailableSourceGroupItem
  | AvailableFolderItem
  | AvailableArtifactItem
  | DiagnosticTreeItem;

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
    public readonly artifact: Artifact
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
  packages: Package[]
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
      current.artifacts.push(new AvailableArtifactItem(source, pkg, art));
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
  private _onDidChangeTreeData = new vscode.EventEmitter<
    AvailableTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData: vscode.Event<
    AvailableTreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  private cachedSourceGroups: AvailableSourceGroupItem[] = [];
  private claudeAdapter = new ClaudeAdapter();
  private kiloAdapter = new KiloAdapter();
  private onInstalledRefreshCallback?: () => void;

  setInstalledRefreshCallback(cb: () => void) {
    this.onInstalledRefreshCallback = cb;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  async refreshCatalog(): Promise<void> {
    this.cachedSourceGroups = [];

    const sources: Source[] = [];

    // Load global sources
    try {
      const globalManifest = await readManifest('global');
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

    for (const src of sources) {
      try {
        let resolution: SourceResolution;
        if (src.type === 'local-folder') {
          resolution = await resolveLocalFolder(src);
        } else if (src.type === 'git-custom') {
          resolution = await resolveGitCustom(src);
        } else {
          resolution = { packages: [], diagnostics: [] };
        }
        this.cachedSourceGroups.push(new AvailableSourceGroupItem(src, resolution));
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
      }
    }

    this.refresh();
  }

  getTreeItem(element: AvailableTreeItem): vscode.TreeItem {
    if (element instanceof AvailableSourceGroupItem) {
      const source = element.source;
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

    const artifact = element.artifact;
    const item = new vscode.TreeItem(
      artifact.name,
      vscode.TreeItemCollapsibleState.None
    );
    item.description = artifact.description;
    item.tooltip = `Kind: ${artifact.kind}\nSource: ${element.source.id}\nPackage: ${element.pkg.id}`;
    item.contextValue = 'availableArtifact';
    const icon = artifact.kind === 'agent' ? 'robot' : artifact.kind === 'command' ? 'terminal' : 'tools';
    item.iconPath = new vscode.ThemeIcon(icon);
    item.command = {
      command: 'aiSwissknife.installArtifact',
      title: `Install ${artifact.kind}`,
      arguments: [element],
    };
    return item;
  }

  async getChildren(element?: AvailableTreeItem): Promise<AvailableTreeItem[]> {
    if (!element) {
      if (this.cachedSourceGroups.length === 0) {
        await this.refreshCatalog();
      }
      return this.cachedSourceGroups;
    }

    if (element instanceof AvailableSourceGroupItem) {
      const children: AvailableTreeItem[] = [];

      for (const diag of element.resolution.diagnostics) {
        children.push(new DiagnosticTreeItem(diag));
      }

      const hierarchy = buildHierarchy(element.source, element.resolution.packages);
      children.push(...hierarchy);

      return children;
    }

    if (element instanceof AvailableFolderItem) {
      return element.items;
    }

    return [];
  }

  async installArtifact(item?: AvailableArtifactItem): Promise<void> {
    if (!item) {
      vscode.window.showWarningMessage('Please select an available item to install.');
      return;
    }

    const { source, pkg, artifact } = item;

    const assistantPick = await vscode.window.showQuickPick(['claude-code', 'kilo-code'], {
      placeHolder: 'Select target AI assistant',
    });
    if (!assistantPick) return;
    const targetAssistant = assistantPick as AssistantId;
    const targetAdapter = targetAssistant === 'claude-code' ? this.claudeAdapter : this.kiloAdapter;

    const scopePick = await vscode.window.showQuickPick(['project', 'global'], {
      placeHolder: 'Select installation scope (project or global)',
    });
    if (!scopePick) return;
    const targetScope = scopePick as Scope;

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

    if (plan.conflict) {
      const conflictChoice = await vscode.window.showWarningMessage(
        `${artifact.kind} "${prepared.content.name}" already exists at "${plan.targetDir}". Overwrite existing installation?`,
        { modal: true },
        'Overwrite'
      );
      if (conflictChoice !== 'Overwrite') {
        return;
      }
    }

    const confirmMessage = `Install ${artifact.kind} "${prepared.content.name}" to ${targetAssistant} (${targetScope})?\nTarget path: ${plan.targetDir}\nFiles proposed: ${plan.proposedFiles.length} file(s)`;
    const confirmChoice = await vscode.window.showInformationMessage(
      confirmMessage,
      { modal: true },
      'Install'
    );

    if (confirmChoice !== 'Install') {
      return;
    }

    const outcome = await applyInstall(prepared);

    switch (outcome.status) {
      case 'applied': {
        let msg = `Successfully installed "${prepared.content.name}" to ${targetAssistant} (${targetScope}).`;
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

  async installSourceGroup(groupItem?: AvailableSourceGroupItem): Promise<void> {
    if (!groupItem) {
      vscode.window.showWarningMessage('Please select a source to install.');
      return;
    }
    const artifacts: AvailableArtifactItem[] = [];
    for (const pkg of groupItem.resolution.packages) {
      for (const art of pkg.artifacts) {
        artifacts.push(new AvailableArtifactItem(groupItem.source, pkg, art));
      }
    }
    await this.installBatch(artifacts, `source "${groupItem.source.name ?? groupItem.source.id}"`);
  }

  private async installBatch(
    items: AvailableArtifactItem[],
    groupLabel: string
  ): Promise<void> {
    if (items.length === 0) {
      vscode.window.showWarningMessage(`No items found in ${groupLabel}.`);
      return;
    }

    const assistantPick = await vscode.window.showQuickPick(['claude-code', 'kilo-code'], {
      placeHolder: `Select target AI assistant for ${items.length} item(s)`,
    });
    if (!assistantPick) return;
    const targetAssistant = assistantPick as AssistantId;
    const targetAdapter = targetAssistant === 'claude-code' ? this.claudeAdapter : this.kiloAdapter;

    const scopePick = await vscode.window.showQuickPick(['project', 'global'], {
      placeHolder: 'Select installation scope (project or global)',
    });
    if (!scopePick) return;
    const targetScope = scopePick as Scope;

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
      const conflictChoice = await vscode.window.showWarningMessage(
        `${conflictCount} of ${supportedCount} item(s) already exist at target. Overwrite existing installations?`,
        { modal: true },
        'Overwrite All'
      );
      if (conflictChoice !== 'Overwrite All') {
        return;
      }
    }

    const confirmMessage = `Install ${supportedCount} item(s) from ${groupLabel} to ${targetAssistant} (${targetScope})?`;
    const confirmChoice = await vscode.window.showInformationMessage(
      confirmMessage,
      { modal: true },
      'Install All'
    );
    if (confirmChoice !== 'Install All') {
      return;
    }

    let appliedCount = 0;
    const failedNames: string[] = [];

    for (const prepared of preparedList) {
      if (!prepared.supported) continue;
      const outcome = await applyInstall(prepared);
      if (outcome.status === 'applied') {
        appliedCount++;
      } else {
        failedNames.push(`${prepared.content.name} (${outcome.status})`);
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
}
