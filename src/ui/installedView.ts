import * as vscode from 'vscode';
import type { ManagedInstallation } from '../domain/types';
import { readState } from '../domain/registry';

export type InstalledTreeItem = InstalledGroupItem | InstalledInstallationItem;

export class InstalledGroupItem {
  constructor(
    public readonly groupKey: string,
    public readonly label: string,
    public readonly installations: ManagedInstallation[]
  ) {}
}

export class InstalledInstallationItem {
  constructor(public readonly installation: ManagedInstallation) {}
}

export class InstalledTreeDataProvider
  implements vscode.TreeDataProvider<InstalledTreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    InstalledTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData: vscode.Event<
    InstalledTreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: InstalledTreeItem): vscode.TreeItem {
    if (element instanceof InstalledGroupItem) {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.description = `${element.installations.length} installed`;
      item.contextValue = 'installedGroup';
      return item;
    }

    const inst = element.installation;
    const item = new vscode.TreeItem(
      inst.name,
      vscode.TreeItemCollapsibleState.None
    );
    item.description = `${inst.kind} (${inst.scope})`;
    item.tooltip = `Name: ${inst.name}\nKind: ${inst.kind}\nAssistant: ${inst.assistant}\nScope: ${inst.scope}\nPath: ${inst.path}\nInstalled at: ${inst.installedAt}${
      inst.sourceRevision?.commit ? `\nCommit: ${inst.sourceRevision.commit}` : ''
    }${inst.sourceRevision?.requestedRef ? `\nRef: ${inst.sourceRevision.requestedRef}` : ''}`;
    const icon = inst.kind === 'agent' ? 'robot' : inst.kind === 'command' ? 'terminal' : 'check';
    item.iconPath = new vscode.ThemeIcon(icon);
    item.contextValue = 'installedInstallation';
    return item;
  }

  async getChildren(element?: InstalledTreeItem): Promise<InstalledTreeItem[]> {
    if (!element) {
      const allInstallations: ManagedInstallation[] = [];

      try {
        const globalState = await readState('global');
        allInstallations.push(...globalState.installations);
      } catch {
        // ignore
      }

      const folders = vscode.workspace.workspaceFolders;
      if (folders && folders.length > 0) {
        const projectRoot = folders[0].uri.fsPath;
        try {
          const projectState = await readState('project', projectRoot);
          allInstallations.push(...projectState.installations);
        } catch {
          // ignore
        }
      }

      const groups = new Map<string, ManagedInstallation[]>();
      for (const inst of allInstallations) {
        const key = `${inst.assistant} (${inst.scope})`;
        const list = groups.get(key) ?? [];
        list.push(inst);
        groups.set(key, list);
      }

      const result: InstalledGroupItem[] = [];
      for (const [key, list] of groups.entries()) {
        result.push(new InstalledGroupItem(key, key, list));
      }

      return result;
    }

    if (element instanceof InstalledGroupItem) {
      return element.installations.map((inst) => new InstalledInstallationItem(inst));
    }

    return [];
  }
}
