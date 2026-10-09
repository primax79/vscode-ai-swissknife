import * as vscode from 'vscode';
import type { Scope } from '../domain/types';
import {
  listTrash,
  restoreFromTrash,
  emptyTrash,
  formatRelativeTime,
  TrashEntry,
} from '../engine/softDelete';
import { getScopeLabel } from './scopeIcons';
import { getWorkspaceRoot } from './workspacePicker';
import type { InstalledTreeDataProvider } from './installedView';

interface TrashQuickPickItem extends vscode.QuickPickItem {
  entry: TrashEntry;
}

export async function handleRestoreFromTrash(
  installedProvider?: InstalledTreeDataProvider,
  homeRoot?: string
): Promise<void> {
  const effectiveHome = homeRoot ?? (installedProvider as any)?.homeRoot;
  const projectRoot = await getWorkspaceRoot();
  const globalEntries = await listTrash('global', undefined, effectiveHome);
  const projectEntries = projectRoot ? await listTrash('project', projectRoot, effectiveHome) : [];
  const allEntries = [...globalEntries, ...projectEntries].sort(
    (a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime()
  );

  if (allEntries.length === 0) {
    vscode.window.showInformationMessage('Trash is empty.');
    return;
  }

  const items: TrashQuickPickItem[] = allEntries.map((entry) => ({
    label: entry.name,
    description: `${entry.kind} · ${getScopeLabel(entry.scope)} · deleted ${formatRelativeTime(entry.deletedAt)}`,
    entry,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select an item to restore from trash',
  });
  if (!picked) return;

  const entry = picked.entry;
  let targetPath = entry.originalPath;

  if (!targetPath) {
    const input = await vscode.window.showInputBox({
      prompt: `Enter destination path to restore "${entry.name}"`,
      placeHolder: `/path/to/restore/${entry.name}`,
    });
    if (!input) return;
    targetPath = input;
  }

  const confirm = await vscode.window.showInformationMessage(
    `Restore ${entry.name} to ${targetPath}? It will be restored as an unmanaged file.`,
    { modal: true },
    'Restore'
  );
  if (confirm !== 'Restore') return;

  let outcome = await restoreFromTrash(entry, targetPath);
  while (outcome.status === 'conflict') {
    const action = await vscode.window.showWarningMessage(
      `Destination path already exists: ${outcome.targetPath}.`,
      'Restore under another name',
      'Cancel'
    );
    if (action !== 'Restore under another name') return;

    const newPath = await vscode.window.showInputBox({
      prompt: `Enter a different path to restore "${entry.name}"`,
      value: targetPath,
    });
    if (!newPath) return;
    targetPath = newPath;
    outcome = await restoreFromTrash(entry, targetPath);
  }

  if (outcome.status === 'restored') {
    vscode.window.showInformationMessage(`Restored ${entry.name} to ${outcome.restoredPath}`);
    installedProvider?.refresh();
  }
}

export async function handleEmptyTrash(
  installedProvider?: InstalledTreeDataProvider,
  homeRoot?: string
): Promise<void> {
  const effectiveHome = homeRoot ?? (installedProvider as any)?.homeRoot;
  const projectRoot = await getWorkspaceRoot();
  const globalEntries = await listTrash('global', undefined, effectiveHome);
  const projectEntries = projectRoot ? await listTrash('project', projectRoot, effectiveHome) : [];
  const totalCount = globalEntries.length + projectEntries.length;

  if (totalCount === 0) {
    vscode.window.showInformationMessage('Trash is already empty.');
    return;
  }

  const modalMsg = `Permanently delete ${totalCount} item(s) from the trash? This cannot be undone.`;
  let scopeToEmpty: Scope | undefined;

  if (globalEntries.length > 0 && projectEntries.length > 0) {
    const choice = await vscode.window.showInformationMessage(
      modalMsg,
      { modal: true },
      'Global',
      'Workspace',
      'Both'
    );
    if (!choice) return;
    if (choice === 'Global') scopeToEmpty = 'global';
    else if (choice === 'Workspace') scopeToEmpty = 'project';
    else if (choice === 'Both') scopeToEmpty = undefined;
    else return;
  } else if (globalEntries.length > 0) {
    const choice = await vscode.window.showInformationMessage(
      modalMsg,
      { modal: true },
      'Delete'
    );
    if (choice !== 'Delete') return;
    scopeToEmpty = 'global';
  } else if (projectEntries.length > 0) {
    const choice = await vscode.window.showInformationMessage(
      modalMsg,
      { modal: true },
      'Delete'
    );
    if (choice !== 'Delete') return;
    scopeToEmpty = 'project';
  }

  const result = await emptyTrash(scopeToEmpty, projectRoot, effectiveHome);
  if (result.failed.length > 0) {
    vscode.window.showWarningMessage(
      `Deleted ${result.count} item(s). Failed to delete ${result.failed.length} item(s).`
    );
  } else {
    vscode.window.showInformationMessage(
      `Permanently deleted ${result.count} item(s) from the trash.`
    );
  }
  installedProvider?.refresh();
}
