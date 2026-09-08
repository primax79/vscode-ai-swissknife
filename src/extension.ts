import * as vscode from 'vscode';
import type { AssistantId, Scope, ItemKind, Source } from './domain/types';
import { readManifest, writeManifest, fromDesiredSource, type DesiredSource } from './domain/registry';
import type { SourceResolution } from './sources/types';
import { getSourceResolver } from './sources/registry';
import { SourcesTreeDataProvider, SourceItem } from './ui/sourcesView';
import {
  AvailableTreeDataProvider,
  AvailableArtifactItem,
  AvailableFolderItem,
} from './ui/availableView';
import {
  InstalledTreeDataProvider,
  AssistantTreeDataProvider,
  InstalledInstallationItem,
  ObservedArtifactItem,
} from './ui/installedView';
import { setupFileWatchers } from './ui/watchers';
import { DashboardPanel } from './ui/dashboard';
import { FormEditorPanel } from './ui/formEditor';
import { getWorkspaceRoot } from './ui/workspacePicker';
import { previewProvider, PreviewProvider } from './ui/previewProvider';
import { readonlyFileContentProvider, ReadonlyFileContentProvider } from './ui/artifactFileTree';

import { ALL_ADAPTERS, getEnabledAdapters } from './adapters/registry';
import { handleInstallRecommended } from './ui/recommendations';
import {
  computePendingCounts,
  formatStatusBarLabel,
  formatStatusBarTooltip,
  type PendingCounts,
} from './engine/pendingCounts';

export {
  computePendingCounts,
  countUnsatisfiedRecommendations,
  formatStatusBarLabel,
  formatStatusBarTooltip,
  type PendingCounts,
} from './engine/pendingCounts';

async function resolveSourcePackages(source: Source): Promise<SourceResolution> {
  try {
    const resolver = getSourceResolver(source.type);
    return await resolver.resolve(source);
  } catch {
    return { packages: [], diagnostics: [] };
  }
}

/**
 * Recommending an item requires a sourceId+artifactId that a collaborator
 * cloning the project can actually resolve. This handles the two gaps a
 * plain installed item can have: no source tracked at all (prompts to pick
 * or register one, then pick the matching artifact), or a source that's
 * only registered globally on this machine (offers to also register it at
 * project scope, so it travels with the repo).
 */
