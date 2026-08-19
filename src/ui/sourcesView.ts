import * as vscode from 'vscode';
import type { Source, Scope } from '../domain/types';
import {
  readManifest,
  writeManifest,
  readState,
  fromDesiredSource,
  toDesiredSource,
} from '../domain/registry';
import { getWorkspaceRoot } from './workspacePicker';

export type SourceTreeItem = ScopeGroupItem | SourceItem;

export class ScopeGroupItem {
  constructor(
    public readonly scope: Scope,
    public readonly label: string
  ) {}
}

export class SourceItem {
  constructor(
    public readonly source: Source,
    public readonly label: string,
    public readonly description?: string
  ) {}
}

export class SourcesTreeDataProvider implements vscode.TreeDataProvider<SourceTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SourceTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<SourceTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SourceTreeItem): vscode.TreeItem {
    if (element instanceof ScopeGroupItem) {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.contextValue = `scopeGroup:${element.scope}`;
      return item;
    }

    const source = element.source;
    const item = new vscode.TreeItem(
      element.label,
      vscode.TreeItemCollapsibleState.None
    );
    item.description = element.description;
    item.contextValue = 'sourceItem';
    item.tooltip = `ID: ${source.id}\nType: ${source.type}\nScope: ${source.scope}${
      source.url ? `\nURL: ${source.url}` : ''
    }${source.localPath ? `\nPath: ${source.localPath}` : ''}`;

