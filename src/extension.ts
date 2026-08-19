import * as vscode from 'vscode';
import type { AssistantId, Scope, ItemKind } from './domain/types';
import { SourcesTreeDataProvider, SourceItem } from './ui/sourcesView';
import {
  AvailableTreeDataProvider,
  AvailableArtifactItem,
  AvailableFolderItem,
  AvailableSourceGroupItem,
} from './ui/availableView';
import {
  InstalledTreeDataProvider,
  InstalledInstallationItem,
  ObservedArtifactItem,
} from './ui/installedView';
import { setupFileWatchers } from './ui/watchers';
import { DashboardPanel } from './ui/dashboard';
import { FormEditorPanel } from './ui/formEditor';
import { getWorkspaceRoot } from './ui/workspacePicker';

export function activate(context: vscode.ExtensionContext) {
  const sourcesProvider = new SourcesTreeDataProvider();
  const availableProvider = new AvailableTreeDataProvider();
  const installedProvider = new InstalledTreeDataProvider();

  availableProvider.setInstalledRefreshCallback(() => {
    installedProvider.refresh();
  });

  const watchers = setupFileWatchers(() => {
    sourcesProvider.refresh();
    installedProvider.refresh();
  });

  context.subscriptions.push(
    ...watchers,
    vscode.window.registerTreeDataProvider('aiSwissknife.sources', sourcesProvider),
    vscode.window.registerTreeDataProvider('aiSwissknife.available', availableProvider),
    vscode.window.registerTreeDataProvider('aiSwissknife.installed', installedProvider),

    vscode.commands.registerCommand('aiSwissknife.addSource', () => sourcesProvider.addSource()),
    vscode.commands.registerCommand('aiSwissknife.removeSource', (item?: SourceItem) =>
      sourcesProvider.removeSource(item)
    ),
    vscode.commands.registerCommand('aiSwissknife.reloadRegistry', () => sourcesProvider.refresh()),
    vscode.commands.registerCommand('aiSwissknife.refreshCatalog', () => availableProvider.refreshCatalog()),
    vscode.commands.registerCommand('aiSwissknife.installArtifact', (item?: AvailableArtifactItem) =>
      availableProvider.installArtifact(item)
    ),
    vscode.commands.registerCommand('aiSwissknife.installFolder', (item?: AvailableFolderItem) =>
      availableProvider.installFolder(item)
    ),
    vscode.commands.registerCommand('aiSwissknife.installSourceGroup', (item?: AvailableSourceGroupItem) =>
      availableProvider.installSourceGroup(item)
    ),
    vscode.commands.registerCommand('aiSwissknife.checkDrift', () => installedProvider.checkDrift()),
    vscode.commands.registerCommand('aiSwissknife.updateItem', (item?: InstalledInstallationItem) =>
      installedProvider.updateInstallation(item)
    ),
    vscode.commands.registerCommand('aiSwissknife.promoteItem', (item?: ObservedArtifactItem) =>
      installedProvider.promoteItem(item)
    ),
    vscode.commands.registerCommand('aiSwissknife.createArtifact', async () => {
      const kindPick = await vscode.window.showQuickPick(['skill', 'agent', 'command', 'mcp-server'], {
        placeHolder: 'Select artifact kind to create',
      });
      if (!kindPick) return;

      const assistantPick = await vscode.window.showQuickPick(
        ['claude-code', 'kilo-code', 'github-copilot'],
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
    vscode.commands.registerCommand('aiSwissknife.openDashboard', () => DashboardPanel.render()),
    vscode.commands.registerCommand('aiSwissknife.refreshInstalled', () => installedProvider.refresh())
  );
}

export function deactivate() {}
