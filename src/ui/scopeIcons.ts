import * as vscode from 'vscode';
import type { Scope } from '../domain/types';

/**
 * Returns the VS Code codicon name for the given scope:
 * 'globe' for global, 'folder' for project (workspace).
 */
export function getScopeIconName(scope: Scope | string): string {
  return scope === 'project' ? 'folder' : 'globe';
}

/**
 * Returns an inline SVG string (14px, currentColor) for the given scope,
 * styled with the shared `.scope-icon` and `.scope-icon-${scope}` classes.
 */
export function getScopeIconSvg(scope: Scope | string): string {
  if (scope === 'project') {
    return `<svg class="scope-icon scope-icon-project" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="vertical-align: middle; margin-right: 4px;" aria-hidden="true"><path d="M1.75 2.5h3.69l1.56 1.5h7.25c.97 0 1.75.78 1.75 1.75v6.5c0 .97-.78 1.75-1.75 1.75H1.75C.78 14 0 13.22 0 12.25v-8c0-.97.78-1.75 1.75-1.75z"/></svg>`;
  }
  return `<svg class="scope-icon scope-icon-global" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="vertical-align: middle; margin-right: 4px;" aria-hidden="true"><path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zM1.5 8a6.5 6.5 0 0 1 1.05-3.53l2.84 2.84A4.5 4.5 0 0 0 5.3 8H1.5zm6.5-6.5c.87 0 1.7.17 2.46.48l-1.92 1.92a4.49 4.49 0 0 0-1.04-.4A6.5 6.5 0 0 1 8 1.5zm0 13c-.87 0-1.7-.17-2.46-.48l1.92-1.92c.34.05.69.08 1.04.08.35 0 .7-.03 1.04-.08l1.92 1.92A6.5 6.5 0 0 1 8 14.5z"/></svg>`;
}

/**
 * Returns the human-readable user-facing label for the given scope:
 * "Workspace" for project, "Global" for global.
 */
export function getScopeLabel(scope: Scope | string): string {
  return scope === 'project' ? 'Workspace' : 'Global';
}

export interface ScopeQuickPickItem extends vscode.QuickPickItem {
  label: string;
  description?: string;
  value: Scope;
  iconPath: vscode.ThemeIcon;
}

/**
 * Returns QuickPick items for scopes with the shared label and ThemeIcon.
 * Order: Global then Workspace unless specified otherwise.
 */
export function getScopeQuickPickItems(options?: {
  globalDescription?: string;
  workspaceDescription?: string;
}): ScopeQuickPickItem[] {
  return [
    {
      label: getScopeLabel('global'),
      value: 'global',
      iconPath: new vscode.ThemeIcon(getScopeIconName('global')),
      ...(options?.globalDescription ? { description: options.globalDescription } : {}),
    },
    {
      label: getScopeLabel('project'),
      value: 'project',
      iconPath: new vscode.ThemeIcon(getScopeIconName('project')),
      ...(options?.workspaceDescription ? { description: options.workspaceDescription } : {}),
    },
  ];
}
