import * as os from 'os';
import type { Scope, Source } from '../domain/types';
import {
  toDesiredSource,
  readManifest,
  writeManifest,
  withStateLock,
  type DesiredSource,
} from '../domain/registry';
import { validateLocation, validateLocalFolder } from '../sources/sourceDefaults';
import { CliError } from '../cli/output';

export interface AddSourceOptions {
  projectRoot?: string;
  homeRoot?: string;
  replace?: boolean;
}

export interface RemoveSourceOptions {
  projectRoot?: string;
  homeRoot?: string;
}

/**
 * Adds a source to the manifest for the given scope:
 * - Validates location and local folder constraints.
 * - Under state lock, checks for duplicate ID (throws DUPLICATE_ID error unless replace is true).
 * - Writes the updated manifest.
 */
export async function addSourceToManifest(
  source: Source,
  options?: AddSourceOptions
): Promise<DesiredSource> {
  const location = source.type === 'local-folder' ? source.localPath : source.url;
  if (!location) {
    throw new CliError('INVALID_ARGUMENT', 'Source location cannot be empty');
  }

  const locError = validateLocation(source.type, location);
  if (locError) {
    throw new CliError('INVALID_ARGUMENT', locError);
  }

  if (source.type === 'local-folder') {
    const rootDir =
      source.scope === 'project'
        ? (options?.projectRoot ?? process.cwd())
        : (options?.homeRoot ?? os.homedir());
    const folderError = validateLocalFolder(location, source.scope, rootDir);
    if (folderError) {
      throw new CliError('INVALID_ARGUMENT', folderError);
    }
  }

  const root = source.scope === 'project' ? (options?.projectRoot ?? source.projectPath) : undefined;
  const desired = toDesiredSource(source, root, options?.homeRoot);

  await withStateLock(source.scope, root, options?.homeRoot, async () => {
    const manifest = await readManifest(source.scope, root, options?.homeRoot);
    const existing = manifest.sources.find((s) => s.id === desired.id);
    if (existing && !options?.replace) {
      throw new CliError(
        'DUPLICATE_ID',
        `Source "${desired.id}" already exists in ${source.scope} scope`
      );
    }
    manifest.sources = manifest.sources.filter((s) => s.id !== desired.id);
    manifest.sources.push(desired);
    await writeManifest(source.scope, manifest, root, options?.homeRoot);
  });

  return desired;
}

/**
 * Removes a source from the manifest for the given scope:
 * - Under state lock, finds and removes the source and any dependent desired installations.
 * - Throws NOT_FOUND if the source does not exist.
 * - Writes the updated manifest.
 */
export async function removeSourceFromManifest(
  sourceId: string,
  scope: Scope,
  options?: RemoveSourceOptions
): Promise<DesiredSource> {
  const root = scope === 'project' ? options?.projectRoot : undefined;
  return await withStateLock(scope, root, options?.homeRoot, async () => {
    const manifest = await readManifest(scope, root, options?.homeRoot);
    const existingIndex = manifest.sources.findIndex((s) => s.id === sourceId);
    if (existingIndex === -1) {
      throw new CliError('NOT_FOUND', `Source "${sourceId}" not found in ${scope} scope`);
    }
    const removed = manifest.sources[existingIndex];
    manifest.sources.splice(existingIndex, 1);
    manifest.desiredInstallations = manifest.desiredInstallations.filter(
      (d) => d.sourceId !== sourceId
    );
    await writeManifest(scope, manifest, root, options?.homeRoot);
    return removed;
  });
}
