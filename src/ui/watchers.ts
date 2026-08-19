import * as vscode from 'vscode';

export function setupFileWatchers(onChanged: () => void): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  let timeout: NodeJS.Timeout | null = null;
  const triggerDebounced = () => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      onChanged();
    }, 250);
  };

  const patterns = [
    '**/.claude/**',
    '**/.kilo/**',
    '**/.github/skills/**',
    '**/.github/agents/**',
    '**/.github/prompts/**',
    '**/.vscode/mcp.json',
    '**/.vscode/ai-swissknife/**',
    '**/.ai-swissknife/**',
  ];

  for (const pattern of patterns) {
    try {
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      if (watcher) {
        watcher.onDidChange(triggerDebounced);
        watcher.onDidCreate(triggerDebounced);
        watcher.onDidDelete(triggerDebounced);
        disposables.push(watcher);
      }
    } catch {
      // ignore in environments without watcher support
    }
  }

  disposables.push({
    dispose: () => {
      if (timeout) clearTimeout(timeout);
    },
  });

  return disposables;
}
