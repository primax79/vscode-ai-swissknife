import * as vscode from 'vscode';

export async function getWorkspaceRoot(): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showWarningMessage('No workspace folder open. Open a folder to use workspace-scope features.');
    return undefined;
  }

  if (folders.length === 1) {
    return folders[0].uri.fsPath;
  }

  const items = folders.map((folder) => ({
    label: folder.name,
    description: folder.uri.fsPath,
    fsPath: folder.uri.fsPath,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select target workspace folder',
  });

  return picked?.fsPath;
}