async function ensureRecommendableSource(
  sourcesProvider: SourcesTreeDataProvider,
  projectRoot: string,
  itemName: string,
  itemKind: ItemKind,
  existingSourceId?: string,
  existingArtifactId?: string
): Promise<{ sourceId: string; artifactId: string } | undefined> {
  const projectManifest = await readManifest('project', projectRoot);
  const globalManifest = await readManifest('global');

  if (existingSourceId && existingArtifactId) {
    const alreadyPortable = projectManifest.sources.some((s) => s.id === existingSourceId);
    if (alreadyPortable) {
      return { sourceId: existingSourceId, artifactId: existingArtifactId };
    }

    const globalSource = globalManifest.sources.find((s) => s.id === existingSourceId);
    if (!globalSource) {
      // Unregistered anywhere findable — let the resolution engine report it as broken.
      return { sourceId: existingSourceId, artifactId: existingArtifactId };
    }

    const choice = await vscode.window.showInformationMessage(
      `Source "${existingSourceId}" is only registered globally on this machine. To make this recommendation work for anyone who opens the project, it also needs to be registered as a project source.`,
      { modal: true },
      'Add & Continue'
    );
    if (choice !== 'Add & Continue') return undefined;

    projectManifest.sources.push({ ...globalSource });
    await writeManifest('project', projectManifest, projectRoot);
    sourcesProvider.refresh();
    return { sourceId: existingSourceId, artifactId: existingArtifactId };
  }

  // Untracked item: let the user point at the source that actually provides it.
  const bySourceId = new Map<string, { desired: DesiredSource; scope: Scope }>();
  for (const s of globalManifest.sources) bySourceId.set(s.id, { desired: s, scope: 'global' });
  for (const s of projectManifest.sources) bySourceId.set(s.id, { desired: s, scope: 'project' });

  const ADD_NEW = '$(add) Register a new source...';
  const picked = await vscode.window.showQuickPick(
    [
      { label: ADD_NEW },
      ...Array.from(bySourceId.values()).map((sc) => ({
        label: sc.desired.name ?? sc.desired.id,
        description: `${sc.desired.type} (${sc.scope})`,
        sc,
      })),
    ],
    { placeHolder: `"${itemName}" isn't tracked to a source yet — select the one that provides it` }
  );
  if (!picked) return undefined;

  let runtimeSource: Source | undefined;
  if (picked.label === ADD_NEW) {
    runtimeSource = await sourcesProvider.addSource('project');
    if (!runtimeSource) return undefined;
  } else if ('sc' in picked) {
    const { desired, scope } = picked.sc;
    runtimeSource = fromDesiredSource(desired, scope === 'project' ? projectRoot : undefined);
    if (scope === 'global') {
      const freshProjectManifest = await readManifest('project', projectRoot);
      if (!freshProjectManifest.sources.some((s) => s.id === desired.id)) {
        freshProjectManifest.sources.push({ ...desired });
        await writeManifest('project', freshProjectManifest, projectRoot);
        sourcesProvider.refresh();
      }
    }
  } else {
    return undefined;
  }

  let resolution: SourceResolution;
  try {
    resolution = await resolveSourcePackages(runtimeSource);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Failed to resolve source "${runtimeSource.id}": ${msg}`);
    return undefined;
  }

  const candidates = resolution.packages.flatMap((pkg) =>
    pkg.artifacts.filter((a) => a.kind === itemKind).map((artifact) => ({ pkg, artifact }))
  );
  if (candidates.length === 0) {
    vscode.window.showWarningMessage(`No ${itemKind} artifacts found in source "${runtimeSource.id}".`);
    return undefined;
  }

  const artifactChoice = await vscode.window.showQuickPick(
    candidates.map((c) => ({ label: c.artifact.name, description: c.pkg.id, c })),
    { placeHolder: `Select the artifact matching "${itemName}"` }
  );
  if (!artifactChoice) return undefined;

  return { sourceId: runtimeSource.id, artifactId: artifactChoice.c.artifact.id };
}

export async function handleRecommendForWorkspace(
  item: AvailableArtifactItem | InstalledInstallationItem | undefined,
  availableProvider: AvailableTreeDataProvider,
  installedProvider: InstalledTreeDataProvider,
  sourcesProvider: SourcesTreeDataProvider
) {
  if (!item) {
    vscode.window.showWarningMessage('Please select an item to recommend.');
    return;
  }

  let sourceId: string;
  let artifactId: string;
  let assistant: AssistantId;

  const projectRoot = await getWorkspaceRoot();
  if (!projectRoot) return;

  if (item instanceof AvailableArtifactItem) {
    if (item.source.scope !== 'project') {
      vscode.window.showWarningMessage(`Cannot recommend global-scope items.`);
      return;
    }
    const assistantPick = await vscode.window.showQuickPick(
      ALL_ADAPTERS.map(a => a.assistant),
      {
        placeHolder: 'Select target AI assistant for recommendation',
      }
    );
    if (!assistantPick) return;

    sourceId = item.source.id;
    artifactId = item.artifact.id;
    assistant = assistantPick as AssistantId;
  } else if (item instanceof InstalledInstallationItem) {
    const inst = item.installation;
    const resolved = await ensureRecommendableSource(
      sourcesProvider,
      projectRoot,
      inst.name,
      inst.kind,
      inst.sourceId,
      inst.artifactId
    );
    if (!resolved) return;

    sourceId = resolved.sourceId;
    artifactId = resolved.artifactId;
    assistant = inst.assistant;
  } else {
    return;
  }

  try {
    const manifest = await readManifest('project', projectRoot);
    const existingIndex = manifest.desiredInstallations.findIndex(
      (d) => d.sourceId === sourceId && d.artifactId === artifactId && d.assistant === assistant
    );
    if (existingIndex === -1) {
      manifest.desiredInstallations.push({
        sourceId,
        artifactId,
        assistant,
        scope: 'project',
      });
      await writeManifest('project', manifest, projectRoot);
      availableProvider.refresh();
      installedProvider.refresh();
      vscode.window.showInformationMessage(`Item recommended for workspace.`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Failed to recommend item: ${msg}`);
  }
}

