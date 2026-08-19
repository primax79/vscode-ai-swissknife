import * as vscode from 'vscode';
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
    vscode.commands.registerCommand('aiSwissknife.openDashboard', () => DashboardPanel.render()),
    vscode.commands.registerCommand('aiSwissknife.refreshInstalled', () => installedProvider.refresh())
  );
}

export function deactivate() {}
