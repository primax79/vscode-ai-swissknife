import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  Scope,
  AssistantId,
  ItemKind,
  Source,
  ManagedInstallation,
  InstallationSourceIdentity,
} from './types';
import { ensureStateIgnored } from './gitignore';
import {
  evaluateProvenanceCandidates,
  applyProvenanceEvaluation,
  setProvenanceResolvedCallback,
} from '../engine/drift';
import type { SourceResolution } from '../sources/types';

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
  readWorkingTree?: boolean;
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
  if (source.readWorkingTree !== undefined) desired.readWorkingTree = source.readWorkingTree;

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
  if (desired.readWorkingTree !== undefined) source.readWorkingTree = desired.readWorkingTree;

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

let _skipStateMigrationWrite = false;

/**
 * Controls whether `readState` suppresses on-disk persistence of migrated state
 * (used by read-only / plan-only CLI commands so directory snapshots stay untouched).
 */
export function setSkipStateMigrationWrite(skip: boolean): void {
  _skipStateMigrationWrite = skip;
}

export function isSkipStateMigrationWrite(): boolean {
  return _skipStateMigrationWrite;
}

/**
 * Backs up `filePath` as `state.json.bak-<timestamp>` next to it if no backup
 * file (`state.json.bak-*`) exists in that directory yet.
 */
export async function backupStateFileOnce(filePath: string): Promise<string | undefined> {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const prefix = `${base}.bak-`;
  try {
    const entries = await fs.promises.readdir(dir);
    const existing = entries.find((name) => name.startsWith(prefix));
    if (existing) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  const backupPath = path.join(dir, `${prefix}${Date.now()}`);
  await fs.promises.copyFile(filePath, backupPath);
  return backupPath;
}

export interface StateMigrationEntryReport {
  name: string;
  assistant: AssistantId;
  scope: Scope;
  kind: ItemKind;
  sourceId?: string;
  outcome: 'already-has-source' | 'adopted' | 'provenance-unknown';
  adoptedSource?: InstallationSourceIdentity;
  reason?: string;
  hint?: string;
}

export interface StateMigrationReport {
  filePath: string;
  backupPath?: string;
  totalInstallations: number;
  alreadyHadSource: number;
  adoptedCount: number;
  unknownCount: number;
  reasons: Record<string, number>;
  entries: StateMigrationEntryReport[];
  state: StateFile;
}

async function gatherCandidateSourcesForMigration(
  neededSourceIds: Set<string>,
  projectRoot?: string,
  homeRoot?: string,
  installations?: ManagedInstallation[]
): Promise<Source[]> {
  if (neededSourceIds.size === 0) {
    return [];
  }
  const sources: Source[] = [];
  try {
    const gManifest = await readManifest('global', undefined, homeRoot);
    for (const ds of gManifest.sources) {
      if (neededSourceIds.has(ds.id)) {
        sources.push(fromDesiredSource(ds, undefined, homeRoot));
      }
    }
  } catch {
    // ignore unreadable global manifest during migration
  }

  const wsRoots = new Set<string>();
  if (projectRoot) {
    wsRoots.add(projectRoot);
  }
  if (installations) {
    for (const inst of installations) {
      if (inst.projectPath) {
        wsRoots.add(inst.projectPath);
      }
    }
  }

  for (const wsRoot of wsRoots) {
    try {
      const pManifest = await readManifest('project', wsRoot, homeRoot);
      for (const ds of pManifest.sources) {
        if (neededSourceIds.has(ds.id)) {
          sources.push(fromDesiredSource(ds, wsRoot, homeRoot));
        }
      }
    } catch {
      // ignore unreadable workspace manifest during migration
    }
  }

  return sources;
}

/**
 * Runs offline provenance migration on a state file (`global` or `project`),
 * backing up the original `state.json` to `state.json.bak-<timestamp>` once before
 * the first migrated write, and returning a structured report.
 */
export async function migrateStateFile(
  scope: Scope,
  projectRoot?: string,
  homeRoot?: string,
  options?: {
    cacheDir?: string;
    persist?: boolean;
  }
): Promise<StateMigrationReport> {
  const filePath = statePath(scope, projectRoot, homeRoot);
  let rawContent: string;
  try {
    rawContent = await fs.promises.readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        filePath,
        totalInstallations: 0,
        alreadyHadSource: 0,
        adoptedCount: 0,
        unknownCount: 0,
        reasons: {},
        entries: [],
        state: emptyState(),
      };
    }
    throw err;
  }

  const parsed: StateFile = JSON.parse(rawContent);
  const installations = Array.isArray(parsed.installations) ? parsed.installations : [];

  const neededSourceIds = new Set<string>();
  for (const inst of installations) {
    if (!inst.source && inst.sourceId) {
      neededSourceIds.add(inst.sourceId);
    }
  }

  const candidateSources = await gatherCandidateSourcesForMigration(
    neededSourceIds,
    projectRoot,
    homeRoot,
    installations
  );

  const preResolved = new Map<string, { resolution?: SourceResolution; error?: Error }>();
  const hashCache = new Map<string, string>();

  let alreadyHadSource = 0;
  let adoptedCount = 0;
  let unknownCount = 0;
  let anyChanged = false;
  const reasons: Record<string, number> = {};
  const entries: StateMigrationEntryReport[] = [];

  for (const inst of installations) {
    if (inst.source) {
      alreadyHadSource++;
      entries.push({
        name: inst.name,
        assistant: inst.assistant,
        scope: inst.scope,
        kind: inst.kind,
        sourceId: inst.sourceId,
        outcome: 'already-has-source',
        adoptedSource: inst.source,
      });
      continue;
    }

    const evalResult = await evaluateProvenanceCandidates(inst, candidateSources, {
      homeRoot,
      cacheDir: options?.cacheDir,
      offline: true,
      preResolved,
      hashCache,
    });
    const changed = applyProvenanceEvaluation(inst, evalResult, homeRoot);
    if (changed) {
      anyChanged = true;
    }

    if (evalResult.outcome === 'adopted') {
      adoptedCount++;
      entries.push({
        name: inst.name,
        assistant: inst.assistant,
        scope: inst.scope,
        kind: inst.kind,
        sourceId: inst.sourceId,
        outcome: 'adopted',
        adoptedSource: inst.source,
      });
    } else {
      unknownCount++;
      reasons[evalResult.reason] = (reasons[evalResult.reason] ?? 0) + 1;
      entries.push({
        name: inst.name,
        assistant: inst.assistant,
        scope: inst.scope,
        kind: inst.kind,
        sourceId: inst.sourceId,
        outcome: 'provenance-unknown',
        reason: evalResult.reason,
        hint: evalResult.hint,
      });
    }
  }

  const migratedState: StateFile = {
    schemaVersion: parsed.schemaVersion ?? SCHEMA_VERSION,
    installations,
  };

  let backupPath: string | undefined;
  const shouldPersist = options?.persist ?? !_skipStateMigrationWrite;
  if (anyChanged && shouldPersist) {
    backupPath = await backupStateFileOnce(filePath);
    await atomicWriteJson(filePath, migratedState);
  }

  return {
    filePath,
    ...(backupPath ? { backupPath } : {}),
    totalInstallations: installations.length,
    alreadyHadSource,
    adoptedCount,
    unknownCount,
    reasons,
    entries,
    state: migratedState,
  };
}

