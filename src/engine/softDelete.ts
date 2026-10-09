import * as fs from 'fs';
import * as path from 'path';
import type { AssistantId, ItemKind, Scope } from '../domain/types';
import { manifestPath } from '../domain/registry';

export interface TrashOrigin {
  originalPath: string;
  assistant?: AssistantId;
  scope: Scope;
  kind: ItemKind;
  name: string;
  deletedAt: string;
  isDirectory?: boolean;
}

export interface SoftDeleteOptions {
  assistant?: AssistantId;
}

export interface TrashEntry {
  kind: ItemKind;
  name: string;
  deletedAt: string;
  trashPath: string;
  originalPath?: string;
  assistant?: AssistantId;
  scope: Scope;
}

export interface RestoreOptions {
  overwrite?: boolean;
}

export type RestoreResult =
  | { status: 'restored'; restoredPath: string }
  | { status: 'conflict'; targetPath: string; message: string };

export interface EmptyTrashFailedItem {
  entry: TrashEntry;
  error: string;
}

export interface EmptyTrashResult {
  count: number;
  failed: Array<EmptyTrashFailedItem & TrashEntry>;
}

/**
 * Moves a file or directory into a soft-delete location for recoverability.
 * Target location is <ai-swissknife-root>/_deleted/<kind>/<name>-<ISO timestamp>/
 * Writes sidecar <trashDir>/.origin.json recording original path and metadata.
 *
 * @param originalPath The absolute path of the file/directory to soft-delete.
 * @param kind The kind of the item being deleted.
 * @param name The name of the item.
 * @param scope The scope (global or project) to determine the base .ai-swissknife folder.
 * @param projectRoot The project root (required if scope is 'project').
 * @param homeRoot Optional home root for testing.
 * @param extra Optional extra info like assistant.
 * @returns The final path where the item was moved.
 */
export async function softDeletePath(
  originalPath: string,
  kind: ItemKind,
  name: string,
  scope: Scope,
  projectRoot?: string,
  homeRoot?: string,
  extra?: SoftDeleteOptions
): Promise<string> {
  const swissknifeRoot = path.dirname(manifestPath(scope, projectRoot, homeRoot));
  
  // Create a filesystem-safe ISO string
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const targetName = `${name}-${timestamp}`;
  let targetDir = path.join(swissknifeRoot, '_deleted', kind, targetName);

  if (fs.existsSync(targetDir)) {
    const nonce = Math.random().toString(36).slice(2, 6);
    targetDir = `${targetDir}-${nonce}`;
  }

  await fs.promises.mkdir(targetDir, { recursive: true });

  const stat = await fs.promises.stat(originalPath);
  const isDirectory = stat.isDirectory();
  let finalMovedPath: string;

  if (isDirectory) {
    finalMovedPath = targetDir;
    await fs.promises.rmdir(targetDir);
    await movePathWithFallback(originalPath, targetDir);
  } else {
    finalMovedPath = path.join(targetDir, path.basename(originalPath));
    await movePathWithFallback(originalPath, finalMovedPath);
  }

  const origin: TrashOrigin = {
    originalPath,
    ...(extra?.assistant ? { assistant: extra.assistant } : {}),
    scope,
    kind,
    name,
    deletedAt: new Date().toISOString(),
    isDirectory,
  };

  await fs.promises.writeFile(
    path.join(targetDir, '.origin.json'),
    JSON.stringify(origin, null, 2),
    'utf-8'
  );

  return finalMovedPath;
}

/**
 * Copies a file or directory into a trash location with a .origin.json sidecar
 * without removing the original file/directory.
 */
