import * as vscode from 'vscode';
import { SourcesTreeDataProvider, SourceItem } from './ui/sourcesView';
import { AvailableTreeDataProvider, AvailableArtifactItem } from './ui/availableView';
import { InstalledTreeDataProvider } from './ui/installedView';

export function activate(context: vscode.ExtensionContext) {
  const sourcesProvider = new SourcesTreeDataProvider();
  const availableProvider = new AvailableTreeDataProvider();
  const installedProvider = new InstalledTreeDataProvider();

  availableProvider.setInstalledRefreshCallback(() => {
    installedProvider.refresh();
  });

  context.subscriptions.push(
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
    vscode.commands.registerCommand('aiSwissknife.refreshInstalled', () => installedProvider.refresh())
  );
}

export function deactivate() {}