export async function readState(
  scope: Scope,
  projectRoot?: string,
  homeRoot?: string,
  options?: {
    cacheDir?: string;
    persistMigration?: boolean;
  }
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

  const installations = Array.isArray(parsed.installations) ? parsed.installations : [];

  const needsMigration = installations.some(
    (inst) =>
      !inst.source &&
      (inst.provenance !== 'unknown' || inst.provenanceHint === 'check sources to resolve')
  );

  if (needsMigration) {
    const neededSourceIds = new Set<string>();
    for (const inst of installations) {
      if (
        !inst.source &&
        inst.sourceId &&
        (inst.provenance !== 'unknown' || inst.provenanceHint === 'check sources to resolve')
      ) {
        neededSourceIds.add(inst.sourceId);
      }
    }

    const candidateSources = await gatherCandidateSourcesForMigration(
      neededSourceIds,
      projectRoot,
      homeRoot,
      installations
    );

    const preResolved = new Map<string, { resolution?: SourceResolution; error?: Error }>();
    const hashCache = new Map<string, string>();
    let anyChanged = false;

    for (const inst of installations) {
      if (inst.source) {
        continue;
      }
      if (inst.provenance === 'unknown' && inst.provenanceHint !== 'check sources to resolve') {
        continue;
      }
      const evalResult = await evaluateProvenanceCandidates(inst, candidateSources, {
        homeRoot,
        cacheDir: options?.cacheDir,
        offline: true,
        preResolved,
        hashCache,
      });
      const changed = applyProvenanceEvaluation(inst, evalResult, homeRoot);
      if (changed) {
        anyChanged = true;
      }
    }

    const shouldPersist = options?.persistMigration ?? !_skipStateMigrationWrite;
    if (anyChanged && shouldPersist) {
      await backupStateFileOnce(filePath);
      await atomicWriteJson(filePath, {
        schemaVersion: parsed.schemaVersion,
        installations,
      });
    }
  }

  return {
    schemaVersion: parsed.schemaVersion,
    installations,
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

setProvenanceResolvedCallback(async (inst: ManagedInstallation, homeRoot?: string) => {
  if (_skipStateMigrationWrite || !inst.source) {
    return;
  }
  const projectRoot = inst.scope === 'project' ? inst.projectPath : undefined;
  const filePath = statePath(inst.scope, projectRoot, homeRoot);
  if (!fs.existsSync(filePath)) {
    return;
  }
  try {
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    const parsed: StateFile = JSON.parse(raw);
    if (!Array.isArray(parsed.installations)) {
      return;
    }
    const idx = parsed.installations.findIndex(
      (i) =>
        i.assistant === inst.assistant &&
        i.scope === inst.scope &&
        i.kind === inst.kind &&
        i.name === inst.name &&
        i.path === inst.path
    );
    if (idx === -1) {
      return;
    }
    parsed.installations[idx] = {
      ...parsed.installations[idx],
      source: inst.source,
      sourceId: inst.sourceId,
      packageId: inst.packageId,
      artifactId: inst.artifactId,
      ...(inst.sourceRevision ? { sourceRevision: inst.sourceRevision } : {}),
      ...(inst.sourceContentHash ? { sourceContentHash: inst.sourceContentHash } : {}),
    };
    delete parsed.installations[idx].provenance;
    delete parsed.installations[idx].provenanceReason;
    delete parsed.installations[idx].provenanceHint;
    await backupStateFileOnce(filePath);
    await atomicWriteJson(filePath, parsed);
  } catch {
    // ignore
  }
});
