import * as vscode from 'vscode';
import type { AssistantId, Scope, ItemKind } from './domain/types';
import { readManifest, writeManifest, readState } from './domain/registry';
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

import { handleInstallRecommended } from './ui/recommendations';

export async function handleRecommendForWorkspace(
  item: AvailableArtifactItem | InstalledInstallationItem | undefined,
  availableProvider: AvailableTreeDataProvider,
  installedProvider: InstalledTreeDataProvider
) {
  if (!item) {
    vscode.window.showWarningMessage('Please select an item to recommend.');
    return;
  }

  let sourceId: string;
  let artifactId: string;
  let assistant: AssistantId;

  if (item instanceof AvailableArtifactItem) {
    if (item.source.scope !== 'project') {
      vscode.window.showWarningMessage(`Cannot recommend global-scope items.`);
      return;
    }
    const assistantPick = await vscode.window.showQuickPick(
      ['claude-code', 'kilo-code', 'github-copilot', 'codex-cli', 'gemini-cli'],
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
    if (inst.scope !== 'project') {
      vscode.window.showWarningMessage(`Cannot recommend global-scope items.`);
      return;
    }
    if (!inst.sourceId || !inst.artifactId) {
      vscode.window.showWarningMessage("This item isn't tracked to a source and can't be recommended.");
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
      ['claude-code', 'kilo-code', 'github-copilot', 'codex-cli', 'gemini-cli'],
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
    if (inst.scope !== 'project') {
      vscode.window.showWarningMessage(`Cannot unrecommend global-scope items.`);
      return;
    }
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
  const sourcesProvider = new SourcesTreeDataProvider();
  const availableProvider = new AvailableTreeDataProvider(context.extensionUri);
  const installedProvider = new InstalledTreeDataProvider(context.extensionUri);

  availableProvider.setInstalledRefreshCallback(() => {
    installedProvider.refresh();
  });

  const watchers = setupFileWatchers(() => {
    sourcesProvider.refresh();
    installedProvider.refresh();
  });

  let hasCheckedRecommendations = false;
  const checkRecommendations = async () => {
    if (hasCheckedRecommendations) return;
    hasCheckedRecommendations = true;

    if (context.workspaceState.get<boolean>('aiSwissknife.ignoreRecommendations')) {
      return;
    }

    const projectRoot = await getWorkspaceRoot();
    if (!projectRoot) return;

    let manifest, state;
    try {
      manifest = await readManifest('project', projectRoot);
      state = await readState('project', projectRoot);
    } catch {
      return;
    }

    const desired = manifest.desiredInstallations;
    if (desired.length === 0) return;

    let unsatisfiedCount = 0;
    for (const d of desired) {
      const isInstalled = state.installations.some(
        (inst) => inst.sourceId === d.sourceId && inst.artifactId === d.artifactId && inst.assistant === d.assistant
      );
      if (!isInstalled) {
        unsatisfiedCount++;
      }
    }

    if (unsatisfiedCount > 0) {
      const msg = `This workspace recommends ${unsatisfiedCount} AI Swissknife item(s) not yet installed.`;
      const actionInstall = 'Install All';
      const actionReview = 'Review';
      const actionIgnore = "Don't ask again for this workspace";

      const choice = await vscode.window.showInformationMessage(msg, actionInstall, actionReview, actionIgnore);

      if (choice === actionInstall) {
        await handleInstallRecommended(() => {
          installedProvider.refresh();
        });
      } else if (choice === actionReview) {
        await vscode.commands.executeCommand('aiSwissknife.available.focus');
      } else if (choice === actionIgnore) {
        await context.workspaceState.update('aiSwissknife.ignoreRecommendations', true);
      }
    }
  };

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
    vscode.commands.registerCommand(
      'aiSwissknife.syncItem',
      async (item?: InstalledInstallationItem | ObservedArtifactItem) => {
        await installedProvider.syncItem(item);
      }
    ),
    vscode.commands.registerCommand('aiSwissknife.createArtifact', async () => {
      const kindPick = await vscode.window.showQuickPick(['skill', 'agent', 'command', 'mcp-server'], {
        placeHolder: 'Select artifact kind to create',
      });
      if (!kindPick) return;

      const assistantPick = await vscode.window.showQuickPick(
        ['claude-code', 'kilo-code', 'github-copilot', 'codex-cli', 'gemini-cli'],
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
    vscode.commands.registerCommand('aiSwissknife.recommendForWorkspace', (item?: AvailableArtifactItem | InstalledInstallationItem) => 
      handleRecommendForWorkspace(item, availableProvider, installedProvider)
    ),
    vscode.commands.registerCommand('aiSwissknife.unrecommendForWorkspace', (item?: AvailableArtifactItem | InstalledInstallationItem) => 
      handleUnrecommendForWorkspace(item, availableProvider, installedProvider)
    ),
    vscode.commands.registerCommand('aiSwissknife.installRecommended', () =>
      handleInstallRecommended(() => {
        installedProvider.refresh();
      })
    ),
    vscode.commands.registerCommand('aiSwissknife.openDashboard', () => DashboardPanel.render()),
    vscode.commands.registerCommand('aiSwissknife.refreshInstalled', () => installedProvider.refresh())
  );

  checkRecommendations().catch((err) => {
    console.error('[ai-swissknife] recommendation check failed', err);
  });
}

export function deactivate() {}
