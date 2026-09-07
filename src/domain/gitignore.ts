import * as fs from 'fs';
import * as path from 'path';
import { statePath } from './registry';

/**
 * Ensures that the project-scoped state.json file is ignored in the workspace's .gitignore.
 *
 * If .gitignore does not exist in workspaceRoot, returns without creating one.
 * If .gitignore already contains the relative state path, returns without modifying the file.
 * Otherwise, appends the relative state path preserving the file's existing trailing-newline convention.
 */
export async function ensureStateIgnored(workspaceRoot: string): Promise<void> {
  const gitignorePath = path.join(workspaceRoot, '.gitignore');
  let content: string;
  try {
    content = await fs.promises.readFile(gitignorePath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw err;
  }

  const stateFilePath = statePath('project', workspaceRoot);
  const relPath = path.relative(workspaceRoot, stateFilePath).split(path.sep).join('/');

  const lines = content.split(/\r?\n/);
  const alreadyIgnored = lines.some((line) => {
    const trimmed = line.trim();
    return (
      trimmed === relPath ||
      trimmed === `/${relPath}` ||
      trimmed === `./${relPath}`
    );
  });

  if (alreadyIgnored) {
    return;
  }

  const hasCRLF = content.includes('\r\n');
  const eol = hasCRLF ? '\r\n' : '\n';
  const hasTrailingNewline = content.endsWith('\n');

  let newContent: string;
  if (content.length === 0) {
    newContent = relPath + eol;
  } else if (hasTrailingNewline) {
    newContent = content + relPath + (content.endsWith('\r\n') ? '\r\n' : '\n');
  } else {
    newContent = content + eol + relPath;
  }

  await fs.promises.writeFile(gitignorePath, newContent, 'utf-8');
}