export async function copyToTrash(
  originalPath: string,
  kind: ItemKind,
  name: string,
  scope: Scope,
  projectRoot?: string,
  homeRoot?: string,
  extra?: SoftDeleteOptions
): Promise<string> {
  const swissknifeRoot = path.dirname(manifestPath(scope, projectRoot, homeRoot));
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const targetName = `${name}-${timestamp}`;
  let targetDir = path.join(swissknifeRoot, '_deleted', kind, targetName);

  if (fs.existsSync(targetDir)) {
    const nonce = Math.random().toString(36).slice(2, 6);
    targetDir = `${targetDir}-${nonce}`;
  }

  await fs.promises.mkdir(targetDir, { recursive: true });

  if (!fs.existsSync(originalPath)) {
    return targetDir;
  }

  const stat = await fs.promises.stat(originalPath);
  const isDirectory = stat.isDirectory();

  if (isDirectory) {
    await copyDirectory(originalPath, targetDir);
  } else {
    await fs.promises.copyFile(originalPath, path.join(targetDir, path.basename(originalPath)));
  }

  const origin: TrashOrigin = {
    originalPath,
    ...(extra?.assistant ? { assistant: extra.assistant } : {}),
    scope,
    kind,
    name,
    deletedAt: new Date().toISOString(),
    isDirectory,
  };

  await fs.promises.writeFile(
    path.join(targetDir, '.origin.json'),
    JSON.stringify(origin, null, 2),
    'utf-8'
  );

  return targetDir;
}

function parseTrashName(entryName: string): string {
  const match = entryName.match(/^(.*?)-(\d{4}-\d{2}-\d{2}T[\d-]+Z)(?:-[a-z0-9]+)?$/);
  if (match) {
    return match[1];
  }
  return entryName;
}

/**
 * Lists all trash entries for the given scope, newest first.
 * Entries without a sidecar (.origin.json) are listed with originalPath undefined ("origin unknown").
 */
export async function listTrash(
  scope: Scope,
  projectRoot?: string,
  homeRoot?: string
): Promise<TrashEntry[]> {
  const swissknifeRoot = path.dirname(manifestPath(scope, projectRoot, homeRoot));
  const deletedRoot = path.join(swissknifeRoot, '_deleted');

  if (!fs.existsSync(deletedRoot)) {
    return [];
  }

  const entries: TrashEntry[] = [];
  const kindDirs = await fs.promises.readdir(deletedRoot, { withFileTypes: true });

  for (const dirEntry of kindDirs) {
    if (!dirEntry.isDirectory()) continue;
    const kind = dirEntry.name as ItemKind;
    const kindPath = path.join(deletedRoot, kind);
    const items = await fs.promises.readdir(kindPath, { withFileTypes: true });

    for (const itemEntry of items) {
      if (itemEntry.name.startsWith('.')) continue;
      const itemPath = path.join(kindPath, itemEntry.name);

      if (itemEntry.isDirectory()) {
        const sidecarPath = path.join(itemPath, '.origin.json');
        if (fs.existsSync(sidecarPath)) {
          try {
            const origin = JSON.parse(
              await fs.promises.readFile(sidecarPath, 'utf-8')
            ) as TrashOrigin;
            entries.push({
              kind: origin.kind || kind,
              name: origin.name || parseTrashName(itemEntry.name),
              deletedAt: origin.deletedAt || (await fs.promises.stat(itemPath)).mtime.toISOString(),
              trashPath: itemPath,
              originalPath: origin.originalPath,
              assistant: origin.assistant,
              scope: origin.scope || scope,
            });
            continue;
          } catch {
            // invalid JSON fallback below
          }
        }

        // Directory without sidecar (origin unknown)
        const stat = await fs.promises.stat(itemPath);
        entries.push({
          kind,
          name: parseTrashName(itemEntry.name),
          deletedAt: stat.mtime.toISOString(),
          trashPath: itemPath,
          originalPath: undefined,
          scope,
        });
      } else if (itemEntry.isFile()) {
        // Legacy file entry directly in _deleted/<kind>/
        const stat = await fs.promises.stat(itemPath);
        entries.push({
          kind,
          name: parseTrashName(itemEntry.name),
          deletedAt: stat.mtime.toISOString(),
          trashPath: itemPath,
          originalPath: undefined,
          scope,
        });
      }
    }
  }

  return entries.sort(
    (a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime()
  );
}

/**
 * Restores an entry from trash to targetPath.
 * Never overwrites: if targetPath exists and overwrite is not true, returns typed conflict.
 */
export async function restoreFromTrash(
  entry: TrashEntry,
  targetPath: string,
  opts?: RestoreOptions
): Promise<RestoreResult> {
  if (fs.existsSync(targetPath) && !opts?.overwrite) {
    return {
      status: 'conflict',
      targetPath,
      message: `Destination path already exists: ${targetPath}`,
    };
  }

  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });

  const stat = await fs.promises.stat(entry.trashPath);
  if (stat.isDirectory()) {
    const sidecarPath = path.join(entry.trashPath, '.origin.json');
    let origin: TrashOrigin | undefined;
    if (fs.existsSync(sidecarPath)) {
      try {
        origin = JSON.parse(await fs.promises.readFile(sidecarPath, 'utf-8'));
      } catch {
        // ignore
      }
    }

    if (origin && origin.isDirectory === false) {
      // Single file inside trash directory
      const files = (await fs.promises.readdir(entry.trashPath)).filter((f) => f !== '.origin.json');
      const payloadFile = files[0] ? path.join(entry.trashPath, files[0]) : undefined;
      if (payloadFile && fs.existsSync(payloadFile)) {
        await movePathWithFallback(payloadFile, targetPath);
      }
      await fs.promises.rm(entry.trashPath, { recursive: true, force: true });
      return { status: 'restored', restoredPath: targetPath };
    }

    // Directory in trash (either origin.isDirectory === true or legacy directory without origin)
    if (fs.existsSync(sidecarPath)) {
      await fs.promises.rm(sidecarPath, { force: true });
    }
    await movePathWithFallback(entry.trashPath, targetPath);
    return { status: 'restored', restoredPath: targetPath };
  } else {
    // Legacy file directly on disk
    await movePathWithFallback(entry.trashPath, targetPath);
    return { status: 'restored', restoredPath: targetPath };
  }
}

