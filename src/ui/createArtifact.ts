import * as vscode from 'vscode';
import type { AssistantId, Scope, ItemKind } from '../domain/types';
import { getEnabledAdapters } from '../adapters/registry';
import { getWorkspaceRoot } from './workspacePicker';
import { FormEditorPanel } from './formEditor';
import { getScopeQuickPickItems } from './scopeIcons';

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

  const scopePick = await vscode.window.showQuickPick(getScopeQuickPickItems(), {
    placeHolder: 'Select scope',
  });
  if (!scopePick) return;
  const targetScope = (typeof scopePick === 'string' ? scopePick : scopePick.value) as Scope;

  let projectRoot: string | undefined;
  if (targetScope === 'project') {
    projectRoot = await getWorkspaceRoot();
    if (!projectRoot) return;
  }

  await FormEditorPanel.open(
    {
      mode: 'create',
      assistant: assistantPick as AssistantId,
      scope: targetScope,
      projectRoot,
      kind: kindPick as ItemKind,
    },
    refreshCallback
  );
}
