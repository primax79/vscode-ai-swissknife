import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * One node in the raw file browser nested under an artifact (installed,
 * observed-unmanaged, or available-but-not-yet-installed). Lets any tree
 * view offer the same "expand to see the actual files" navigation without
 * duplicating the directory-walk/sort logic.
 *
 * `readonly` marks files that live inside a source's local clone/cache
 * (git-*, remote-url) rather than the user's own editable copy
 * (local-folder sources, or anything already installed) — edits there
 * would silently vanish on the next fetch, so they open as a read-only
 * preview instead of the real file.
 */
export class ArtifactFileItem {
  constructor(
    public readonly label: string,
    public readonly fsPath: string,
    public readonly isDir: boolean,
    public readonly readonly: boolean = false
  ) {}
}

/**
 * Whether `fsPath` points to an existing directory, i.e. whether it's worth
 * offering as an expandable browsing root. Artifacts that resolve to a
 * single file (most agents/commands/hooks/rules) have nothing to expand.
 */
export function isBrowsableDirectory(fsPath: string | undefined): fsPath is string {
  if (!fsPath) return false;
  try {
    return fs.statSync(fsPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Lists the entries of `dirPath` as `ArtifactFileItem`s, directories first,
 * then alphabetical. Used both for an artifact's own root directory and for
 * recursing into subfolders.
 */
export function listArtifactFiles(dirPath: string, readonly: boolean = false): ArtifactFileItem[] {
  try {
    const files = fs.readdirSync(dirPath);
    return files
      .map((f) => {
        const p = path.join(dirPath, f);
        let isDir = false;
        try {
          isDir = fs.statSync(p).isDirectory();
        } catch {
          // ignore
        }
        return new ArtifactFileItem(f, p, isDir, readonly);
      })
      .sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.label.localeCompare(b.label);
      });
  } catch {
    return [];
  }
}

export function getArtifactFileChildren(element: ArtifactFileItem): ArtifactFileItem[] {
  return element.isDir ? listArtifactFiles(element.fsPath, element.readonly) : [];
}

/**
 * Serves read-only previews of cached source files under the
 * `ai-swissknife-readonly-file` scheme, so opening them can never be
 * mistaken for editing the user's own files (there is nothing to save
 * back to — the scheme has no writer).
 */
class ReadonlyFileContentProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = 'ai-swissknife-readonly-file';
  private contentMap = new Map<string, string>();

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contentMap.get(uri.toString()) ?? '';
  }

  open(fsPath: string): vscode.Uri {
    let content: string;
    try {
      content = fs.readFileSync(fsPath, 'utf8');
    } catch (err) {
      content = `Unable to read file: ${err instanceof Error ? err.message : String(err)}`;
    }
    // fsPath already carries its own extension (if any) — only append a
    // fake one for extensionless files (e.g. "LICENSE") so VS Code still
    // picks a reasonable editor/syntax for the preview.
    const suffix = path.extname(fsPath) ? '' : '.txt';
    const uri = vscode.Uri.parse(
      `${ReadonlyFileContentProvider.scheme}:${encodeURIComponent(fsPath)}${suffix}`
    );
    this.contentMap.set(uri.toString(), content);
    return uri;
  }
}

export const readonlyFileContentProvider = new ReadonlyFileContentProvider();
export { ReadonlyFileContentProvider };

export function getArtifactFileTreeItem(element: ArtifactFileItem): vscode.TreeItem {
  const item = new vscode.TreeItem(
    element.label,
    element.isDir ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
  );
  item.contextValue = 'artifactFile';
  if (element.isDir) {
    item.iconPath = vscode.ThemeIcon.Folder;
  } else {
    item.iconPath = vscode.ThemeIcon.File;
    item.command = element.readonly
      ? {
          command: 'vscode.open',
          title: 'Preview File (read-only)',
          arguments: [readonlyFileContentProvider.open(element.fsPath)],
        }
      : {
          command: 'vscode.open',
          title: 'Open File',
          arguments: [vscode.Uri.file(element.fsPath)],
        };
  }
  return item;
}