/**
 * Permanently deletes one trash entry from disk.
 */
export async function deleteFromTrash(entry: TrashEntry | string): Promise<void> {
  const trashPath = typeof entry === 'string' ? entry : entry.trashPath;
  await fs.promises.rm(trashPath, { recursive: true, force: true });
}

/**
 * Permanently removes every entry of the scope (or both scopes when omitted).
 * Returns count of deleted entries and failed entries. A failure does not stop others.
 */
export async function emptyTrash(
  scope?: Scope,
  projectRoot?: string,
  homeRoot?: string
): Promise<EmptyTrashResult> {
  let scopes: Scope[];
  if (scope) {
    scopes = [scope];
  } else {
    scopes = projectRoot ? ['global', 'project'] : ['global'];
  }

  const allEntries: TrashEntry[] = [];
  for (const s of scopes) {
    const entries = await listTrash(s, s === 'project' ? projectRoot : undefined, homeRoot);
    allEntries.push(...entries);
  }

  let count = 0;
  const failed: Array<EmptyTrashFailedItem & TrashEntry> = [];

  for (const entry of allEntries) {
    try {
      await deleteFromTrash(entry);
      count++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push(Object.assign({}, entry, { entry, error: msg }));
    }
  }

  return { count, failed };
}

/**
 * Returns a human-readable relative time string.
 */
export function formatRelativeTime(dateInput: string | Date | number): string {
  const date = typeof dateInput === 'string' || typeof dateInput === 'number' ? new Date(dateInput) : dateInput;
  const now = Date.now();
  const diffMs = now - date.getTime();
  if (isNaN(diffMs) || diffMs < 0) return 'just now';
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} hour${diffHour === 1 ? '' : 's'} ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth} month${diffMonth === 1 ? '' : 's'} ago`;
  const diffYear = Math.floor(diffDay / 365);
  return `${diffYear} year${diffYear === 1 ? '' : 's'} ago`;
}

async function movePathWithFallback(src: string, dest: string): Promise<void> {
  try {
    await fs.promises.rename(src, dest);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EXDEV') {
      const stat = await fs.promises.stat(src);
      if (stat.isDirectory()) {
        await copyDirectory(src, dest);
        await fs.promises.rm(src, { recursive: true, force: true });
      } else {
        await fs.promises.copyFile(src, dest);
        await fs.promises.unlink(src);
      }
    } else {
      throw err;
    }
  }
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

