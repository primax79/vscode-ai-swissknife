import { describe, it } from 'node:test';
import * as assert from 'node:assert';

// Setup minimal mock for 'vscode' before importing UI modules in Node test runner
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id: string, ...rest: unknown[]) {
  if (id === 'vscode') {
    return {
      ThemeIcon: class {
        constructor(public id: string) {}
      },
      EventEmitter: class {
        event = () => ({});
        fire = () => {};
      },
      TreeItem: class {
        public iconPath?: any;
        public contextValue?: string;
        public description?: string;
        constructor(public label: string, public collapsibleState?: any) {}
      },
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      workspace: {
        workspaceFolders: [],
        getConfiguration: () => ({ get: () => undefined }),
      },
      window: {
        showQuickPick: async () => undefined,
      },
    };
  }
  return originalRequire.apply(this, [id, ...rest]);
};

import {
  getScopeIconName,
  getScopeIconSvg,
  getScopeLabel,
  getScopeQuickPickItems,
} from './scopeIcons';
import { InstalledTreeDataProvider, ScopeGroupItem as InstalledScopeGroupItem } from './installedView';

describe('scopeIcons', () => {
  it('both scopes give a non-empty icon name and labels are exactly Global and Workspace', () => {
    const globalIcon = getScopeIconName('global');
    const projectIcon = getScopeIconName('project');
    assert.ok(globalIcon && globalIcon.length > 0);
    assert.ok(projectIcon && projectIcon.length > 0);
    assert.strictEqual(globalIcon, 'globe');
    assert.strictEqual(projectIcon, 'folder');
    assert.notStrictEqual(globalIcon, projectIcon);

    const globalLabel = getScopeLabel('global');
    const projectLabel = getScopeLabel('project');
    assert.strictEqual(globalLabel, 'Global');
    assert.strictEqual(projectLabel, 'Workspace');
    assert.notStrictEqual(globalLabel, projectLabel);
  });

  it('both scopes return an SVG containing <svg and the outputs differ', () => {
    const globalSvg = getScopeIconSvg('global');
    const projectSvg = getScopeIconSvg('project');
    assert.ok(globalSvg.includes('<svg'));
    assert.ok(globalSvg.includes('width="14"'));
    assert.ok(globalSvg.includes('height="14"'));
    assert.ok(globalSvg.includes('fill="currentColor"'));

    assert.ok(projectSvg.includes('<svg'));
    assert.ok(projectSvg.includes('width="14"'));
    assert.ok(projectSvg.includes('height="14"'));
    assert.ok(projectSvg.includes('fill="currentColor"'));

    assert.notStrictEqual(globalSvg, projectSvg);
  });

  it('QuickPick helpers return both items with values global and project', () => {
    const items = getScopeQuickPickItems();
    assert.strictEqual(items.length, 2);

    assert.strictEqual(items[0].label, 'Global');
    assert.strictEqual(items[0].value, 'global');
    assert.strictEqual((items[0].iconPath as any).id, 'globe');

    assert.strictEqual(items[1].label, 'Workspace');
    assert.strictEqual(items[1].value, 'project');
    assert.strictEqual((items[1].iconPath as any).id, 'folder');
  });

  it('installedView scope group items carry the ThemeIcon from getScopeIconName', () => {
    const provider = new InstalledTreeDataProvider({ fsPath: '/test/ext' } as any);
    const globalGroup = new InstalledScopeGroupItem('claude-code', 'global', 'Global', [], []);
    const projectGroup = new InstalledScopeGroupItem('claude-code', 'project', 'Workspace', [], []);

    const globalTreeItem = provider.getTreeItem(globalGroup);
    const projectTreeItem = provider.getTreeItem(projectGroup);

    assert.ok(globalTreeItem.iconPath);
    assert.strictEqual((globalTreeItem.iconPath as any).id, getScopeIconName('global'));
    assert.strictEqual((globalTreeItem.iconPath as any).id, 'globe');

    assert.ok(projectTreeItem.iconPath);
    assert.strictEqual((projectTreeItem.iconPath as any).id, getScopeIconName('project'));
    assert.strictEqual((projectTreeItem.iconPath as any).id, 'folder');
  });
});
