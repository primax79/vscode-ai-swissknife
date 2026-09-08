import * as vscode from 'vscode';
import type { AssistantId, Scope, ItemKind } from '../domain/types';
import { getEnabledAdapters } from '../adapters/registry';
import { getWorkspaceRoot } from './workspacePicker';
import { FormEditorPanel } from './formEditor';

export async function handleCreateArtifact(refreshCallback: () => void) {
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
    refreshCallback
  );
}
