import * as vscode from 'vscode';
import * as os from 'os';
import type { Source, Scope, SourceType } from '../domain/types';
import {
  readManifest,
  writeManifest,
  readState,
  fromDesiredSource,
  toDesiredSource,
  withStateLock,
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
import { addSourceToManifest, removeSourceFromManifest } from '../engine/sourceManifest';
import { uninstallInstallation } from '../engine/uninstall';
import { deriveSourceDefaults, validateLocation, validateLocalFolder } from '../sources/sourceDefaults';
import { getScopeLabel, getScopeIconName, getScopeQuickPickItems } from './scopeIcons';

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
    canPickMany: true,
    placeHolder: 'Select source scope (one or both)',
  });
  if (!picked || picked.length === 0) {
    return undefined;
  }

  return picked.map((item) => item.scope);
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

  isSourceLoading(sourceId: string, scope: Scope): boolean {
    return this.availableProvider.isSourceLoading(sourceId, scope);
  }

  getTreeItem(element: SourceTreeItem): vscode.TreeItem {
    if (element instanceof ScopeGroupItem) {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.contextValue = `scopeGroup:${element.scope}`;
      item.iconPath = new vscode.ThemeIcon(getScopeIconName(element.scope));
      return item;
    }

    if (element instanceof SourceItem) {
      const source = element.source;
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      if (this.availableProvider.isSourceLoading(source.id, source.scope)) {
        item.description = 'Refreshing...';
        item.iconPath = new vscode.ThemeIcon('sync~spin');
      } else {
        item.description = element.description;
        item.iconPath = getSourceTypeIcon(source.type);
      }
      item.contextValue = 'sourceItem';
      item.tooltip = `ID: ${source.id}\nType: ${source.type}\nScope: ${source.scope}${
        source.url ? `\nURL: ${source.url}` : ''
      }${source.localPath ? `\nPath: ${source.localPath}` : ''}`;

      return item;
    }

    return this.availableProvider.getTreeItem(element as AvailableTreeItem);
  }

  async getChildren(element?: SourceTreeItem): Promise<SourceTreeItem[]> {
    if (!element) {
      if (!this.availableProvider.isRefreshing()) {
        await this.availableProvider.ensureCatalogLoaded();
      }
      const children: SourceTreeItem[] = [];
      const recommended = this.availableProvider.getCachedRecommendedGroup();
      if (recommended) {
        children.push(recommended);
      }
      children.push(
        new ScopeGroupItem('global', 'Global Sources'),
        new ScopeGroupItem('project', 'Workspace Sources')
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
          vscode.window.showErrorMessage(`Failed to read workspace sources: ${msg}`);
          return [];
        }
      }
      return [];
    }

    if (element instanceof SourceItem) {
      const group = this.availableProvider
        .getCachedSourceGroups()
        .find((g) => g.source.id === element.source.id && g.source.scope === element.source.scope);
      if (group) {
        return this.availableProvider.getChildren(group) as unknown as SourceTreeItem[];
      }
      if (this.availableProvider.isSourceLoading(element.source.id, element.source.scope)) {
        return [];
      }
      await this.availableProvider.ensureCatalogLoaded();
      const fallbackGroup = this.availableProvider
        .getCachedSourceGroups()
        .find((g) => g.source.id === element.source.id && g.source.scope === element.source.scope);
      if (!fallbackGroup) return [];
      // A source group's children are always diagnostics/folders/artifacts,
      // never another AvailableSourceGroupItem (which this union excludes).
      return this.availableProvider.getChildren(fallbackGroup) as unknown as SourceTreeItem[];
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
    const type = pickedType.type;

    const scopes = await promptScope(forceScope);
    if (!scopes || scopes.length === 0) return undefined;

    let projectRoot: string | undefined;
    if (scopes.includes('project')) {
      projectRoot = await getWorkspaceRoot();
      if (!projectRoot) return undefined;
    }

    const scopeLocations = new Map<Scope, string>();

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

      for (const scope of scopes) {
        const scopeLabel = getScopeLabel(scope);
        const folderChoice = await vscode.window.showQuickPick(folderOptions, {
          placeHolder:
            scopes.length > 1
              ? `Select folder or enter path (${scopeLabel} scope)`
              : 'Select folder or enter path',
        });
        if (!folderChoice) return undefined;

        let location: string | undefined;
        const rootDir = scope === 'project' ? projectRoot! : os.homedir();

        if (folderChoice.action === 'browse') {
          const uris = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: `Select Folder (${scopeLabel})`,
          });
          if (!uris || uris.length === 0) return undefined;
          const chosen = uris[0].fsPath;
          const err = validateLocalFolder(chosen, scope, rootDir);
          if (err) {
            vscode.window.showErrorMessage(err);
            return undefined;
          }
          location = chosen;
        } else {
          const typed = await vscode.window.showInputBox({
            prompt:
              scopes.length > 1
                ? `Local folder path for ${scopeLabel} scope`
                : 'Local folder path (relative to workspace for Workspace scope, or absolute)',
            validateInput: (v) => validateLocalFolder(v, scope, rootDir),
          });
          if (!typed) return undefined;
          location = typed.trim();
        }

        if (!location) return undefined;
        scopeLocations.set(scope, location);
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
      const location = typedUrl.trim();
      for (const s of scopes) {
        scopeLocations.set(s, location);
      }
    }

    const firstLocation = scopeLocations.get(scopes[0])!;
    const defaults = deriveSourceDefaults(type, firstLocation);

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
      interface RefPickItem extends vscode.QuickPickItem {
        action: 'default' | 'pin';
      }
      const refOptions: RefPickItem[] = [
        { label: 'Default branch', description: 'Use the repository default branch', action: 'default' },
        { label: 'Advanced: pin to branch/tag', description: 'Pin to a specific branch or tag', action: 'pin' },
      ];
      const refChoice = await vscode.window.showQuickPick(refOptions, {
        placeHolder: 'Pin to a branch, tag, or default',
      });
      if (!refChoice) return undefined;

      if (refChoice.action === 'pin') {
        interface PinPickItem extends vscode.QuickPickItem {
          target: 'branch' | 'tag';
        }
        const pinOptions: PinPickItem[] = [
          { label: 'Specific branch', target: 'branch' },
          { label: 'Specific tag', target: 'tag' },
        ];
        const pinChoice = await vscode.window.showQuickPick(pinOptions, {
          placeHolder: 'Pin to a specific branch or tag',
        });
        if (!pinChoice) return undefined;

        if (pinChoice.target === 'branch') {
          branch = await vscode.window.showInputBox({ prompt: 'Branch name (e.g. "main" or "dev")' });
          if (!branch) return undefined;
        } else {
          tag = await vscode.window.showInputBox({ prompt: 'Tag name (e.g. "v1.0.0")' });
          if (!tag) return undefined;
        }
      }
    }

    const trimmedId = id.trim();
    const succeededScopes: Scope[] = [];
    let firstWrittenSource: Source | undefined;
    let hasError = false;

    for (const scope of scopes) {
      const location = scopeLocations.get(scope)!;
      const root = scope === 'project' ? projectRoot : undefined;
      const scopeLabel = getScopeLabel(scope);

      try {
        const manifest = await readManifest(scope, root);
        const existing = manifest.sources.find((s) => s.id === trimmedId);
        if (existing) {
          const choice = await vscode.window.showWarningMessage(
            `Source "${trimmedId}" already exists in ${scopeLabel} scope. Replace?`,
            { modal: true },
            'Replace',
            'No'
          );
          if (choice !== 'Replace') {
            continue;
          }
        }

        const runtimeSource: Source = {
          id: trimmedId,
          type,
          scope,
          ...(name.trim() ? { name: name.trim() } : {}),
          ...(type === 'local-folder' ? { localPath: location.trim() } : { url: location.trim() }),
          ...(branch ? { branch: branch.trim() } : {}),
          ...(tag ? { tag: tag.trim() } : {}),
          ...(root ? { projectPath: root } : {}),
        };

        await addSourceToManifest(runtimeSource, { projectRoot: root, replace: true });

        succeededScopes.push(scope);
        if (!firstWrittenSource) {
          firstWrittenSource = runtimeSource;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (succeededScopes.length > 0) {
          const succeededLabels = succeededScopes
            .map((s) => getScopeLabel(s))
            .join(', ');
          vscode.window.showErrorMessage(
            `Source "${trimmedId}" added to ${succeededLabels} scope, but failed to add to ${scopeLabel} scope: ${msg}`
          );
        } else {
          vscode.window.showErrorMessage(`Failed to add source to ${scopeLabel} scope: ${msg}`);
        }
        hasError = true;
        break;
      }
    }

    if (succeededScopes.length > 0) {
      await this.availableProvider.refreshCatalog();
      this.refresh();
      if (!hasError) {
        vscode.window.showInformationMessage(`Source "${trimmedId}" added successfully.`);
      }
      return firstWrittenSource;
    }

    return undefined;
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
          `Source "${source.name ?? source.id}" is referenced by ${installCount} installed item(s) and ${desiredCount} desired installation(s). What would you like to do?`,
          { modal: true },
          'Uninstall All Items & Remove Source',
          'Remove Source Only'
        );

        if (!choice) {
          return;
        }

        if (choice === 'Uninstall All Items & Remove Source') {
          const toUninstall = state.installations.filter((i) => i.sourceId === source.id);
          for (const item of toUninstall) {
            try {
              await uninstallInstallation(item, { projectRoot });
            } catch (err) {
              console.warn(`[sourcesView] Failed to uninstall ${item.name}:`, err);
            }
          }
        }
      }

      // Remove from manifest and remove dependent desired installations
      await removeSourceFromManifest(source.id, source.scope, { projectRoot });

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
        {
          label: 'Global sources',
          value: 'global' as const,
          iconPath: new vscode.ThemeIcon(getScopeIconName('global')),
        },
        {
          label: 'Workspace sources',
          value: 'project' as const,
          iconPath: new vscode.ThemeIcon(getScopeIconName('project')),
        },
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
        const scopePick = await vscode.window.showQuickPick(getScopeQuickPickItems(), {
          placeHolder: `Import source "${payload.source.id}" into which scope?${localFolderNote}`,
        });
        if (!scopePick) return;
        const scope = (typeof scopePick === 'string' ? scopePick : scopePick.value) as Scope;

        let projectRoot: string | undefined;
        if (scope === 'project') {
          projectRoot = await getWorkspaceRoot();
          if (!projectRoot) return;
        }

        const result = await mergeScopeConfig(scope, { sources: [payload.source], desiredInstallations: [] }, projectRoot);
        await this.availableProvider.refreshCatalog();
        this.refresh();
        vscode.window.showInformationMessage(
          `Source "${payload.source.id}" ${result.sourcesAdded > 0 ? 'added' : 'updated'} in ${getScopeLabel(scope)} scope.`
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
              `This file contains ${payload.project.sources.length} workspace source(s). Merge into the current workspace?`,
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
