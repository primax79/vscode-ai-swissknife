import * as vscode from 'vscode';
import type { Source, Scope, SourceType } from '../domain/types';
import {
  readManifest,
  writeManifest,
  readState,
  fromDesiredSource,
  toDesiredSource,
} from '../domain/registry';
import { getWorkspaceRoot } from './workspacePicker';
import {
  AvailableTreeDataProvider,
  AvailableFolderItem,
  AvailableArtifactItem,
  DiagnosticTreeItem,
  RecommendedGroupItem,
  RecommendedBrokenItem,
  type AvailableTreeItem,
} from './availableView';
import {
  buildScopeExport,
  buildSourceExport,
  parseExportedConfigFile,
  mergeScopeConfig,
  CONFIG_TRANSFER_SCHEMA_VERSION,
  type ExportedConfigFile,
} from '../engine/configTransfer';
import { ALL_SOURCE_RESOLVERS, getSourceResolver } from '../sources/registry';
import { deriveSourceDefaults, validateLocation } from '../sources/sourceDefaults';

export type SourceTreeItem =
  | ScopeGroupItem
  | SourceItem
  | AvailableFolderItem
  | AvailableArtifactItem
  | DiagnosticTreeItem
  | RecommendedGroupItem
  | RecommendedBrokenItem;

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

function getSourceTypeIcon(type: Source['type']): vscode.ThemeIcon {
  return new vscode.ThemeIcon(getSourceResolver(type).iconThemeId);
}

export async function promptScope(forceScope?: Scope): Promise<Scope[] | undefined> {
  if (forceScope) {
    return [forceScope];
  }

  const hasWorkspace = Boolean(
    vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
  );

  interface ScopePickItem extends vscode.QuickPickItem {
    scope: Scope;
  }

  const items: ScopePickItem[] = [
    {
      label: 'Global',
      scope: 'global',
      ...(hasWorkspace ? {} : { description: 'Workspace scope requires an open folder' }),
    },
  ];

  if (hasWorkspace) {
    items.push({
      label: 'Workspace',
      scope: 'project',
    });
  }

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select source scope',
  });
  if (!picked) {
    return undefined;
  }

  const scope: Scope = typeof picked === 'string'
    ? (picked === 'Workspace' || picked === 'project' ? 'project' : 'global')
    : (picked.scope ?? (picked.label === 'Workspace' ? 'project' : 'global'));

  return [scope];
}

export class SourcesTreeDataProvider implements vscode.TreeDataProvider<SourceTreeItem> {
  constructor(private readonly availableProvider: AvailableTreeDataProvider) {
    // Available's content (folders/artifacts/diagnostics/recommended group) is
    // now rendered as part of this tree, so any change there must re-render
    // this tree too — this is the only registered TreeDataProvider now.
    this.availableProvider.onDidChangeTreeData(() => this.refresh());
  }

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

    if (element instanceof SourceItem) {
      const source = element.source;
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      item.description = element.description;
      item.contextValue = 'sourceItem';
      item.iconPath = getSourceTypeIcon(source.type);
      item.tooltip = `ID: ${source.id}\nType: ${source.type}\nScope: ${source.scope}${
        source.url ? `\nURL: ${source.url}` : ''
      }${source.localPath ? `\nPath: ${source.localPath}` : ''}`;

      return item;
    }