    return item;
  }

  async getChildren(element?: SourceTreeItem): Promise<SourceTreeItem[]> {
    if (!element) {
      return [
        new ScopeGroupItem('global', 'Global Sources'),
        new ScopeGroupItem('project', 'Project Sources'),
      ];
    }

    if (element instanceof ScopeGroupItem) {
      if (element.scope === 'global') {
        try {
          const manifest = await readManifest('global');
          return manifest.sources.map((desired) => {
            const runtimeSource = fromDesiredSource(desired);
            const desc = `${desired.type}${desired.branch ? ` (${desired.branch})` : ''}${
              desired.tag ? ` (${desired.tag})` : ''
            }${desired.localPath ? ` (${desired.localPath})` : ''}`;
            return new SourceItem(runtimeSource, desired.name ?? desired.id, desc);
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Failed to read global sources: ${msg}`);
          return [];
        }
      } else if (element.scope === 'project') {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
          return [];
        }

        const projectRoot = folders[0].uri.fsPath;
        try {
          const manifest = await readManifest('project', projectRoot);
          return manifest.sources.map((desired) => {
            const runtimeSource = fromDesiredSource(desired, projectRoot);
            const desc = `${desired.type}${desired.branch ? ` (${desired.branch})` : ''}${
              desired.tag ? ` (${desired.tag})` : ''
            }${desired.localPath ? ` (${desired.localPath})` : ''}`;
            return new SourceItem(runtimeSource, desired.name ?? desired.id, desc);
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Failed to read project sources: ${msg}`);
          return [];
        }
      }
    }

    return [];
  }

  async addSource(): Promise<void> {
    const scopePick = await vscode.window.showQuickPick(['project', 'global'], {
      placeHolder: 'Select source scope (project or global)',
    });
    if (!scopePick) return;
    const scope = scopePick as Scope;

    let projectRoot: string | undefined;
    if (scope === 'project') {
      projectRoot = await getWorkspaceRoot();
      if (!projectRoot) return;
    }

    const typePick = await vscode.window.showQuickPick(
      ['git-custom', 'git-marketplace', 'git-single-item', 'local-folder', 'remote-url'],
      {
        placeHolder: 'Select source type',
      }
    );
    if (!typePick) return;

    const id = await vscode.window.showInputBox({
      prompt: 'Enter a unique identifier for this source (e.g. "team-skills")',
      validateInput: (v) => (v.trim().length > 0 ? null : 'ID cannot be empty'),
    });
    if (!id) return;

    const name = await vscode.window.showInputBox({
      prompt: 'Optional display name',
      value: id,
    });

    let url: string | undefined;
    let branch: string | undefined;
    let tag: string | undefined;
    let localPath: string | undefined;

    if (
      typePick === 'git-custom' ||
      typePick === 'git-marketplace' ||
      typePick === 'git-single-item' ||
      typePick === 'remote-url'
    ) {
      url = await vscode.window.showInputBox({
        prompt:
          typePick === 'remote-url'
            ? 'Raw artifact URL (e.g. https://gist.github.com/...)'
            : 'Git repository URL (HTTPS or SSH, e.g. https://github.com/org/repo.git)',
        validateInput: (v) => (v.trim().length > 0 ? null : 'URL cannot be empty'),
      });
      if (!url) return;

      if (typePick !== 'remote-url') {
        const refChoice = await vscode.window.showQuickPick(
          ['Default branch', 'Specific branch', 'Specific tag'],
          {
            placeHolder: 'Pin to a branch, tag, or default',
          }
        );
        if (!refChoice) return;

        if (refChoice === 'Specific branch') {
          branch = await vscode.window.showInputBox({ prompt: 'Branch name (e.g. "main" or "dev")' });
        } else if (refChoice === 'Specific tag') {
          tag = await vscode.window.showInputBox({ prompt: 'Tag name (e.g. "v1.0.0")' });
        }
      }
    } else if (typePick === 'local-folder') {
      localPath = await vscode.window.showInputBox({
        prompt: 'Local folder path (relative to workspace for project scope, or absolute)',
        validateInput: (v) => (v.trim().length > 0 ? null : 'Path cannot be empty'),
      });
      if (!localPath) return;
    }

    const runtimeSource: Source = {
      id: id.trim(),
      type: typePick as Source['type'],
      scope,
      ...(name ? { name: name.trim() } : {}),
      ...(url ? { url: url.trim() } : {}),
      ...(branch ? { branch: branch.trim() } : {}),
      ...(tag ? { tag: tag.trim() } : {}),
      ...(localPath ? { localPath: localPath.trim() } : {}),
      ...(projectRoot ? { projectPath: projectRoot } : {}),
    };

    try {
      const desired = toDesiredSource(runtimeSource, projectRoot);
      const manifest = await readManifest(scope, projectRoot);
      manifest.sources = manifest.sources.filter((s) => s.id !== desired.id);
      manifest.sources.push(desired);
      await writeManifest(scope, manifest, projectRoot);
      this.refresh();
      vscode.window.showInformationMessage(`Source "${desired.id}" added successfully.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to add source: ${msg}`);
    }
  }

  async removeSource(sourceItem?: SourceItem): Promise<void> {
    if (!sourceItem) {
      vscode.window.showWarningMessage('Please select a source to remove.');
      return;
    }

    const source = sourceItem.source;
    let projectRoot: string | undefined;
    if (source.scope === 'project') {
      projectRoot = await getWorkspaceRoot();
      if (!projectRoot) return;
    }

    try {
      const state = await readState(source.scope, projectRoot);
      const manifest = await readManifest(source.scope, projectRoot);

      const installCount = state.installations.filter((i) => i.sourceId === source.id).length;
      const desiredCount = manifest.desiredInstallations.filter((d) => d.sourceId === source.id).length;

      if (installCount > 0 || desiredCount > 0) {
        const choice = await vscode.window.showWarningMessage(
          `Source "${source.id}" is referenced by ${installCount} installed item(s) and ${desiredCount} desired installation(s). Remove anyway?`,
          { modal: true },
          'Remove Anyway'
        );

        if (choice !== 'Remove Anyway') {
          return;
        }
      }

      // Remove from manifest and remove dependent desired installations
      manifest.sources = manifest.sources.filter((s) => s.id !== source.id);
      manifest.desiredInstallations = manifest.desiredInstallations.filter((d) => d.sourceId !== source.id);
      await writeManifest(source.scope, manifest, projectRoot);

      this.refresh();
      vscode.window.showInformationMessage(`Source "${source.id}" removed from manifest.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to remove source: ${msg}`);
    }
  }
}
