import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Scope, AssistantId, Source, ManagedInstallation } from './types';
import { ensureStateIgnored } from './gitignore';

export { ensureStateIgnored } from './gitignore';
export {
  withStateLock,
  stateLockPath,
  StateLockTimeoutError,
  StateLockOptions,
} from './stateLock';

export const SCHEMA_VERSION = 1;

export interface DesiredSource {
  id: string;
  type: Source['type'];
  scope: Scope;
  name?: string;
  url?: string;
  branch?: string;
  tag?: string;
  commit?: string;
  localPath?: string; // relative to the scope root; never absolute
}

export interface DesiredInstallation {
  sourceId: string;
  artifactId: string;
  assistant: AssistantId;
  scope: Scope;
  requestedRef?: string;
}

export interface ManifestFile {
  schemaVersion: number;
  sources: DesiredSource[];
  desiredInstallations: DesiredInstallation[];
}

export interface StateFile {
  schemaVersion: number;
  installations: ManagedInstallation[];
}

export function emptyManifest(): ManifestFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    sources: [],
    desiredInstallations: [],
  };
}

export function emptyState(): StateFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    installations: [],
  };
}

export function manifestPath(scope: Scope, projectRoot?: string, homeRoot?: string): string {
  if (scope === 'global') {
    return path.join(homeRoot ?? os.homedir(), '.ai-swissknife', 'manifest.json');
  }

  if (scope === 'project') {
    if (!projectRoot) {
      throw new Error('projectRoot is required when scope is "project"');
    }
    const standardPath = path.join(projectRoot, '.vscode', 'ai-swissknife', 'manifest.json');
    const legacyPath = path.join(projectRoot, '.ai-swissknife', 'manifest.json');
    if (!fs.existsSync(standardPath) && fs.existsSync(legacyPath)) {
      return legacyPath;
    }
    return standardPath;
  }

  throw new Error(`Unsupported scope: ${scope}`);
}

export function statePath(scope: Scope, projectRoot?: string, homeRoot?: string): string {
  if (scope === 'global') {
    return path.join(homeRoot ?? os.homedir(), '.ai-swissknife', 'state.json');
  }

  if (scope === 'project') {
    if (!projectRoot) {
      throw new Error('projectRoot is required when scope is "project"');
    }
    const standardPath = path.join(projectRoot, '.vscode', 'ai-swissknife', 'state.json');
    const legacyPath = path.join(projectRoot, '.ai-swissknife', 'state.json');
    if (!fs.existsSync(standardPath) && fs.existsSync(legacyPath)) {
      return legacyPath;
    }
    return standardPath;
  }

  throw new Error(`Unsupported scope: ${scope}`);
}

export function toDesiredSource(
  source: Source,
  workspaceRoot?: string,
  homeRoot?: string
): DesiredSource {
  let relativeLocalPath: string | undefined;

  if (source.scope === 'project') {
    if (source.localPath !== undefined) {
      if (!workspaceRoot) {
        throw new Error('workspaceRoot is required to serialize project-scope localPath');
      }
      const absWorkspace = path.resolve(workspaceRoot);
      const absLocal = path.isAbsolute(source.localPath)
        ? path.resolve(source.localPath)
        : path.resolve(absWorkspace, source.localPath);
      const rel = path.relative(absWorkspace, absLocal);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`Path "${source.localPath}" lies outside workspace root "${workspaceRoot}"`);
      }
      relativeLocalPath = rel;
    }
  } else if (source.scope === 'global') {
    if (source.localPath !== undefined) {
      const absHome = path.resolve(homeRoot ?? os.homedir());
      const absLocal = path.isAbsolute(source.localPath)
        ? path.resolve(source.localPath)
        : path.resolve(absHome, source.localPath);
      const rel = path.relative(absHome, absLocal);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`Path "${source.localPath}" lies outside home root "${absHome}"`);
      }
      relativeLocalPath = rel;
    }
  }

  const desired: DesiredSource = {
    id: source.id,
    type: source.type,
    scope: source.scope,
  };

  if (source.name !== undefined) desired.name = source.name;
  if (source.url !== undefined) desired.url = source.url;
  if (source.branch !== undefined) desired.branch = source.branch;
  if (source.tag !== undefined) desired.tag = source.tag;
  if (source.commit !== undefined) desired.commit = source.commit;
  if (relativeLocalPath !== undefined) desired.localPath = relativeLocalPath;

  return desired;
}

