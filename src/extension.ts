import * as vscode from 'vscode';
import type { AssistantId, Scope, ItemKind } from './domain/types';
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

import {
  recommendAvailableArtifact,
  recommendInstalledArtifact,
  unrecommendAvailableArtifact,
  unrecommendInstalledArtifact,
} from './ui/recommendations';

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

  const projectRoot = await getWorkspaceRoot();
  if (!projectRoot) return;

  let changed = false;

  if (item instanceof AvailableArtifactItem) {
    changed = await recommendAvailableArtifact(item.source.id, item.source.scope, item.artifact.id, projectRoot);
  } else if (item instanceof InstalledInstallationItem) {
    changed = await recommendInstalledArtifact(item.installation, sourcesProvider, projectRoot);
  }

  if (changed) {
    availableProvider.refresh();
    installedProvider.refresh();
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

  const projectRoot = await getWorkspaceRoot();
  if (!projectRoot) return;

  let changed = false;

  if (item instanceof AvailableArtifactItem) {
    changed = await unrecommendAvailableArtifact(item.source.id, item.source.scope, item.artifact.id, projectRoot);
  } else if (item instanceof InstalledInstallationItem) {
    changed = await unrecommendInstalledArtifact(item.installation, projectRoot);
  }

  if (changed) {
    availableProvider.refresh();
    installedProvider.refresh();
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

  const refreshDashboardState = () => {
    sourcesProvider.refresh();
    availableProvider.refreshCatalog();
    installedProvider.refresh();
    updateStatusBar().catch(() => {});
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

    vscode.commands.registerCommand('aiSwissknife.configureEnabledAssistants', async () => {
      const config = vscode.workspace.getConfiguration('aiSwissknife');
      const enabledConfig = config.get('enabledAssistants') || {};
      const currentConfig = typeof enabledConfig === 'object' && enabledConfig !== null ? (enabledConfig as Record<string, boolean>) : {};
      
      const picked = await vscode.window.showQuickPick(
        ALL_ADAPTERS.map((a) => ({
          label: a.displayName,
          picked: currentConfig[a.assistant] !== false,
          assistantId: a.assistant
        })),
        {
          canPickMany: true,
          placeHolder: 'Select which assistants to enable'
        }
      );

      if (picked !== undefined) {
        const newValue: Record<string, boolean> = {};
        for (const adapter of ALL_ADAPTERS) {
          newValue[adapter.assistant] = picked.some((p) => p.assistantId === adapter.assistant);
        }
        await config.update('enabledAssistants', newValue, vscode.ConfigurationTarget.Global);
      }
    }),
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
        getEnabledAdapters().map(a => a.assistant),
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
    vscode.commands.registerCommand('aiSwissknife.openDashboard', () => DashboardPanel.render(context.extensionUri, installedProvider, sourcesProvider, availableProvider, refreshDashboardState)),
    vscode.commands.registerCommand('aiSwissknife.openInDashboard', (item?: SourceItem) => {
      const panel = DashboardPanel.render(context.extensionUri, installedProvider, sourcesProvider, availableProvider, refreshDashboardState);
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