    return this.availableProvider.getTreeItem(element as AvailableTreeItem);
  }

  async getChildren(element?: SourceTreeItem): Promise<SourceTreeItem[]> {
    if (!element) {
      await this.availableProvider.ensureCatalogLoaded();
      const children: SourceTreeItem[] = [];
      const recommended = this.availableProvider.getCachedRecommendedGroup();
      if (recommended) {
        children.push(recommended);
      }
      children.push(
        new ScopeGroupItem('global', 'Global Sources'),
        new ScopeGroupItem('project', 'Project Sources')
      );
      return children;
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
      return [];
    }

    if (element instanceof SourceItem) {
      await this.availableProvider.ensureCatalogLoaded();
      const group = this.availableProvider
        .getCachedSourceGroups()
        .find((g) => g.source.id === element.source.id && g.source.scope === element.source.scope);
      if (!group) return [];
      // A source group's children are always diagnostics/folders/artifacts,
      // never another AvailableSourceGroupItem (which this union excludes).
      return this.availableProvider.getChildren(group) as unknown as SourceTreeItem[];
    }

    return this.availableProvider.getChildren(element as AvailableTreeItem) as unknown as SourceTreeItem[];
  }

  async addSource(forceScope?: Scope): Promise<Source | undefined> {
    interface SourceTypePickItem extends vscode.QuickPickItem {
      type: SourceType;
    }
    const typeItems: SourceTypePickItem[] = ALL_SOURCE_RESOLVERS.map((resolver) => ({
      label: `$(${resolver.iconThemeId}) ${resolver.displayName}`,
      iconPath: new vscode.ThemeIcon(resolver.iconThemeId),
      type: resolver.type,
    }));

    const pickedType = await vscode.window.showQuickPick(typeItems, {
      placeHolder: 'Select source type',
    });
    if (!pickedType) return undefined;

    const type: SourceType | undefined = typeof pickedType === 'string'
      ? (ALL_SOURCE_RESOLVERS.find((r) => r.type === pickedType || r.displayName === pickedType || `$(${r.iconThemeId}) ${r.displayName}` === pickedType)?.type ?? (pickedType as SourceType))
      : (pickedType as SourceTypePickItem).type ??
        ALL_SOURCE_RESOLVERS.find((r) => r.displayName === pickedType.label || `$(${r.iconThemeId}) ${r.displayName}` === pickedType.label)?.type;
    if (!type) return undefined;

    const scopes = await promptScope(forceScope);
    if (!scopes || scopes.length === 0) return undefined;
    const scope = scopes[0];

    let projectRoot: string | undefined;
    if (scope === 'project') {
      projectRoot = await getWorkspaceRoot();
      if (!projectRoot) return undefined;
    }

    let location: string | undefined;
    if (type === 'local-folder') {
      interface FolderPickItem extends vscode.QuickPickItem {
        action: 'browse' | 'type';
      }
      const folderOptions: FolderPickItem[] = [
        {
          label: '$(folder) Browse...',
          description: 'Select folder using file picker',
          action: 'browse',
        },
        {
          label: '$(edit) Enter path manually...',
          description: 'Type folder path directly',
          action: 'type',
        },
      ];

      const folderChoice: FolderPickItem | string | undefined = await vscode.window.showQuickPick(folderOptions, {
        placeHolder: 'Select folder or enter path',
      });
      if (!folderChoice) return undefined;

      const choiceObj = folderChoice as FolderPickItem;
      const isBrowse = typeof folderChoice === 'string'
        ? (folderChoice as string).toLowerCase().includes('browse')
        : choiceObj.action === 'browse' || choiceObj.label.toLowerCase().includes('browse');

      if (typeof folderChoice === 'string' && !(folderChoice as string).toLowerCase().includes('browse') && !(folderChoice as string).toLowerCase().includes('enter path')) {
        location = (folderChoice as string).trim();
      } else if (isBrowse) {
        const uris = await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
          openLabel: 'Select Folder',
        });
        if (!uris || uris.length === 0) return undefined;
        location = uris[0].fsPath;
      } else {
        const typed = await vscode.window.showInputBox({
          prompt: 'Local folder path (relative to workspace for Workspace scope, or absolute)',
          validateInput: (v) => validateLocation(type, v),
        });
        if (!typed) return undefined;
        location = typed.trim();
      }
    } else {
      const urlPrompt =
        type === 'remote-url'
          ? 'Raw artifact URL (e.g. https://gist.github.com/...)'
          : 'Git repository URL (HTTPS or SSH, e.g. https://github.com/org/repo.git)';

      const typedUrl = await vscode.window.showInputBox({
        prompt: urlPrompt,
        validateInput: (v) => validateLocation(type, v),
      });
      if (!typedUrl) return undefined;
      location = typedUrl.trim();
    }

    if (!location) return undefined;

    const defaults = deriveSourceDefaults(type, location);

    const id = await vscode.window.showInputBox({
      prompt: 'Enter a unique identifier for this source (e.g. "team-skills")',
      value: defaults.id,
      validateInput: (v) => (v.trim().length > 0 ? null : 'ID cannot be empty'),
    });
    if (!id) return undefined;

    const name = await vscode.window.showInputBox({
      prompt: 'Optional display name',
      value: defaults.name,
    });
    if (name === undefined) return undefined;

    let branch: string | undefined;
    let tag: string | undefined;

    const isGitType =
      type === 'git-custom' ||
      type === 'git-marketplace' ||
      type === 'git-single-item';

    if (isGitType) {
      const refChoice = await vscode.window.showQuickPick(
        [
          { label: 'Default branch', description: 'Use the repository default branch' },
          { label: 'Advanced: pin to branch/tag', description: 'Pin to a specific branch or tag' },
        ],
        {
          placeHolder: 'Pin to a branch, tag, or default',
        }
      );
      if (!refChoice) return undefined;

      const refLabel = typeof refChoice === 'string' ? refChoice : refChoice.label;

      if (refLabel === 'Advanced: pin to branch/tag') {
        const pinChoice = await vscode.window.showQuickPick(
          ['Specific branch', 'Specific tag'],
          {
            placeHolder: 'Pin to a specific branch or tag',
          }
        );
        if (!pinChoice) return undefined;

        const pinLabel = typeof pinChoice === 'string' ? pinChoice : (pinChoice as any).label;
        if (pinLabel === 'Specific branch' || pinLabel?.includes('branch')) {
          branch = await vscode.window.showInputBox({ prompt: 'Branch name (e.g. "main" or "dev")' });
          if (!branch) return undefined;
        } else if (pinLabel === 'Specific tag' || pinLabel?.includes('tag')) {
          tag = await vscode.window.showInputBox({ prompt: 'Tag name (e.g. "v1.0.0")' });
          if (!tag) return undefined;
        }
      } else if (refLabel === 'Specific branch') {
        branch = await vscode.window.showInputBox({ prompt: 'Branch name (e.g. "main" or "dev")' });
        if (!branch) return undefined;
      } else if (refLabel === 'Specific tag') {
        tag = await vscode.window.showInputBox({ prompt: 'Tag name (e.g. "v1.0.0")' });
        if (!tag) return undefined;
      }
    }

    const runtimeSource: Source = {
      id: id.trim(),
      type,
      scope,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(type === 'local-folder' ? { localPath: location.trim() } : { url: location.trim() }),
      ...(branch ? { branch: branch.trim() } : {}),
      ...(tag ? { tag: tag.trim() } : {}),
      ...(projectRoot ? { projectPath: projectRoot } : {}),
    };

    try {
      const desired = toDesiredSource(runtimeSource, projectRoot);
      const manifest = await readManifest(scope, projectRoot);
      manifest.sources = manifest.sources.filter((s) => s.id !== desired.id);
      manifest.sources.push(desired);
      await writeManifest(scope, manifest, projectRoot);
      await this.availableProvider.refreshCatalog();
      this.refresh();
      vscode.window.showInformationMessage(`Source "${desired.id}" added successfully.`);
      return runtimeSource;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to add source: ${msg}`);
      return undefined;
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

      await this.availableProvider.refreshCatalog();
      this.refresh();
      vscode.window.showInformationMessage(`Source "${source.id}" removed from manifest.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to remove source: ${msg}`);
    }
  }

  async exportConfig(): Promise<void> {
    const choice = await vscode.window.showQuickPick(
      [
        { label: 'Global sources', value: 'global' as const },
        { label: 'Project sources', value: 'project' as const },
        { label: 'Both (combined file)', value: 'both' as const },
      ],
      { placeHolder: 'Which configuration do you want to export?' }
    );
    if (!choice) return;

    let projectRoot: string | undefined;
    if (choice.value !== 'global') {
      projectRoot = await getWorkspaceRoot();
      if (!projectRoot && choice.value === 'project') return;
    }

    const payload: ExportedConfigFile = {
      schemaVersion: CONFIG_TRANSFER_SCHEMA_VERSION,
      kind: 'ai-swissknife-config',
      exportedAt: new Date().toISOString(),
    };

    try {
      if (choice.value === 'global' || choice.value === 'both') {
        payload.global = await buildScopeExport('global');
      }
      if ((choice.value === 'project' || choice.value === 'both') && projectRoot) {
        payload.project = await buildScopeExport('project', projectRoot);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to build export: ${msg}`);
      return;
    }

    const uri = await vscode.window.showSaveDialog({
      filters: { 'AI Swissknife Configuration': ['json'] },
      defaultUri: vscode.Uri.file(`ai-swissknife-config-${choice.value}.json`),
    });
    if (!uri) return;

    try {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(payload, null, 2), 'utf-8'));
      vscode.window.showInformationMessage(`Configuration exported to ${uri.fsPath}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to write export file: ${msg}`);
    }
  }

  async exportSource(sourceItem?: SourceItem): Promise<void> {
    if (!sourceItem) {
      vscode.window.showWarningMessage('Please select a source to export.');
      return;
    }

    let payload: ExportedConfigFile;
    try {
      const desired = toDesiredSource(sourceItem.source, sourceItem.source.projectPath);
      payload = buildSourceExport(desired);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to export source: ${msg}`);
      return;
    }

    const uri = await vscode.window.showSaveDialog({
      filters: { 'AI Swissknife Source': ['json'] },
      defaultUri: vscode.Uri.file(`ai-swissknife-source-${sourceItem.source.id}.json`),
    });
    if (!uri) return;

    try {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(payload, null, 2), 'utf-8'));
      vscode.window.showInformationMessage(`Source "${sourceItem.source.id}" exported to ${uri.fsPath}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to write export file: ${msg}`);
    }
  }

  async importConfig(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      filters: { 'AI Swissknife Configuration': ['json'] },
      canSelectMany: false,
    });
    if (!uris || uris.length === 0) return;

    let payload: ExportedConfigFile;
    try {
      const raw = await vscode.workspace.fs.readFile(uris[0]);
      payload = parseExportedConfigFile(Buffer.from(raw).toString('utf-8'));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to read configuration file: ${msg}`);
      return;
    }

    try {
      if (payload.kind === 'ai-swissknife-source' && payload.source) {
        const localFolderNote =
          payload.source.type === 'local-folder'
            ? ' Note: this is a local-folder source — verify its path resolves correctly here.'
            : '';
        const scopePick = await vscode.window.showQuickPick(['project', 'global'], {
          placeHolder: `Import source "${payload.source.id}" into which scope?${localFolderNote}`,
        });
        if (!scopePick) return;
        const scope = scopePick as Scope;

        let projectRoot: string | undefined;
        if (scope === 'project') {
          projectRoot = await getWorkspaceRoot();
          if (!projectRoot) return;
        }

        const result = await mergeScopeConfig(scope, { sources: [payload.source], desiredInstallations: [] }, projectRoot);
        await this.availableProvider.refreshCatalog();
        this.refresh();
        vscode.window.showInformationMessage(
          `Source "${payload.source.id}" ${result.sourcesAdded > 0 ? 'added' : 'updated'} in ${scope} scope.`
        );
        return;
      }

      if (payload.kind === 'ai-swissknife-config') {
        let totalAdded = 0;
        let totalUpdated = 0;
        let totalDesired = 0;

        if (payload.global) {
          const confirmGlobal = await vscode.window.showInformationMessage(
            `This file contains ${payload.global.sources.length} global source(s). Merge into Global scope?`,
            { modal: true },
            'Import'
          );
          if (confirmGlobal === 'Import') {
            const r = await mergeScopeConfig('global', payload.global);
            totalAdded += r.sourcesAdded;
            totalUpdated += r.sourcesUpdated;
            totalDesired += r.desiredInstallationsAdded;
          }
        }

        if (payload.project) {
          // getWorkspaceRoot() already warns if no workspace is open.
          const projectRoot = await getWorkspaceRoot();
          if (projectRoot) {
            const confirmProject = await vscode.window.showInformationMessage(
              `This file contains ${payload.project.sources.length} project source(s). Merge into the current workspace?`,
              { modal: true },
              'Import'
            );
            if (confirmProject === 'Import') {
              const r = await mergeScopeConfig('project', payload.project, projectRoot);
              totalAdded += r.sourcesAdded;
              totalUpdated += r.sourcesUpdated;
              totalDesired += r.desiredInstallationsAdded;
            }
          }
        }

        await this.availableProvider.refreshCatalog();
        this.refresh();
        vscode.window.showInformationMessage(
          `Import complete: ${totalAdded} source(s) added, ${totalUpdated} updated, ${totalDesired} recommendation(s) added.`
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to import configuration: ${msg}`);
    }
  }
}