export function fromDesiredSource(
  desired: DesiredSource,
  workspaceRoot?: string,
  homeRoot?: string
): Source {
  let resolvedLocalPath: string | undefined;

  if (desired.scope === 'project') {
    if (desired.localPath !== undefined) {
      resolvedLocalPath = workspaceRoot
        ? path.resolve(workspaceRoot, desired.localPath)
        : desired.localPath;
    }
  } else if (desired.scope === 'global') {
    if (desired.localPath !== undefined) {
      const absHome = homeRoot ?? os.homedir();
      resolvedLocalPath = path.resolve(absHome, desired.localPath);
    }
  }

  const source: Source = {
    id: desired.id,
    type: desired.type,
    scope: desired.scope,
  };

  if (desired.scope === 'project' && workspaceRoot) {
    source.projectPath = workspaceRoot;
  }
  if (desired.name !== undefined) source.name = desired.name;
  if (desired.url !== undefined) source.url = desired.url;
  if (desired.branch !== undefined) source.branch = desired.branch;
  if (desired.tag !== undefined) source.tag = desired.tag;
  if (desired.commit !== undefined) source.commit = desired.commit;
  if (resolvedLocalPath !== undefined) source.localPath = resolvedLocalPath;

  return source;
}

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const parentDir = path.dirname(filePath);
  await fs.promises.mkdir(parentDir, { recursive: true });

  const randomSuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tempPath = `${filePath}.tmp-${randomSuffix}`;
  const serialized = JSON.stringify(data, null, 2) + '\n';

  try {
    await fs.promises.writeFile(tempPath, serialized, 'utf-8');
    await fs.promises.rename(tempPath, filePath);
  } catch (err) {
    try {
      await fs.promises.unlink(tempPath);
    } catch {
      // ignore
    }
    throw err;
  }
}

export async function readManifest(
  scope: Scope,
  projectRoot?: string,
  homeRoot?: string
): Promise<ManifestFile> {
  const filePath = manifestPath(scope, projectRoot, homeRoot);

  let rawContent: string;
  try {
    rawContent = await fs.promises.readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyManifest();
    }
    throw err;
  }

  let parsed: ManifestFile;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse manifest JSON at ${filePath}: ${message}`);
  }

  if (parsed?.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported manifest schemaVersion: ${parsed?.schemaVersion} at ${filePath}`
    );
  }

  return {
    schemaVersion: parsed.schemaVersion,
    sources: Array.isArray(parsed.sources) ? parsed.sources : [],
    desiredInstallations: Array.isArray(parsed.desiredInstallations)
      ? parsed.desiredInstallations
      : [],
  };
}

export async function writeManifest(
  scope: Scope,
  data: ManifestFile,
  projectRoot?: string,
  homeRoot?: string
): Promise<void> {
  const filePath = manifestPath(scope, projectRoot, homeRoot);
  await atomicWriteJson(filePath, data);
  if (scope === 'project' && projectRoot) {
    await ensureStateIgnored(projectRoot);
  }
}

export async function readState(
  scope: Scope,
  projectRoot?: string,
  homeRoot?: string
): Promise<StateFile> {
  const filePath = statePath(scope, projectRoot, homeRoot);

  let rawContent: string;
  try {
    rawContent = await fs.promises.readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyState();
    }
    throw err;
  }

  let parsed: StateFile;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse state JSON at ${filePath}: ${message}`);
  }

  if (parsed?.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Unsupported state schemaVersion: ${parsed?.schemaVersion} at ${filePath}`);
  }

  return {
    schemaVersion: parsed.schemaVersion,
    installations: Array.isArray(parsed.installations) ? parsed.installations : [],
  };
}

export async function writeState(
  scope: Scope,
  data: StateFile,
  projectRoot?: string,
  homeRoot?: string
): Promise<void> {
  const filePath = statePath(scope, projectRoot, homeRoot);
  await atomicWriteJson(filePath, data);
}
