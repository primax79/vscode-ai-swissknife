import * as fs from 'fs';
import * as path from 'path';
import type { ItemKind, Scope } from '../domain/types';
import { manifestPath } from '../domain/registry';

/**
 * Moves a file or directory into a soft-delete location for recoverability.
 * Target location is <ai-swissknife-root>/_deleted/<kind>/<name>-<ISO timestamp>/
 *
 * @param originalPath The absolute path of the file/directory to soft-delete.
 * @param kind The kind of the item being deleted.
 * @param name The name of the item.
 * @param scope The scope (global or project) to determine the base .ai-swissknife folder.
 * @param projectRoot The project root (required if scope is 'project').
 * @param homeRoot Optional home root for testing.
 * @returns The final path where the item was moved.
 */
export async function softDeletePath(
  originalPath: string,
  kind: ItemKind,
  name: string,
  scope: Scope,
  projectRoot?: string,
  homeRoot?: string
): Promise<string> {
  const swissknifeRoot = path.dirname(manifestPath(scope, projectRoot, homeRoot));
  
  // Create a filesystem-safe ISO string
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const targetName = `${name}-${timestamp}`;
  const targetDir = path.join(swissknifeRoot, '_deleted', kind, targetName);

  await fs.promises.mkdir(path.dirname(targetDir), { recursive: true });

  try {
    await fs.promises.rename(originalPath, targetDir);
  } catch (err: unknown) {
    // If rename fails (e.g. EXDEV across devices), fallback to copy+delete
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EXDEV') {
      const stat = await fs.promises.stat(originalPath);
      if (stat.isDirectory()) {
        await copyDirectory(originalPath, targetDir);
        await fs.promises.rm(originalPath, { recursive: true, force: true });
      } else {
        await fs.promises.copyFile(originalPath, targetDir);
        await fs.promises.unlink(originalPath);
      }
    } else {
      throw err;
    }
  }

  return targetDir;
}

async function copyDirectory(src: string, dest: string): Promise<void> {
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}