export async function handleUnrecommendForWorkspace(
  item: AvailableArtifactItem | InstalledInstallationItem | undefined,
  availableProvider: AvailableTreeDataProvider,
  installedProvider: InstalledTreeDataProvider
) {
  if (!item) {
    vscode.window.showWarningMessage('Please select an item to unrecommend.');
    return;
  }

  let sourceId: string;
  let artifactId: string;
  let assistant: AssistantId;

  if (item instanceof AvailableArtifactItem) {
    if (item.source.scope !== 'project') {
      vscode.window.showWarningMessage(`Cannot unrecommend global-scope items.`);
      return;
    }
    // We need the assistant. If invoked from Available view, we don't know which assistant they want to unrecommend for if multiple exist.
    // Wait, the specification says:
    // "unrecommendForWorkspace: same read, filter out the matching entry, write back."
    // Does Available view unrecommend prompt for assistant? The spec doesn't explicitly mention it for unrecommend.
    // But how can we filter without the assistant? If we prompt, we should do it. Let's see:
    const assistantPick = await vscode.window.showQuickPick(
      ALL_ADAPTERS.map(a => a.assistant),
      {
        placeHolder: 'Select target AI assistant to remove recommendation',
      }
    );
    if (!assistantPick) return;

    sourceId = item.source.id;
    artifactId = item.artifact.id;
    assistant = assistantPick as AssistantId;
  } else if (item instanceof InstalledInstallationItem) {
    const inst = item.installation;
    if (!inst.sourceId || !inst.artifactId) {
      vscode.window.showWarningMessage("This item isn't tracked to a source and can't be unrecommended.");
      return;
    }

    sourceId = inst.sourceId;
    artifactId = inst.artifactId;
    assistant = inst.assistant;
  } else {
    return;
  }

  const projectRoot = await getWorkspaceRoot();
  if (!projectRoot) return;

  try {
    const manifest = await readManifest('project', projectRoot);
    const existingIndex = manifest.desiredInstallations.findIndex(
      (d) => d.sourceId === sourceId && d.artifactId === artifactId && d.assistant === assistant
    );
    if (existingIndex !== -1) {
      manifest.desiredInstallations.splice(existingIndex, 1);
      await writeManifest('project', manifest, projectRoot);
      availableProvider.refresh();
      installedProvider.refresh();
      vscode.window.showInformationMessage(`Recommendation removed.`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Failed to unrecommend item: ${msg}`);
  }
}

export function activate(context: vscode.ExtensionContext) {
  const availableProvider = new AvailableTreeDataProvider(context.extensionUri);
  const sourcesProvider = new SourcesTreeDataProvider(availableProvider);
  const installedProvider = new InstalledTreeDataProvider(context.extensionUri);

  const assistantProviders = ALL_ADAPTERS.map((adapter) => {
    const provider = new AssistantTreeDataProvider(installedProvider, adapter.assistant);
    return vscode.window.registerTreeDataProvider(`aiSwissknife.installed.${adapter.assistant}`, provider);
  });

  const updateEnabledContext = () => {
    const enabled = getEnabledAdapters();
    const enabledIds = new Set(enabled.map((a) => a.assistant));
    for (const adapter of ALL_ADAPTERS) {
      vscode.commands.executeCommand(
        'setContext',
        `aiSwissknife.enabled.${adapter.assistant}`,
        enabledIds.has(adapter.assistant)
      );
    }
  };

  updateEnabledContext();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aiSwissknife.enabledAssistants')) {
        updateEnabledContext();
      }
    })
  );

  const refreshAllInstalled = () => {
    installedProvider.refresh();
  };

  availableProvider.setInstalledRefreshCallback(refreshAllInstalled);

  const watchers = setupFileWatchers(() => {
    sourcesProvider.refresh();
    refreshAllInstalled();
  });

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'aiSwissknife.openDashboard';
  statusBarItem.text = '$(dashboard) AI Swissknife';
  statusBarItem.tooltip = 'AI Swissknife: Open Dashboard';
  statusBarItem.show();

  const updateStatusBar = async (projectRoot?: string): Promise<PendingCounts> => {
    try {
      const root = projectRoot ?? (await getWorkspaceRoot());
      const counts = await computePendingCounts(root);
      statusBarItem.text = formatStatusBarLabel(counts);
      statusBarItem.tooltip = formatStatusBarTooltip(counts);
      return counts;
    } catch {
      statusBarItem.text = '$(dashboard) AI Swissknife';
      statusBarItem.tooltip = 'AI Swissknife: Open Dashboard';
      return { unsatisfiedRecommendations: 0, updatesAvailable: 0, total: 0 };
    }
  };

  let hasCheckedRecommendations = false;
  const checkRecommendations = async () => {
    const projectRoot = await getWorkspaceRoot();
    const counts = await updateStatusBar(projectRoot);

    if (hasCheckedRecommendations) return;
    hasCheckedRecommendations = true;

    if (context.workspaceState.get<boolean>('aiSwissknife.ignoreRecommendations')) {
      return;
    }

    if (!projectRoot) return;

    const unsatisfiedCount = counts.unsatisfiedRecommendations;
    if (unsatisfiedCount > 0) {
      const msg = `This workspace recommends ${unsatisfiedCount} AI Swissknife item(s) not yet installed.`;
      const actionInstall = 'Install All';
      const actionReview = 'Review';
      const actionIgnore = "Don't ask again for this workspace";

      const choice = await vscode.window.showInformationMessage(msg, actionInstall, actionReview, actionIgnore);

      if (choice === actionInstall) {
        await handleInstallRecommended(() => {
          installedProvider.refresh();
          updateStatusBar().catch(() => {});
        });
      } else if (choice === actionReview) {
        await vscode.commands.executeCommand('aiSwissknife.sources.focus');
      } else if (choice === actionIgnore) {
        await context.workspaceState.update('aiSwissknife.ignoreRecommendations', true);
      }
    }
  };

  const sourcesTreeView = vscode.window.createTreeView('aiSwissknife.sources', { treeDataProvider: sourcesProvider });

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(PreviewProvider.scheme, previewProvider),
    vscode.workspace.registerTextDocumentContentProvider(ReadonlyFileContentProvider.scheme, readonlyFileContentProvider),
    statusBarItem,
    ...watchers,
    sourcesTreeView,
    ...assistantProviders,

    vscode.commands.registerCommand('aiSwissknife.addSource', () => sourcesProvider.addSource()),
    vscode.commands.registerCommand('aiSwissknife.removeSource', (item?: SourceItem) =>
      sourcesProvider.removeSource(item)
    ),
    vscode.commands.registerCommand('aiSwissknife.reloadRegistry', () => sourcesProvider.refresh()),
    vscode.commands.registerCommand('aiSwissknife.exportConfig', () => sourcesProvider.exportConfig()),
    vscode.commands.registerCommand('aiSwissknife.importConfig', () => sourcesProvider.importConfig()),
    vscode.commands.registerCommand('aiSwissknife.exportSource', (item?: SourceItem) =>
      sourcesProvider.exportSource(item)
    ),
    vscode.commands.registerCommand('aiSwissknife.refreshCatalog', () => availableProvider.refreshCatalog()),
    vscode.commands.registerCommand('aiSwissknife.installArtifact', (item?: AvailableArtifactItem) =>
      availableProvider.installArtifact(item)
    ),
    vscode.commands.registerCommand('aiSwissknife.previewAvailableArtifact', (item?: AvailableArtifactItem) =>
      availableProvider.previewArtifact(item)
    ),
    vscode.commands.registerCommand('aiSwissknife.installFolder', (item?: AvailableFolderItem) =>
      availableProvider.installFolder(item)
    ),
    vscode.commands.registerCommand('aiSwissknife.installSourceGroup', (item?: SourceItem) =>
      availableProvider.installSourceGroup(item)
    ),
    vscode.commands.registerCommand('aiSwissknife.checkDrift', async () => {
      await installedProvider.checkDrift();
      updateStatusBar().catch(() => {});
    }),
    vscode.commands.registerCommand('aiSwissknife.updateItem', (item?: InstalledInstallationItem) =>
      installedProvider.updateInstallation(item)
    ),
    vscode.commands.registerCommand('aiSwissknife.promoteItem', (item?: ObservedArtifactItem) =>
      installedProvider.promoteItem(item)
    ),
    vscode.commands.registerCommand(
      'aiSwissknife.diffAgainstOriginal',
      async (item?: InstalledInstallationItem | ObservedArtifactItem) => {
        await installedProvider.diffAgainstOriginal(item);
      }
    ),
    vscode.commands.registerCommand(
      'aiSwissknife.syncItem',
      async (item?: InstalledInstallationItem | ObservedArtifactItem) => {
        await installedProvider.syncItem(item);
      }
    ),
    vscode.commands.registerCommand(
      'aiSwissknife.moveItem',
      async (item?: InstalledInstallationItem) => {
        await installedProvider.moveItem(item);
      }
    ),
    vscode.commands.registerCommand(
      'aiSwissknife.uninstallItem',
      async (item?: InstalledInstallationItem) => {
        await installedProvider.uninstallItem(item);
      }
    ),
    vscode.commands.registerCommand('aiSwissknife.createArtifact', async () => {
      const kindPick = await vscode.window.showQuickPick(['skill', 'agent', 'command', 'mcp-server'], {
        placeHolder: 'Select artifact kind to create',
      });
      if (!kindPick) return;

      const assistantPick = await vscode.window.showQuickPick(
        ALL_ADAPTERS.map(a => a.assistant),
        {
          placeHolder: 'Select target assistant',
        }
      );
      if (!assistantPick) return;

      const scopePick = await vscode.window.showQuickPick(['project', 'global'], {
        placeHolder: 'Select scope (project or global)',
      });
      if (!scopePick) return;

      let projectRoot: string | undefined;
      if (scopePick === 'project') {
        projectRoot = await getWorkspaceRoot();
        if (!projectRoot) return;
      }

      await FormEditorPanel.open(
        {
          mode: 'create',
          assistant: assistantPick as AssistantId,
          scope: scopePick as Scope,
          projectRoot,
          kind: kindPick as ItemKind,
        },
        () => {
          installedProvider.refresh();
        }
      );
    }),
    vscode.commands.registerCommand(
      'aiSwissknife.editArtifact',
      async (item?: InstalledInstallationItem | ObservedArtifactItem) => {
        if (!item) {
          vscode.window.showWarningMessage('Please select an artifact to edit.');
          return;
        }

        if (item instanceof InstalledInstallationItem) {
          const inst = item.installation;
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
              installedProvider.refresh();
            }
          );
        } else if (item instanceof ObservedArtifactItem) {
          const obs = item.observed;
          await FormEditorPanel.open(
            {
              mode: 'edit',
              assistant: obs.assistant,
              scope: obs.scope,
              projectRoot: obs.projectPath,
              kind: obs.kind,
              name: obs.name,
            },
            () => {
              installedProvider.refresh();
            }
          );
        }
      }
    ),
    vscode.commands.registerCommand('aiSwissknife.recommendForWorkspace', async (item?: AvailableArtifactItem | InstalledInstallationItem) => {
      await handleRecommendForWorkspace(item, availableProvider, installedProvider, sourcesProvider);
      updateStatusBar().catch(() => {});
    }),
    vscode.commands.registerCommand('aiSwissknife.unrecommendForWorkspace', async (item?: AvailableArtifactItem | InstalledInstallationItem) => {
      await handleUnrecommendForWorkspace(item, availableProvider, installedProvider);
      updateStatusBar().catch(() => {});
    }),
    vscode.commands.registerCommand('aiSwissknife.installRecommended', () =>
      handleInstallRecommended(() => {
        installedProvider.refresh();
        updateStatusBar().catch(() => {});
      })
    ),
    vscode.commands.registerCommand('aiSwissknife.openDashboard', () => DashboardPanel.render(context.extensionUri, installedProvider)),
    vscode.commands.registerCommand('aiSwissknife.openInDashboard', (item?: SourceItem) => {
      const panel = DashboardPanel.render(context.extensionUri, installedProvider);
      if (item) {
        panel.setSourceFilter(item.source.id, item.source.scope);
      }
    }),
    vscode.commands.registerCommand('aiSwissknife.refreshInstalled', () => {
      installedProvider.refresh();
      updateStatusBar().catch(() => {});
    })
  );

  checkRecommendations().catch((err) => {
    console.error('[ai-swissknife] recommendation check failed', err);
  });
}

export function deactivate() {}
