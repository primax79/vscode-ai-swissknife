import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  AssistantId,
  ItemKind,
  Scope,
  Source,
  SourceType,
  ManagedInstallation,
  ObservedArtifact,
} from '../domain/types';
import {
  readManifest,
  writeManifest,
  readState,
  fromDesiredSource,
  withStateLock,
  manifestPath,
  setSkipStateMigrationWrite,
} from '../domain/registry';
import { ALL_ADAPTERS, getAdapterWithHomeRoot, getAdapter } from '../adapters/registry';
import { getSourceResolver } from '../sources/registry';
import { scanInstalledInventory } from '../engine/discovery';
import {
  checkDriftForAll,
  resolveInstallationSource,
} from '../engine/drift';
import { planInstallMatrix } from '../engine/installMatrix';
import { planInstall, resolveAndTranslate } from '../engine/plan';
import { applyInstall } from '../engine/apply';
import { planUpdateAll, backupItemToTrash, relinkInstallation } from '../engine/update';
import { uninstallInstallation } from '../engine/uninstall';
import { addSourceToManifest, removeSourceFromManifest } from '../engine/sourceManifest';
import {
  snapshotTree,
  diffSnapshots,
  computePlanChangedFiles,
  type ChangedFilesMap,
} from '../engine/fileTree';
import {
  copyToTrash,
  listTrash,
  restoreFromTrash,
  emptyTrash,
  type TrashEntry,
} from '../engine/softDelete';
import {
  validateLocation,
  validateLocalFolder,
  deriveSourceDefaults,
} from '../sources/sourceDefaults';
import { findWorkspaces, scanInventoryAcrossRoots } from '../engine/scanRoots';
import { serializeSkillMarkdown } from '../adapters/claude';
import { readSkill } from '../adapters/codec';
import type { CanonicalSkill } from '../adapters/types';
import { CliError } from './output';
import { createUnifiedDiff } from './diff';
import { refuseCodeKinds } from './gates';
export { requireWrite, refuseCodeKinds } from './gates';
import {
  planRedistribute,
  applyRedistribute,
  sanitizeTarget,
  type RedistributePlan,
  type RedistributeResult,
} from '../engine/redistribute';
import type {
  GlobalCliOptions,
  CliSource,
  CatalogResult,
  CatalogArtifact,
  CatalogDiagnostic,
  CliInstalledItem,
  CliInstalledRootsResult,
  CliUpdateItem,
  CliItemDetail,
  CliPlanInstallSummary,
  CliRelinkOutput,
  ErrorCode,
} from './types';

const VALID_KINDS: readonly ItemKind[] = [
  'skill',
  'agent',
  'command',
  'mcp-server',
  'hook',
  'rule',
];

const VALID_SCOPES: readonly Scope[] = ['global', 'project'];

function parseScanOptions(opts: GlobalCliOptions): {
  maxDepth?: number;
  ignore?: string[];
  extraIgnore?: string[];
} {
  return {
    maxDepth:
      opts.maxDepth !== undefined
        ? parseInt(String(opts.maxDepth), 10)
        : undefined,
    ignore: opts.ignore
      ? Array.isArray(opts.ignore)
        ? opts.ignore
        : [opts.ignore]
      : undefined,
    extraIgnore: opts.extraIgnore
      ? Array.isArray(opts.extraIgnore)
        ? opts.extraIgnore
        : [opts.extraIgnore]
      : undefined,
  };
}

function resolveRoots(opts: GlobalCliOptions): { homeRoot?: string; workspaceRoot: string } {
  const homeRoot = opts.home ? path.resolve(opts.home) : undefined;
  const workspaceRoot = opts.workspace ? path.resolve(opts.workspace) : process.cwd();
  return { homeRoot, workspaceRoot };
}

function parseAssistantFilter(raw?: string): AssistantId[] | undefined {
  if (!raw) return undefined;
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const validIds = ALL_ADAPTERS.map((a) => a.assistant);
  for (const id of ids) {
    if (!validIds.includes(id as AssistantId)) {
      throw new CliError(
        'INVALID_ARGUMENT',
        `Invalid assistant "${id}". Supported assistants: ${validIds.join(', ')}`
      );
    }
  }
  return ids as AssistantId[];
}

function validateKind(kind?: string): ItemKind | undefined {
  if (!kind) return undefined;
  if (!VALID_KINDS.includes(kind as ItemKind)) {
    throw new CliError(
      'INVALID_ARGUMENT',
      `Invalid kind "${kind}". Supported kinds: ${VALID_KINDS.join(', ')}`
    );
  }
  return kind as ItemKind;
}

function validateScope(scope?: string): Scope | undefined {
  if (!scope) return undefined;
  if (!VALID_SCOPES.includes(scope as Scope)) {
    throw new CliError(
      'INVALID_ARGUMENT',
      `Invalid scope "${scope}". Must be "global" or "project"`
    );
  }
  return scope as Scope;
}

export { runDescribe } from './definitions';
export async function runSources(opts: GlobalCliOptions): Promise<CliSource[]> {
  const { homeRoot, workspaceRoot } = resolveRoots(opts);
  const sources: CliSource[] = [];

  // Global sources
  try {
    const gManifest = await readManifest('global', undefined, homeRoot);
    for (const d of gManifest.sources) {
      sources.push({
        id: d.id,
        type: d.type,
        scope: 'global',
        ...(d.url ? { url: d.url } : {}),
        ...(d.localPath ? { localPath: d.localPath } : {}),
        ...(d.branch ? { branch: d.branch } : {}),
        ...(d.tag ? { tag: d.tag } : {}),
        ...(d.commit ? { commit: d.commit } : {}),
        ...(d.name ? { name: d.name } : {}),
      });
    }
  } catch {
    // ignore
  }

  // Workspace sources
  if (workspaceRoot) {
    try {
      const pManifest = await readManifest('project', workspaceRoot, homeRoot);
      for (const d of pManifest.sources) {
        sources.push({
          id: d.id,
          type: d.type,
          scope: 'project',
          ...(d.url ? { url: d.url } : {}),
          ...(d.localPath ? { localPath: d.localPath } : {}),
          ...(d.branch ? { branch: d.branch } : {}),
          ...(d.tag ? { tag: d.tag } : {}),
          ...(d.commit ? { commit: d.commit } : {}),
          ...(d.name ? { name: d.name } : {}),
        });
      }
    } catch {
      // ignore
    }
  }

  return sources;
}

export async function runCatalog(
  opts: GlobalCliOptions & { source?: string; kind?: string }
): Promise<CatalogResult> {
  const { homeRoot, workspaceRoot } = resolveRoots(opts);
  const targetKind = validateKind(opts.kind);

  const registeredSources: Source[] = [];
  try {
    const gManifest = await readManifest('global', undefined, homeRoot);
    registeredSources.push(...gManifest.sources.map((d) => fromDesiredSource(d, undefined, homeRoot)));
  } catch {
    // ignore
  }

  if (workspaceRoot) {
    try {
      const pManifest = await readManifest('project', workspaceRoot, homeRoot);
      registeredSources.push(...pManifest.sources.map((d) => fromDesiredSource(d, workspaceRoot, homeRoot)));
    } catch {
      // ignore
    }
  }

  let sourcesToResolve = registeredSources;
  if (opts.source) {
    sourcesToResolve = registeredSources.filter((s) => s.id === opts.source);
    if (sourcesToResolve.length === 0) {
      throw new CliError('NOT_FOUND', `Source "${opts.source}" not found`);
    }
  }

  const artifacts: CatalogArtifact[] = [];
  const diagnostics: CatalogDiagnostic[] = [];

  for (const source of sourcesToResolve) {
    try {
      const resolver = getSourceResolver(source.type);
      const resolution = await resolver.resolve(source, { homeRoot });
      if (resolution) {
        for (const pkg of resolution.packages) {
          for (const art of pkg.artifacts) {
            if (targetKind && art.kind !== targetKind) {
              continue;
            }
            artifacts.push({
              sourceId: source.id,
              scope: source.scope,
              packageId: pkg.id,
              artifactId: art.id,
              kind: art.kind,
              name: art.name,
              ...(art.description ? { description: art.description } : {}),
              ...(pkg.version ? { version: pkg.version } : {}),
            });
          }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      diagnostics.push({
        sourceId: source.id,
        scope: source.scope,
        message,
      });
    }
  }

  return { artifacts, diagnostics };
}

export async function runInstalled<
  T extends GlobalCliOptions & { scope?: string; assistant?: string; kind?: string }
>(
  opts: T
): Promise<T extends { roots: string[] } ? CliInstalledRootsResult : CliInstalledItem[]>;
export async function runInstalled(
  opts: GlobalCliOptions & { scope?: string; assistant?: string; kind?: string }
): Promise<CliInstalledItem[] | CliInstalledRootsResult> {
  const filterScope = validateScope(opts.scope);
  const filterKind = validateKind(opts.kind);

  let assistantFilter: AssistantId[] | undefined;
  if (opts.assistant) {
    const parsed = parseAssistantFilter(opts.assistant);
    if (parsed) assistantFilter = parsed;
  } else if (opts.assistants) {
    assistantFilter = parseAssistantFilter(opts.assistants);
  }

  // When --roots is specified: multi-root scanning
  if (opts.roots && opts.roots.length > 0) {
    const homeRoot = opts.home ? path.resolve(opts.home) : undefined;
    const scanOpts = parseScanOptions(opts);
    const roots = Array.isArray(opts.roots) ? opts.roots : [opts.roots];

    const scanResult = await scanInventoryAcrossRoots(roots, {
      assistants: assistantFilter,
      scopes: filterScope ? [filterScope] : undefined,
      homeRoot,
      options: scanOpts,
    });

    const items = filterKind
      ? scanResult.items.filter((i) => i.kind === filterKind)
      : scanResult.items;

    return {
      items,
      installed: items,
      workspaces: scanResult.workspaces,
      skipped: scanResult.skipped,
    };
  }

  const { homeRoot, workspaceRoot } = resolveRoots(opts);

  const scopesToScan: Scope[] = filterScope
    ? [filterScope]
    : workspaceRoot
    ? ['global', 'project']
    : ['global'];

  const results: CliInstalledItem[] = [];

  for (const sc of scopesToScan) {
    const pRoot = sc === 'project' ? workspaceRoot : undefined;
    try {
      const inventory = await scanInstalledInventory(sc, pRoot, homeRoot);

      for (const m of inventory.managed) {
        if (assistantFilter && !assistantFilter.includes(m.assistant)) continue;
        if (filterKind && m.kind !== filterKind) continue;

        results.push({
          key: `${m.assistant}:${m.scope}:${m.kind}:${m.name}`,
          kind: m.kind,
          name: m.name,
          assistant: m.assistant,
          scope: m.scope,
          membership: 'managed',
          path: m.path,
          ...(m.source ? { source: m.source } : {}),
          ...(m.sourceId ? { sourceId: m.sourceId } : {}),
          ...(m.provenance ? { provenance: m.provenance } : {}),
          ...(m.provenanceReason ? { provenanceReason: m.provenanceReason } : {}),
          ...(m.provenanceHint ? { provenanceHint: m.provenanceHint } : {}),
          workspace: sc === 'global' ? null : workspaceRoot,
        });
      }

      for (const o of inventory.observed) {
        if (assistantFilter && !assistantFilter.includes(o.assistant)) continue;
        if (filterKind && o.kind !== filterKind) continue;

        const matchedStatus = o.match?.status === 'identical'
          ? 'identical'
          : o.match?.status === 'different'
          ? 'different'
          : undefined;

        results.push({
          key: `${o.assistant}:${o.scope}:${o.kind}:${o.name}`,
          kind: o.kind as ItemKind,
          name: o.name,
          assistant: o.assistant,
          scope: o.scope,
          membership: 'observed',
          path: o.path,
          ...(o.match?.sourceId ? { sourceId: o.match.sourceId } : {}),
          ...(matchedStatus ? { match: matchedStatus } : {}),
          workspace: sc === 'global' ? null : workspaceRoot,
        });
      }
    } catch {
      // ignore scope scan errors
    }
  }

  return results;
}

export async function runUpdates(
  opts: GlobalCliOptions & { scope?: string; assistant?: string; kind?: string }
): Promise<CliUpdateItem[]> {
  const filterScope = validateScope(opts.scope);
  const filterKind = validateKind(opts.kind);
  const filterAssistant = opts.assistant ? parseAssistantFilter(opts.assistant)?.[0] : undefined;

  // When --roots is specified: multi-root drift check
  if (opts.roots && opts.roots.length > 0) {
    const homeRoot = opts.home ? path.resolve(opts.home) : undefined;
    const scanOpts = parseScanOptions(opts);
    const roots = Array.isArray(opts.roots) ? opts.roots : [opts.roots];
    const { workspaces } = await findWorkspaces(roots, scanOpts);

    const updates: CliUpdateItem[] = [];
    let gSources: Source[] = [];
    try {
      const gManifest = await readManifest('global', undefined, homeRoot);
      gSources = gManifest.sources.map((d) => fromDesiredSource(d, undefined, homeRoot));
    } catch {
      // ignore
    }

    // Global scope
    if (!filterScope || filterScope === 'global') {
      try {
        const gState = await readState('global', undefined, homeRoot);
        const filteredGlobal = gState.installations.filter((inst) => {
          if (filterAssistant && inst.assistant !== filterAssistant) return false;
          if (filterKind && inst.kind !== filterKind) return false;
          return true;
        });

        const gReports = await checkDriftForAll(
          filteredGlobal,
          { globalSources: gSources, workspaceSources: [] },
          homeRoot
        );

        for (const report of gReports) {
          const inst = report.installation;
          updates.push({
            key: `${inst.assistant}:${inst.scope}:${inst.kind}:${inst.name}`,
            kind: inst.kind,
            name: inst.name,
            assistant: inst.assistant,
            scope: inst.scope,
            status: report.status,
            ...(inst.sourceId ? { sourceId: inst.sourceId } : {}),
            ...(report.installedCommit ? { installedCommit: report.installedCommit } : {}),
            ...(report.currentCommit ? { currentCommit: report.currentCommit } : {}),
            ...(report.commitsBehind !== undefined ? { commitsBehind: report.commitsBehind } : {}),
            ...(report.details ? { details: report.details } : {}),
            workspace: null,
          });
        }
      } catch {
        // ignore
      }
    }

    // Workspace scope for each found workspace
    if (!filterScope || filterScope === 'project') {
      const multiWorkspace = workspaces.length > 1;

      for (const ws of workspaces) {
        const suffix = multiWorkspace ? `@${path.basename(ws)}` : '';
        try {
          const pState = await readState('project', ws, homeRoot);
          const pManifest = await readManifest('project', ws, homeRoot);
          const pSources = pManifest.sources.map((d) => fromDesiredSource(d, ws, homeRoot));

          const filteredProject = pState.installations.filter((inst) => {
            if (filterAssistant && inst.assistant !== filterAssistant) return false;
            if (filterKind && inst.kind !== filterKind) return false;
            return true;
          });

          const pReports = await checkDriftForAll(
            filteredProject,
            { globalSources: gSources, workspaceSources: pSources },
            homeRoot
          );

          for (const report of pReports) {
            const inst = report.installation;
            updates.push({
              key: `${inst.assistant}:${inst.scope}:${inst.kind}:${inst.name}${suffix}`,
              kind: inst.kind,
              name: inst.name,
              assistant: inst.assistant,
              scope: inst.scope,
              status: report.status,
              ...(inst.sourceId ? { sourceId: inst.sourceId } : {}),
              ...(report.installedCommit ? { installedCommit: report.installedCommit } : {}),
              ...(report.currentCommit ? { currentCommit: report.currentCommit } : {}),
              ...(report.commitsBehind !== undefined ? { commitsBehind: report.commitsBehind } : {}),
              ...(report.details ? { details: report.details } : {}),
              workspace: ws,
            });
          }
        } catch {
          // ignore
        }
      }
    }

    return updates;
  }

  const { homeRoot, workspaceRoot } = resolveRoots(opts);

  const allInstallations: Array<{ inst: ManagedInstallation; wsRoot?: string }> = [];
  const globalSources: Source[] = [];
  const workspaceSources: Source[] = [];

  // Global state & manifest
  try {
    const gState = await readState('global', undefined, homeRoot);
    for (const inst of gState.installations) {
      allInstallations.push({ inst });
    }
    const gManifest = await readManifest('global', undefined, homeRoot);
    globalSources.push(...gManifest.sources.map((d) => fromDesiredSource(d, undefined, homeRoot)));
  } catch {
    // ignore
  }

  // Workspace state & manifest
  if (workspaceRoot) {
    try {
      const pState = await readState('project', workspaceRoot, homeRoot);
      for (const inst of pState.installations) {
        allInstallations.push({ inst, wsRoot: workspaceRoot });
      }
      const pManifest = await readManifest('project', workspaceRoot, homeRoot);
      workspaceSources.push(...pManifest.sources.map((d) => fromDesiredSource(d, workspaceRoot, homeRoot)));
    } catch {
      // ignore
    }
  }

  const filteredEntries = allInstallations.filter(({ inst }) => {
    if (filterScope && inst.scope !== filterScope) return false;
    if (filterAssistant && inst.assistant !== filterAssistant) return false;
    if (filterKind && inst.kind !== filterKind) return false;
    return true;
  });

  const reports = await checkDriftForAll(
    filteredEntries.map((e) => e.inst),
    { globalSources, workspaceSources },
    homeRoot
  );

  const updates: CliUpdateItem[] = [];

  for (let i = 0; i < reports.length; i++) {
    const report = reports[i];
    const { inst, wsRoot } = filteredEntries[i];

    updates.push({
      key: `${inst.assistant}:${inst.scope}:${inst.kind}:${inst.name}`,
      kind: inst.kind,
      name: inst.name,
      assistant: inst.assistant,
      scope: inst.scope,
      status: report.status,
      ...(inst.sourceId ? { sourceId: inst.sourceId } : {}),
      ...(report.installedCommit ? { installedCommit: report.installedCommit } : {}),
      ...(report.currentCommit ? { currentCommit: report.currentCommit } : {}),
      ...(report.commitsBehind !== undefined ? { commitsBehind: report.commitsBehind } : {}),
      ...(report.details ? { details: report.details } : {}),
      workspace: inst.scope === 'global' ? null : (wsRoot ?? null),
    });
  }

  return updates;
}

export async function runItem(
  key: string,
  opts: GlobalCliOptions & { diff?: boolean }
): Promise<CliItemDetail> {
  if (!key || typeof key !== 'string') {
    throw new CliError('INVALID_ARGUMENT', 'Item key argument is required');
  }

  let baseKey = key;
  let workspaceFolderName: string | undefined;
  const atIndex = key.lastIndexOf('@');
  if (atIndex !== -1) {
    baseKey = key.slice(0, atIndex);
    workspaceFolderName = key.slice(atIndex + 1);
  }

  const homeRoot = opts.home ? path.resolve(opts.home) : undefined;
  let targetWorkspaces: string[] = [];

  if (opts.roots && opts.roots.length > 0) {
    const scanOpts = parseScanOptions(opts);
    const roots = Array.isArray(opts.roots) ? opts.roots : [opts.roots];
    const { workspaces } = await findWorkspaces(roots, scanOpts);
    if (workspaceFolderName) {
      const match = workspaces.find((ws) => path.basename(ws) === workspaceFolderName);
      if (!match) {
        throw new CliError('NOT_FOUND', `Item "${key}" not found`);
      }
      targetWorkspaces = [match];
    } else {
      targetWorkspaces = workspaces;
    }
  } else if (workspaceFolderName) {
    if (opts.workspace && path.basename(opts.workspace) === workspaceFolderName) {
      targetWorkspaces = [path.resolve(opts.workspace)];
    } else if (path.basename(process.cwd()) === workspaceFolderName) {
      targetWorkspaces = [process.cwd()];
    } else {
      targetWorkspaces = [resolveRoots(opts).workspaceRoot];
    }
  } else {
    targetWorkspaces = [resolveRoots(opts).workspaceRoot];
  }

  // Gather inventory from all scopes
  const managedItems: ManagedInstallation[] = [];
  const observedItems: ObservedArtifact[] = [];

  try {
    const inv = await scanInstalledInventory('global', undefined, homeRoot);
    managedItems.push(...inv.managed);
    observedItems.push(...inv.observed);
  } catch {
    // ignore
  }

  for (const ws of targetWorkspaces) {
    try {
      const inv = await scanInstalledInventory('project', ws, homeRoot);
      managedItems.push(...inv.managed);
      observedItems.push(...inv.observed);
    } catch {
      // ignore
    }
  }

  const targetManaged = managedItems.find((m) => {
    const mBaseKey = `${m.assistant}:${m.scope}:${m.kind}:${m.name}`;
    if (m.scope === 'global') {
      return mBaseKey === key;
    }
    const wsFolder = m.projectPath ? path.basename(m.projectPath) : '';
    const suffixedKey = `${mBaseKey}@${wsFolder}`;
    if (key === suffixedKey) return true;
    if (key === mBaseKey && !workspaceFolderName) return true;
    if (mBaseKey === baseKey && workspaceFolderName && wsFolder === workspaceFolderName) return true;
    return false;
  });

  const targetObserved = observedItems.find((o) => {
    const oBaseKey = `${o.assistant}:${o.scope}:${o.kind}:${o.name}`;
    if (o.scope === 'global') {
      return oBaseKey === key;
    }
    const wsFolder = o.projectPath ? path.basename(o.projectPath) : '';
    const suffixedKey = `${oBaseKey}@${wsFolder}`;
    if (key === suffixedKey) return true;
    if (key === oBaseKey && !workspaceFolderName) return true;
    if (oBaseKey === baseKey && workspaceFolderName && wsFolder === workspaceFolderName) return true;
    return false;
  });

  if (!targetManaged && !targetObserved) {
    throw new CliError('NOT_FOUND', `Item "${key}" not found`);
  }

  // Gather sources
  const globalSources: Source[] = [];
  const workspaceSources: Source[] = [];
  try {
    const gManifest = await readManifest('global', undefined, homeRoot);
    globalSources.push(...gManifest.sources.map((d) => fromDesiredSource(d, undefined, homeRoot)));
  } catch {
    // ignore
  }
  for (const ws of targetWorkspaces) {
    try {
      const pManifest = await readManifest('project', ws, homeRoot);
      workspaceSources.push(...pManifest.sources.map((d) => fromDesiredSource(d, ws, homeRoot)));
    } catch {
      // ignore
    }
  }

  const membership = targetManaged ? 'managed' : 'observed';
  const item = targetManaged || targetObserved!;

  // Origin info
  let origin: CliItemDetail['origin'];
  if (targetManaged) {
    origin = {
      ...(targetManaged.sourceId ? { sourceId: targetManaged.sourceId } : {}),
      ...(targetManaged.packageId ? { packageId: targetManaged.packageId } : {}),
      ...(targetManaged.artifactId ? { artifactId: targetManaged.artifactId } : {}),
      ...(targetManaged.sourceRevision ? { sourceRevision: targetManaged.sourceRevision } : {}),
    };
  } else if (targetObserved) {
    if (targetObserved.match && targetObserved.match.status !== 'unmatched') {
      origin = {
        ...(targetObserved.match.sourceId ? { sourceId: targetObserved.match.sourceId } : {}),
        ...(targetObserved.match.packageId ? { packageId: targetObserved.match.packageId } : {}),
        ...(targetObserved.match.artifactId ? { artifactId: targetObserved.match.artifactId } : {}),
        ...(targetObserved.match.sourceRevision ? { sourceRevision: targetObserved.match.sourceRevision } : {}),
        status: targetObserved.match.status,
      };
    } else {
      origin = { type: 'local' };
    }
  }

  // Find installed-in places
  const installedIn: CliItemDetail['installedIn'] = [];
  for (const m of managedItems) {
    if (m.name === item.name && m.kind === item.kind) {
      if (!(m.assistant === item.assistant && m.scope === item.scope && m.projectPath === item.projectPath)) {
        installedIn.push({
          assistant: m.assistant,
          scope: m.scope,
          membership: 'managed',
          path: m.path,
          workspace: m.scope === 'global' ? null : (m.projectPath ?? null),
        });
      }
    }
  }
  for (const o of observedItems) {
    if (o.name === item.name && o.kind === item.kind) {
      if (!(o.assistant === item.assistant && o.scope === item.scope && o.projectPath === item.projectPath)) {
        installedIn.push({
          assistant: o.assistant,
          scope: o.scope,
          membership: 'observed',
          path: o.path,
          workspace: o.scope === 'global' ? null : (o.projectPath ?? null),
        });
      }
    }
  }

  // Check diff availability & compute unified diff
  let diffAvailable = false;
  let diffContent: string | undefined;

  const sourceId = targetManaged?.sourceId || targetObserved?.match?.sourceId;
  const artifactId = targetManaged?.artifactId || targetObserved?.match?.artifactId;

  if (sourceId || targetManaged?.source) {
    let source: Source | undefined;
    if (targetManaged) {
      const resolvedSrc = resolveInstallationSource(targetManaged, { globalSources, workspaceSources });
      if ('source' in resolvedSrc) source = resolvedSrc.source;
    } else if (sourceId) {
      const preferred = item.scope === 'global' ? globalSources : workspaceSources;
      const fallback = item.scope === 'global' ? workspaceSources : globalSources;
      source = preferred.find((s) => s.id === sourceId) ?? fallback.find((s) => s.id === sourceId);
    }
    if (source) {
      try {
        const resolver = getSourceResolver(source.type);
        const resolution = await resolver.resolve(source, { homeRoot });
        if (resolution) {
          let foundPkg;
          let foundArt;
          for (const pkg of resolution.packages) {
            for (const art of pkg.artifacts) {
              if (
                (artifactId && (art.id === artifactId || art.name === artifactId)) ||
                (art.kind === item.kind && art.name === item.name)
              ) {
                foundPkg = pkg;
                foundArt = art;
                break;
              }
            }
            if (foundArt) break;
          }

          if (foundPkg && foundArt) {
            const translatedResult = await resolveAndTranslate(
              source,
              foundPkg,
              foundArt,
              item.assistant,
              { homeRoot }
            );

            // Read local content
            let localStr = '';
            let origStr = '';

            if (item.kind === 'skill') {
              origStr = serializeSkillMarkdown(translatedResult.translated as CanonicalSkill);
              const skillFile = path.join(item.path, 'SKILL.md');
              if (fs.existsSync(skillFile)) {
                localStr = await fs.promises.readFile(skillFile, 'utf-8');
              } else {
                try {
                  const locSkill = await readSkill(item.path);
                  localStr = serializeSkillMarkdown(locSkill);
                } catch {
                  // ignore
                }
              }
            } else {
              // Agent, command, etc.
              const adapter = homeRoot
                ? getAdapterWithHomeRoot(item.assistant, homeRoot)
                : getAdapter(item.assistant);
              const loc = { scope: item.scope, projectRoot: item.projectPath };
              if (item.kind === 'agent') {
                const ag = await adapter.readAgent(item.name, loc);
                if (ag) localStr = JSON.stringify(ag, null, 2);
                origStr = JSON.stringify(translatedResult.translated, null, 2);
              } else if (item.kind === 'command') {
                const cmd = await adapter.readCommand(item.name, loc);
                if (cmd) localStr = JSON.stringify(cmd, null, 2);
                origStr = JSON.stringify(translatedResult.translated, null, 2);
              }
            }

            if (origStr && localStr && origStr !== localStr) {
              diffAvailable = true;
              if (opts.diff) {
                diffContent = createUnifiedDiff(origStr, localStr, 'upstream', 'local');
              }
            }
          }
        }
      } catch {
        // diff calculation failure leaves diffAvailable false
      }
    }
  }

  return {
    key,
    kind: item.kind as ItemKind,
    name: item.name,
    assistant: item.assistant,
    scope: item.scope,
    membership,
    path: item.path,
    workspace: item.scope === 'global' ? null : (item.projectPath ?? null),
    ...(origin ? { origin } : {}),
    installedIn,
    diffAvailable,
    ...(opts.diff && diffContent !== undefined ? { diff: diffContent } : {}),
  };
}

export async function runPlanInstall(
  opts: GlobalCliOptions & {
    source: string;
    artifact: string;
    assistants: string;
    scopes: string;
    overwriteCheck?: boolean;
  }
): Promise<CliPlanInstallSummary> {
  const { homeRoot, workspaceRoot } = resolveRoots(opts);

  if (!opts.source) {
    throw new CliError('INVALID_ARGUMENT', 'Missing required option --source <id>');
  }
  if (!opts.artifact) {
    throw new CliError('INVALID_ARGUMENT', 'Missing required option --artifact <id>');
  }
  if (!opts.assistants) {
    throw new CliError('INVALID_ARGUMENT', 'Missing required option --assistants <ids>');
  }
  if (!opts.scopes) {
    throw new CliError('INVALID_ARGUMENT', 'Missing required option --scopes <scopes>');
  }

  const assistantIds = parseAssistantFilter(opts.assistants);
  if (!assistantIds || assistantIds.length === 0) {
    throw new CliError('INVALID_ARGUMENT', 'At least one assistant must be specified in --assistants');
  }

  const rawScopes = opts.scopes.split(',').map((s) => s.trim()).filter(Boolean);
  const scopeList: Scope[] = [];
  for (const s of rawScopes) {
    const validated = validateScope(s);
    if (validated) scopeList.push(validated);
  }
  if (scopeList.length === 0) {
    throw new CliError('INVALID_ARGUMENT', 'At least one scope must be specified in --scopes');
  }

  // Find source
  const registeredSources: Source[] = [];
  try {
    const gManifest = await readManifest('global', undefined, homeRoot);
    registeredSources.push(...gManifest.sources.map((d) => fromDesiredSource(d, undefined, homeRoot)));
  } catch {
    // ignore
  }
  if (workspaceRoot) {
    try {
      const pManifest = await readManifest('project', workspaceRoot, homeRoot);
      registeredSources.push(...pManifest.sources.map((d) => fromDesiredSource(d, workspaceRoot, homeRoot)));
    } catch {
      // ignore
    }
  }

  const source = registeredSources.find((s) => s.id === opts.source);
  if (!source) {
    throw new CliError('NOT_FOUND', `Source "${opts.source}" not found`);
  }

  let resolution;
  try {
    const resolver = getSourceResolver(source.type);
    resolution = await resolver.resolve(source, { homeRoot });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CliError('SOURCE_RESOLUTION_FAILED', `Failed to resolve source "${opts.source}": ${msg}`);
  }

  if (!resolution) {
    throw new CliError('SOURCE_RESOLUTION_FAILED', `Failed to resolve source "${opts.source}"`);
  }

  let foundPkg;
  let foundArt;
  for (const pkg of resolution.packages) {
    for (const art of pkg.artifacts) {
      if (art.id === opts.artifact || art.name === opts.artifact) {
        foundPkg = pkg;
        foundArt = art;
        break;
      }
    }
    if (foundArt) break;
  }

  if (!foundPkg || !foundArt) {
    throw new CliError('NOT_FOUND', `Artifact "${opts.artifact}" not found in source "${opts.source}"`);
  }

  const planResult = await planInstallMatrix({
    items: [{ source, pkg: foundPkg, artifact: foundArt }],
    assistants: assistantIds,
    scopes: scopeList,
    projectRoot: workspaceRoot,
    homeRoot,
  });

  return planResult.summary;
}

export async function runRedistribute(
  opts: GlobalCliOptions & {
    target: string;
    item?: string | string[];
    scope?: string;
    assistant?: string;
    force?: boolean;
    installMissing?: boolean;
    write?: boolean;
    allowCodeKinds?: boolean;
  }
): Promise<RedistributePlan | RedistributeResult> {
  const { homeRoot, workspaceRoot } = resolveRoots(opts);

  if (!opts.target) {
    throw new CliError('INVALID_ARGUMENT', 'Target argument is required');
  }

  const filterScope = validateScope(opts.scope);
  const scopes: Scope[] | undefined = filterScope ? [filterScope] : undefined;

  let assistantFilter: AssistantId[] | undefined;
  if (opts.assistant) {
    assistantFilter = parseAssistantFilter(opts.assistant);
  } else if (opts.assistants) {
    assistantFilter = parseAssistantFilter(opts.assistants);
  }

  let items: string[] | undefined;
  if (Array.isArray(opts.item)) {
    items = opts.item
      .flatMap((s: string) => s.split(','))
      .map((s: string) => s.trim())
      .filter(Boolean);
  } else if (typeof opts.item === 'string') {
    items = opts.item
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const allInstallations: ManagedInstallation[] = [];
  const allSources: Source[] = [];

  // Global state & manifest
  try {
    const gState = await readState('global', undefined, homeRoot);
    allInstallations.push(...gState.installations);
    const gManifest = await readManifest('global', undefined, homeRoot);
    allSources.push(
      ...gManifest.sources.map((d) => fromDesiredSource(d, undefined, homeRoot))
    );
  } catch {
    // ignore
  }

  // Workspace state & manifest
  if (workspaceRoot) {
    try {
      const pState = await readState('project', workspaceRoot, homeRoot);
      allInstallations.push(...pState.installations);
      const pManifest = await readManifest('project', workspaceRoot, homeRoot);
      allSources.push(
        ...pManifest.sources.map((d) =>
          fromDesiredSource(d, workspaceRoot, homeRoot)
        )
      );
    } catch {
      // ignore
    }
  }

  const plan = await planRedistribute({
    target: opts.target,
    installations: allInstallations,
    sources: allSources,
    assistants: assistantFilter,
    scopes,
    items,
    force: Boolean(opts.force),
    installMissing: Boolean(opts.installMissing),
    homeRoot,
    projectRoot: workspaceRoot,
  });

  // Gate: refuse executable/code kinds unless --allow-code-kinds is given
  refuseCodeKinds(plan.targets.map((t) => t.kind), opts.allowCodeKinds);

  if (!opts.write) {
    return {
      mode: 'plan',
      source: plan.source,
      targets: plan.targets.map(sanitizeTarget),
    };
  }

  return await applyRedistribute(plan, {
    homeRoot,
    projectRoot: workspaceRoot,
  });
}

export async function runApplyInstall(
  opts: GlobalCliOptions & {
    source: string;
    artifact: string;
    assistants?: string;
    scopes?: string;
    overwrite?: boolean;
    write?: boolean;
    allowCodeKinds?: boolean;
  }
) {
  const { homeRoot, workspaceRoot } = resolveRoots(opts);

  if (!opts.source) {
    throw new CliError('INVALID_ARGUMENT', 'Missing required option --source <id>');
  }
  if (!opts.artifact) {
    throw new CliError('INVALID_ARGUMENT', 'Missing required option --artifact <id>');
  }
  if (!opts.assistants) {
    throw new CliError('INVALID_ARGUMENT', 'Missing required option --assistants <ids>');
  }
  if (!opts.scopes) {
    throw new CliError('INVALID_ARGUMENT', 'Missing required option --scopes <scopes>');
  }

  const assistantIds = parseAssistantFilter(opts.assistants);
  if (!assistantIds || assistantIds.length === 0) {
    throw new CliError('INVALID_ARGUMENT', 'At least one assistant must be specified in --assistants');
  }

  const rawScopes = opts.scopes.split(',').map((s) => s.trim()).filter(Boolean);
  const scopeList: Scope[] = [];
  for (const s of rawScopes) {
    const validated = validateScope(s);
    if (validated) scopeList.push(validated);
  }
  if (scopeList.length === 0) {
    throw new CliError('INVALID_ARGUMENT', 'At least one scope must be specified in --scopes');
  }

  // Find source
  const registeredSources: Source[] = [];
  try {
    const gManifest = await readManifest('global', undefined, homeRoot);
    registeredSources.push(...gManifest.sources.map((d) => fromDesiredSource(d, undefined, homeRoot)));
  } catch {
    // ignore
  }
  if (workspaceRoot) {
    try {
      const pManifest = await readManifest('project', workspaceRoot, homeRoot);
      registeredSources.push(...pManifest.sources.map((d) => fromDesiredSource(d, workspaceRoot, homeRoot)));
    } catch {
      // ignore
    }
  }

  const source = registeredSources.find((s) => s.id === opts.source);
  if (!source) {
    throw new CliError('NOT_FOUND', `Source "${opts.source}" not found`);
  }

  let resolution;
  try {
    const resolver = getSourceResolver(source.type);
    resolution = await resolver.resolve(source, { homeRoot });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CliError('SOURCE_RESOLUTION_FAILED', `Failed to resolve source "${opts.source}": ${msg}`);
  }

  if (!resolution) {
    throw new CliError('SOURCE_RESOLUTION_FAILED', `Failed to resolve source "${opts.source}"`);
  }

  let foundPkg;
  let foundArt;
  for (const pkg of resolution.packages) {
    for (const art of pkg.artifacts) {
      if (art.id === opts.artifact || art.name === opts.artifact) {
        foundPkg = pkg;
        foundArt = art;
        break;
      }
    }
    if (foundArt) break;
  }

  if (!foundPkg || !foundArt) {
    throw new CliError('NOT_FOUND', `Artifact "${opts.artifact}" not found in source "${opts.source}"`);
  }

  // Gate: refuse executable/code kinds unless --allow-code-kinds is given
  refuseCodeKinds([foundArt.kind], opts.allowCodeKinds);

  const planResult = await planInstallMatrix({
    items: [{ source, pkg: foundPkg, artifact: foundArt }],
    assistants: assistantIds,
    scopes: scopeList,
    projectRoot: workspaceRoot,
    homeRoot,
  });

  if (!opts.write) {
    return {
      mode: 'plan',
      targets: planResult.targets.map((t) => {
        const isConflict = t.prepared.supported && Boolean(t.prepared.plan.conflict);
        const action = !t.prepared.supported
          ? 'skip'
          : isConflict
          ? (opts.overwrite ? 'overwrite' : 'skip')
          : 'install';
        return {
          item: foundArt!.name,
          kind: foundArt!.kind,
          assistant: t.assistant,
          scope: t.scope,
          status: !t.prepared.supported
            ? 'unsupported'
            : isConflict
            ? 'conflict'
            : 'new',
          action,
          reason: !t.prepared.supported
            ? t.prepared.plan.reason
            : isConflict && !opts.overwrite
            ? 'Installation already exists (conflict)'
            : undefined,
        };
      }),
    };
  }

  // Applied mode
  const appliedTargets: Array<{
    item: string;
    kind: ItemKind;
    assistant: AssistantId;
    scope: Scope;
    status: string;
    changedFiles?: ChangedFilesMap;
    backupPath?: string;
    reason?: string;
    warnings?: string[];
  }> = [];

  for (const target of planResult.targets) {
    if (!target.prepared.supported) {
      appliedTargets.push({
        item: foundArt.name,
        kind: foundArt.kind,
        assistant: target.assistant,
        scope: target.scope,
        status: 'unsupported',
        reason: target.prepared.plan.reason,
      });
      continue;
    }

    const isConflict = target.prepared.supported && Boolean(target.prepared.plan.conflict);
    if (isConflict && !opts.overwrite) {
      appliedTargets.push({
        item: foundArt.name,
        kind: foundArt.kind,
        assistant: target.assistant,
        scope: target.scope,
        status: 'skipped',
        reason: 'Installation already exists (conflict)',
      });
      continue;
    }

    let backupPath: string | undefined;
    const targetPath = target.prepared.supported ? target.prepared.plan.targetDir : undefined;
    if (isConflict && opts.overwrite && targetPath && fs.existsSync(targetPath)) {
      try {
        backupPath = await copyToTrash(
          targetPath,
          foundArt.kind,
          foundArt.name,
          target.scope,
          target.scope === 'project' ? workspaceRoot : undefined,
          homeRoot,
          { assistant: target.assistant }
        );
      } catch {
        // ignore trash backup failure
      }
    }

    const beforeTree = targetPath ? snapshotTree(targetPath) : new Map<string, string>();
    const root = target.scope === 'project' ? workspaceRoot : undefined;

    try {
      const outcome = await withStateLock(target.scope, root, homeRoot, async () => {
        return await applyInstall(target.prepared, homeRoot);
      });

      const afterTree = targetPath ? snapshotTree(targetPath) : new Map<string, string>();
      const changedFiles = diffSnapshots(beforeTree, afterTree);

      appliedTargets.push({
        item: foundArt.name,
        kind: foundArt.kind,
        assistant: target.assistant,
        scope: target.scope,
        status: outcome.status,
        changedFiles,
        ...(backupPath ? { backupPath } : {}),
        ...(outcome.status === 'applied' && outcome.warnings ? { warnings: outcome.warnings } : {}),
        ...(outcome.status !== 'applied' && 'reason' in outcome && outcome.reason ? { reason: outcome.reason } : {}),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      appliedTargets.push({
        item: foundArt.name,
        kind: foundArt.kind,
        assistant: target.assistant,
        scope: target.scope,
        status: 'failed',
        reason: msg,
        ...(backupPath ? { backupPath } : {}),
      });
    }
  }

  return {
    mode: 'applied',
    targets: appliedTargets,
  };
}

export async function runUninstall(
  key: string,
  opts: GlobalCliOptions & {
    hard?: boolean;
    write?: boolean;
    allowCodeKinds?: boolean;
  }
) {
  if (!key) {
    throw new CliError('INVALID_ARGUMENT', 'Item key is required');
  }

  const { homeRoot, workspaceRoot } = resolveRoots(opts);

  const allInstallations: ManagedInstallation[] = [];
  try {
    const gState = await readState('global', undefined, homeRoot);
    allInstallations.push(...gState.installations);
  } catch {
    // ignore
  }
  if (workspaceRoot) {
    try {
      const pState = await readState('project', workspaceRoot, homeRoot);
      allInstallations.push(...pState.installations);
    } catch {
      // ignore
    }
  }

  const inst = allInstallations.find((i) => {
    const itemKey = `${i.assistant}:${i.scope}:${i.kind}:${i.name}`;
    return itemKey === key || i.name === key;
  });

  if (!inst) {
    throw new CliError('NOT_FOUND', `Managed installation "${key}" not found`);
  }

  // Gate: refuse executable/code kinds unless --allow-code-kinds is given
  refuseCodeKinds(inst.kind, opts.allowCodeKinds);

  const itemKey = `${inst.assistant}:${inst.scope}:${inst.kind}:${inst.name}`;

  if (!opts.write) {
    return {
      mode: 'plan',
      key: itemKey,
      item: inst.name,
      kind: inst.kind,
      assistant: inst.assistant,
      scope: inst.scope,
      path: inst.path,
      hard: Boolean(opts.hard),
      action: opts.hard ? 'remove' : 'trash',
    };
  }

  const beforeTree = snapshotTree(inst.path);
  const result = await uninstallInstallation(inst, {
    mode: opts.hard ? 'hard' : 'soft',
    homeRoot,
    projectRoot: workspaceRoot,
  });

  const removedFiles = Array.from(beforeTree.keys()).sort();

  return {
    mode: 'applied',
    key: itemKey,
    item: inst.name,
    kind: inst.kind,
    assistant: inst.assistant,
    scope: inst.scope,
    path: inst.path,
    hard: Boolean(opts.hard),
    changedFiles: {
      added: [],
      changed: [],
      removed: removedFiles.length > 0 ? removedFiles : [path.basename(inst.path)],
    },
    ...(result.backupPath ? { backupPath: result.backupPath } : {}),
  };
}

export async function runSourceAdd(
  type: string,
  location: string,
  opts: GlobalCliOptions & {
    id?: string;
    name?: string;
    scope?: string;
    replace?: boolean;
    write?: boolean;
  }
) {
  if (!type) {
    throw new CliError('INVALID_ARGUMENT', 'Source type is required');
  }
  if (!location) {
    throw new CliError('INVALID_ARGUMENT', 'Source location is required');
  }

  const validTypes: SourceType[] = [
    'local-folder',
    'git-custom',
    'git-marketplace',
    'git-single-item',
    'remote-url',
  ];
  if (!validTypes.includes(type as SourceType)) {
    throw new CliError(
      'INVALID_ARGUMENT',
      `Invalid source type "${type}". Supported types: ${validTypes.join(', ')}`
    );
  }

  const { homeRoot, workspaceRoot } = resolveRoots(opts);
  let scope: Scope;
  if (opts.scope) {
    const validated = validateScope(opts.scope);
    if (!validated) {
      throw new CliError('INVALID_ARGUMENT', `Invalid scope "${opts.scope}". Must be global or project`);
    }
    scope = validated;
  } else {
    scope = workspaceRoot ? 'project' : 'global';
  }

  const defaults = deriveSourceDefaults(type as SourceType, location);
  const id = (opts.id && opts.id.trim()) ? opts.id.trim() : defaults.id;
  const name = (opts.name && opts.name.trim()) ? opts.name.trim() : defaults.name;

  const runtimeSource: Source = {
    id,
    type: type as SourceType,
    scope,
    ...(name ? { name } : {}),
    ...(type === 'local-folder' ? { localPath: location } : { url: location }),
    ...(scope === 'project' && workspaceRoot ? { projectPath: workspaceRoot } : {}),
  };

  // Validate location
  const locErr = validateLocation(runtimeSource.type, location);
  if (locErr) {
    throw new CliError('INVALID_ARGUMENT', locErr);
  }

  if (runtimeSource.type === 'local-folder') {
    const rootDir = scope === 'project' ? workspaceRoot : (homeRoot ?? os.homedir());
    const folderErr = validateLocalFolder(location, scope, rootDir);
    if (folderErr) {
      throw new CliError('INVALID_ARGUMENT', folderErr);
    }
  }

  const root = scope === 'project' ? workspaceRoot : undefined;
  const manifest = await readManifest(scope, root, homeRoot);
  const existing = manifest.sources.find((s) => s.id === id);

  if (existing && !opts.replace) {
    throw new CliError('DUPLICATE_ID', `Source "${id}" already exists in ${scope} scope`);
  }

  if (!opts.write) {
    return {
      mode: 'plan',
      action: existing ? 'replace' : 'add',
      source: {
        id,
        type: runtimeSource.type,
        scope,
        name,
        location,
      },
    };
  }

  await addSourceToManifest(runtimeSource, {
    projectRoot: root,
    homeRoot,
    replace: Boolean(opts.replace),
  });

  return {
    mode: 'applied',
    action: existing ? 'replaced' : 'added',
    source: {
      id,
      type: runtimeSource.type,
      scope,
      name,
      location,
    },
    changedFiles: {
      added: [],
      changed: [manifestPath(scope, root, homeRoot)],
      removed: [],
    },
  };
}

export async function runSourceRemove(
  id: string,
  opts: GlobalCliOptions & {
    scope?: string;
    write?: boolean;
  }
) {
  if (!id) {
    throw new CliError('INVALID_ARGUMENT', 'Source ID is required');
  }
  if (!opts.scope) {
    throw new CliError('INVALID_ARGUMENT', 'Missing required option --scope <scope>');
  }

  const scope = validateScope(opts.scope);
  if (!scope) {
    throw new CliError('INVALID_ARGUMENT', `Invalid scope "${opts.scope}". Must be global or project`);
  }

  const { homeRoot, workspaceRoot } = resolveRoots(opts);
  const root = scope === 'project' ? workspaceRoot : undefined;

  const manifest = await readManifest(scope, root, homeRoot);
  const existing = manifest.sources.find((s) => s.id === id);
  if (!existing) {
    throw new CliError('NOT_FOUND', `Source "${id}" not found in ${scope} scope`);
  }

  if (!opts.write) {
    return {
      mode: 'plan',
      action: 'remove',
      source: existing,
    };
  }

  const removed = await removeSourceFromManifest(id, scope, {
    projectRoot: root,
    homeRoot,
  });

  return {
    mode: 'applied',
    action: 'removed',
    source: removed,
    changedFiles: {
      added: [],
      changed: [manifestPath(scope, root, homeRoot)],
      removed: [],
    },
  };
}

export async function runUpdate(
  keyOrOpts?: string | (GlobalCliOptions & Record<string, any>),
  options?: GlobalCliOptions & Record<string, any>
) {
  let key: string | undefined;
  let opts: GlobalCliOptions & {
    all?: boolean;
    scope?: string;
    assistant?: string;
    source?: string;
    kind?: string;
    includeModified?: boolean;
    write?: boolean;
    allowCodeKinds?: boolean;
  };

  if (typeof keyOrOpts === 'string') {
    key = keyOrOpts;
    opts = options ?? {};
  } else {
    opts = { ...(typeof keyOrOpts === 'object' ? keyOrOpts : {}), ...(options ?? {}) } as any;
    key = (opts as any).key;
  }

  if (!key && !opts.all) {
    throw new CliError('INVALID_ARGUMENT', 'Specify an item key to update or pass --all');
  }

  const { homeRoot, workspaceRoot } = resolveRoots(opts);

  const allInstallations: ManagedInstallation[] = [];
  const globalSources: Source[] = [];
  const workspaceSources: Source[] = [];

  try {
    const gState = await readState('global', undefined, homeRoot);
    allInstallations.push(...gState.installations);
    const gManifest = await readManifest('global', undefined, homeRoot);
    globalSources.push(...gManifest.sources.map((d) => fromDesiredSource(d, undefined, homeRoot)));
  } catch {
    // ignore
  }

  if (workspaceRoot) {
    try {
      const pState = await readState('project', workspaceRoot, homeRoot);
      allInstallations.push(...pState.installations);
      const pManifest = await readManifest('project', workspaceRoot, homeRoot);
      workspaceSources.push(...pManifest.sources.map((d) => fromDesiredSource(d, workspaceRoot, homeRoot)));
    } catch {
      // ignore
    }
  }

  let targetInstallations: ManagedInstallation[];
  if (key) {
    const found = allInstallations.find((i) => {
      const itemKey = `${i.assistant}:${i.scope}:${i.kind}:${i.name}`;
      return itemKey === key || i.name === key;
    });
    if (!found) {
      throw new CliError('NOT_FOUND', `Managed installation "${key}" not found`);
    }
    targetInstallations = [found];
  } else {
    targetInstallations = allInstallations;
  }

  const filterScope = validateScope(opts.scope);
  const filterAssistant = opts.assistant ? (opts.assistant as AssistantId) : undefined;
  const filterKind = opts.kind && VALID_KINDS.includes(opts.kind as ItemKind) ? (opts.kind as ItemKind) : undefined;

  // Gate: refuse executable/code kinds unless --allow-code-kinds is given
  refuseCodeKinds(targetInstallations.map((i) => i.kind), opts.allowCodeKinds);

  const planResult = await planUpdateAll({
    installations: targetInstallations,
    sources: { globalSources, workspaceSources },
    filter: {
      scope: filterScope,
      assistant: filterAssistant,
      sourceId: opts.source,
      kind: filterKind,
    },
    includeModified: Boolean(opts.includeModified),
    homeRoot,
    projectRoot: workspaceRoot,
  });

  if (!opts.write) {
    return {
      mode: 'plan',
      targets: [
        ...planResult.toUpdate.map((u) => {
          const oldRevision =
            u.report?.installedCommit ??
            u.installation.sourceRevision?.commit ??
            u.installation.sourceRevision;
          const newRevision =
            (u.prepared.supported ? u.prepared.plan.sourceRevision?.commit : undefined) ??
            u.report?.currentCommit ??
            (u.prepared.supported ? u.prepared.plan.sourceRevision : undefined);
          return {
            key: `${u.installation.assistant}:${u.installation.scope}:${u.installation.kind}:${u.installation.name}`,
            item: u.installation.name,
            kind: u.installation.kind,
            assistant: u.installation.assistant,
            scope: u.installation.scope,
            status: 'update-available',
            action: 'update',
            oldRevision,
            newRevision,
            ...(u.report?.commitsBehind !== undefined ? { commitsBehind: u.report.commitsBehind } : {}),
            changedFiles: computePlanChangedFiles(u.prepared),
          };
        }),
        ...planResult.skippedModified.map((s) => {
          const oldRevision =
            s.report?.installedCommit ??
            s.installation.sourceRevision?.commit ??
            s.installation.sourceRevision;
          const newRevision = s.report?.currentCommit;
          return {
            key: `${s.installation.assistant}:${s.installation.scope}:${s.installation.kind}:${s.installation.name}`,
            item: s.installation.name,
            kind: s.installation.kind,
            assistant: s.installation.assistant,
            scope: s.installation.scope,
            status: s.status,
            action: 'skip',
            reason: 'Modified locally (use --include-modified to overwrite)',
            oldRevision,
            ...(newRevision !== undefined ? { newRevision } : {}),
            ...(s.report?.commitsBehind !== undefined ? { commitsBehind: s.report.commitsBehind } : {}),
            changedFiles: { added: [], changed: [], removed: [] },
          };
        }),
        ...planResult.upToDate.map((utd) => {
          const oldRevision =
            utd.report?.installedCommit ??
            utd.installation.sourceRevision?.commit ??
            utd.installation.sourceRevision;
          const newRevision = utd.report?.currentCommit;
          return {
            key: `${utd.installation.assistant}:${utd.installation.scope}:${utd.installation.kind}:${utd.installation.name}`,
            item: utd.installation.name,
            kind: utd.installation.kind,
            assistant: utd.installation.assistant,
            scope: utd.installation.scope,
            status: 'up-to-date',
            action: 'skip',
            oldRevision,
            ...(newRevision !== undefined ? { newRevision } : {}),
            ...(utd.report?.commitsBehind !== undefined ? { commitsBehind: utd.report.commitsBehind } : {}),
            changedFiles: { added: [], changed: [], removed: [] },
          };
        }),
        ...planResult.cannotUpdate.map((c) => {
          const oldRevision =
            c.report?.installedCommit ??
            c.installation.sourceRevision?.commit ??
            c.installation.sourceRevision;
          const newRevision = c.report?.currentCommit;
          return {
            key: `${c.installation.assistant}:${c.installation.scope}:${c.installation.kind}:${c.installation.name}`,
            item: c.installation.name,
            kind: c.installation.kind,
            assistant: c.installation.assistant,
            scope: c.installation.scope,
            status: 'cannot-update',
            action: 'skip',
            reason: c.reason,
            oldRevision,
            ...(newRevision !== undefined ? { newRevision } : {}),
            ...(c.report?.commitsBehind !== undefined ? { commitsBehind: c.report.commitsBehind } : {}),
            changedFiles: { added: [], changed: [], removed: [] },
          };
        }),
      ],
    };
  }

  // Applied mode
  const appliedTargets: Array<{
    key: string;
    item: string;
    kind: ItemKind;
    assistant: AssistantId;
    scope: Scope;
    status: string;
    action?: string;
    oldRevision?: any;
    newRevision?: any;
    commitsBehind?: number;
    changedFiles: ChangedFilesMap;
    backupPath?: string;
    reason?: string;
  }> = [];

  for (const u of planResult.toUpdate) {
    let backupPath: string | undefined;
    const isModified =
      u.report?.status === 'modified-locally' ||
      u.report?.status === 'modified-and-update-available';

    if (isModified) {
      try {
        backupPath = await backupItemToTrash(u.installation, homeRoot);
      } catch {
        // ignore backup error
      }
    }

    const beforeTree = snapshotTree(u.installation.path);
    const root = u.installation.scope === 'project' ? (u.installation.projectPath ?? workspaceRoot) : undefined;
    const oldRevision =
      u.report?.installedCommit ??
      u.installation.sourceRevision?.commit ??
      u.installation.sourceRevision;
    const plannedNewRevision =
      (u.prepared.supported ? u.prepared.plan.sourceRevision?.commit : undefined) ??
      u.report?.currentCommit ??
      (u.prepared.supported ? u.prepared.plan.sourceRevision : undefined);

    try {
      const outcome = await withStateLock(u.installation.scope, root, homeRoot, async () => {
        return await applyInstall(u.prepared, homeRoot);
      });

      const afterTree = snapshotTree(u.installation.path);
      const changedFiles = diffSnapshots(beforeTree, afterTree);
      const newRevision =
        outcome.status === 'applied'
          ? (outcome.installation.sourceRevision?.commit ?? plannedNewRevision)
          : plannedNewRevision;

      appliedTargets.push({
        key: `${u.installation.assistant}:${u.installation.scope}:${u.installation.kind}:${u.installation.name}`,
        item: u.installation.name,
        kind: u.installation.kind,
        assistant: u.installation.assistant,
        scope: u.installation.scope,
        status: outcome.status === 'applied' ? 'updated' : 'failed',
        action: outcome.status === 'applied' ? 'updated' : 'failed',
        oldRevision,
        newRevision,
        ...(u.report?.commitsBehind !== undefined ? { commitsBehind: u.report.commitsBehind } : {}),
        changedFiles,
        ...(backupPath ? { backupPath } : {}),
        ...(outcome.status !== 'applied' && outcome.reason ? { reason: outcome.reason } : {}),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      appliedTargets.push({
        key: `${u.installation.assistant}:${u.installation.scope}:${u.installation.kind}:${u.installation.name}`,
        item: u.installation.name,
        kind: u.installation.kind,
        assistant: u.installation.assistant,
        scope: u.installation.scope,
        status: 'failed',
        action: 'failed',
        oldRevision,
        newRevision: plannedNewRevision,
        ...(u.report?.commitsBehind !== undefined ? { commitsBehind: u.report.commitsBehind } : {}),
        changedFiles: { added: [], changed: [], removed: [] },
        reason: msg,
        ...(backupPath ? { backupPath } : {}),
      });
    }
  }

  // Include skipped items
  for (const s of planResult.skippedModified) {
    const oldRevision =
      s.report?.installedCommit ??
      s.installation.sourceRevision?.commit ??
      s.installation.sourceRevision;
    const newRevision = s.report?.currentCommit;
    appliedTargets.push({
      key: `${s.installation.assistant}:${s.installation.scope}:${s.installation.kind}:${s.installation.name}`,
      item: s.installation.name,
      kind: s.installation.kind,
      assistant: s.installation.assistant,
      scope: s.installation.scope,
      status: s.status,
      action: 'skipped',
      reason: 'Modified locally (use --include-modified to overwrite)',
      oldRevision,
      ...(newRevision !== undefined ? { newRevision } : {}),
      ...(s.report?.commitsBehind !== undefined ? { commitsBehind: s.report.commitsBehind } : {}),
      changedFiles: { added: [], changed: [], removed: [] },
    });
  }

  for (const utd of planResult.upToDate) {
    const oldRevision =
      utd.report?.installedCommit ??
      utd.installation.sourceRevision?.commit ??
      utd.installation.sourceRevision;
    const newRevision = utd.report?.currentCommit;
    appliedTargets.push({
      key: `${utd.installation.assistant}:${utd.installation.scope}:${utd.installation.kind}:${utd.installation.name}`,
      item: utd.installation.name,
      kind: utd.installation.kind,
      assistant: utd.installation.assistant,
      scope: utd.installation.scope,
      status: 'up-to-date',
      action: 'skipped',
      oldRevision,
      ...(newRevision !== undefined ? { newRevision } : {}),
      ...(utd.report?.commitsBehind !== undefined ? { commitsBehind: utd.report.commitsBehind } : {}),
      changedFiles: { added: [], changed: [], removed: [] },
    });
  }

  for (const c of planResult.cannotUpdate) {
    const oldRevision =
      c.report?.installedCommit ??
      c.installation.sourceRevision?.commit ??
      c.installation.sourceRevision;
    const newRevision = c.report?.currentCommit;
    appliedTargets.push({
      key: `${c.installation.assistant}:${c.installation.scope}:${c.installation.kind}:${c.installation.name}`,
      item: c.installation.name,
      kind: c.installation.kind,
      assistant: c.installation.assistant,
      scope: c.installation.scope,
      status: 'cannot-update',
      action: 'skipped',
      reason: c.reason,
      oldRevision,
      ...(newRevision !== undefined ? { newRevision } : {}),
      ...(c.report?.commitsBehind !== undefined ? { commitsBehind: c.report.commitsBehind } : {}),
      changedFiles: { added: [], changed: [], removed: [] },
    });
  }

  return {
    mode: 'applied',
    targets: appliedTargets,
  };
}

export async function runTrashList(
  opts: GlobalCliOptions & { scope?: string }
) {
  const { homeRoot, workspaceRoot } = resolveRoots(opts);
  const filterScope = validateScope(opts.scope);

  const entries: TrashEntry[] = [];
  if (!filterScope || filterScope === 'global') {
    entries.push(...(await listTrash('global', undefined, homeRoot)));
  }
  if ((!filterScope || filterScope === 'project') && workspaceRoot) {
    entries.push(...(await listTrash('project', workspaceRoot, homeRoot)));
  }

  entries.sort(
    (a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime()
  );

  return entries.map((e) => ({
    id: path.basename(e.trashPath),
    kind: e.kind,
    name: e.name,
    assistant: e.assistant,
    scope: e.scope,
    deletedAt: e.deletedAt,
    originalPath: e.originalPath,
    trashPath: e.trashPath,
  }));
}

export async function runTrashRestore(
  id: string,
  opts: GlobalCliOptions & { to?: string; write?: boolean }
) {
  if (!id) {
    throw new CliError('INVALID_ARGUMENT', 'Trash entry ID is required');
  }

  const { homeRoot, workspaceRoot } = resolveRoots(opts);
  const allEntries: TrashEntry[] = [
    ...(await listTrash('global', undefined, homeRoot)),
    ...(workspaceRoot ? await listTrash('project', workspaceRoot, homeRoot) : []),
  ];

  const entry = allEntries.find(
    (e) => path.basename(e.trashPath) === id || e.trashPath === id || e.name === id
  );

  if (!entry) {
    throw new CliError('NOT_FOUND', `Trash entry "${id}" not found`);
  }

  const targetPath = opts.to ? path.resolve(opts.to) : entry.originalPath;
  if (!targetPath) {
    throw new CliError(
      'INVALID_ARGUMENT',
      `Trash entry "${id}" has no original path recorded; specify destination path using --to <path>`
    );
  }

  if (!opts.write) {
    return {
      mode: 'plan',
      id: path.basename(entry.trashPath),
      name: entry.name,
      kind: entry.kind,
      scope: entry.scope,
      targetPath,
      trashPath: entry.trashPath,
      action: 'restore',
    };
  }

  const outcome = await restoreFromTrash(entry, targetPath);
  if (outcome.status === 'conflict') {
    throw new CliError('CONFLICT', outcome.message);
  }

  return {
    mode: 'applied',
    id: path.basename(entry.trashPath),
    name: entry.name,
    kind: entry.kind,
    scope: entry.scope,
    targetPath: outcome.restoredPath,
    changedFiles: {
      added: [outcome.restoredPath],
      changed: [],
      removed: [],
    },
  };
}

export async function runTrashEmpty(
  opts: GlobalCliOptions & { scope?: string; write?: boolean }
) {
  const { homeRoot, workspaceRoot } = resolveRoots(opts);
  const filterScope = validateScope(opts.scope);

  if (!opts.write) {
    const entries: TrashEntry[] = [];
    if (!filterScope || filterScope === 'global') {
      entries.push(...(await listTrash('global', undefined, homeRoot)));
    }
    if ((!filterScope || filterScope === 'project') && workspaceRoot) {
      entries.push(...(await listTrash('project', workspaceRoot, homeRoot)));
    }
    return {
      mode: 'plan',
      action: 'empty',
      scope: filterScope ?? 'all',
      count: entries.length,
    };
  }

  const result = await emptyTrash(
    filterScope,
    filterScope === 'project' || !filterScope ? workspaceRoot : undefined,
    homeRoot
  );

  return {
    mode: 'applied',
    count: result.count,
    failed: result.failed.map((f) => ({
      name: f.name,
      kind: f.kind,
      error: f.error,
    })),
  };
}

export async function runRelink(
  itemKeyOrName: string,
  opts: GlobalCliOptions & { source?: string; write?: boolean }
): Promise<CliRelinkOutput> {
  if (!itemKeyOrName || itemKeyOrName.trim() === '') {
    throw new CliError('INVALID_ARGUMENT', 'Item key or name is required for relink.');
  }
  if (!opts.source || opts.source.trim() === '') {
    throw new CliError(
      'INVALID_ARGUMENT',
      'Option --source <scope>:<id> is required for relink.'
    );
  }

  const { homeRoot, workspaceRoot } = resolveRoots(opts);
  const assistantFilter = parseAssistantFilter(opts.assistants);
  const rawSourceSpec = opts.source.trim();

  let targetSourceScope: Scope | undefined;
  let targetSourceId: string = rawSourceSpec;

  const firstColon = rawSourceSpec.indexOf(':');
  if (firstColon !== -1) {
    const scopePrefix = rawSourceSpec.slice(0, firstColon).toLowerCase();
    const restId = rawSourceSpec.slice(firstColon + 1);
    if (scopePrefix === 'global') {
      targetSourceScope = 'global';
      targetSourceId = restId;
    } else if (scopePrefix === 'project' || scopePrefix === 'workspace') {
      targetSourceScope = 'project';
      targetSourceId = restId;
    }
  }

  if (!targetSourceId) {
    throw new CliError(
      'INVALID_ARGUMENT',
      `Invalid --source "${rawSourceSpec}". Expected <scope>:<id> (e.g. global:my-source or project:my-source).`
    );
  }

  const globalSources: Source[] = [];
  const workspaceSources: Source[] = [];
  try {
    const gManifest = await readManifest('global', undefined, homeRoot);
    globalSources.push(...gManifest.sources.map((d) => fromDesiredSource(d, undefined, homeRoot)));
  } catch {
    // ignore
  }
  if (workspaceRoot) {
    try {
      const pManifest = await readManifest('project', workspaceRoot, homeRoot);
      workspaceSources.push(
        ...pManifest.sources.map((d) => fromDesiredSource(d, workspaceRoot, homeRoot))
      );
    } catch {
      // ignore
    }
  }

  let matchedSources: Source[];
  if (targetSourceScope === 'global') {
    matchedSources = globalSources.filter((s) => s.id === targetSourceId);
  } else if (targetSourceScope === 'project') {
    matchedSources = workspaceSources.filter((s) => s.id === targetSourceId);
  } else {
    matchedSources = [...globalSources, ...workspaceSources].filter(
      (s) => s.id === targetSourceId
    );
    if (matchedSources.length > 1) {
      throw new CliError(
        'INVALID_ARGUMENT',
        `Multiple sources match id "${targetSourceId}"; specify <scope>:<id> (global:${targetSourceId} or project:${targetSourceId}).`
      );
    }
  }

  if (matchedSources.length === 0) {
    throw new CliError(
      'NOT_FOUND',
      targetSourceScope
        ? `Source "${targetSourceId}" not found in ${targetSourceScope === 'project' ? 'workspace' : 'global'} manifest.`
        : `Source "${targetSourceId}" not found in global or workspace manifest.`
    );
  }

  const targetSource = matchedSources[0];

  // Locate the managed installation by full key (<assistant>:<scope>:<kind>:<name>) or unambiguous name
  const allManaged: ManagedInstallation[] = [];
  const prevSkip = !opts.write;
  if (prevSkip) {
    setSkipStateMigrationWrite(true);
  }
  try {
    const gState = await readState('global', undefined, homeRoot);
    allManaged.push(...gState.installations);
    if (workspaceRoot) {
      const pState = await readState('project', workspaceRoot, homeRoot);
      allManaged.push(
        ...pState.installations.map((i) => ({
          ...i,
          projectPath: i.projectPath ?? workspaceRoot,
        }))
      );
    }
  } finally {
    if (prevSkip) {
      setSkipStateMigrationWrite(false);
    }
  }

  const filteredManaged = assistantFilter
    ? allManaged.filter((m) => assistantFilter.includes(m.assistant))
    : allManaged;

  const keyMatches = filteredManaged.filter(
    (m) => `${m.assistant}:${m.scope}:${m.kind}:${m.name}` === itemKeyOrName
  );
  let targetInst: ManagedInstallation | undefined;
  if (keyMatches.length === 1) {
    targetInst = keyMatches[0];
  } else if (keyMatches.length > 1) {
    targetInst = keyMatches[0];
  } else {
    const nameMatches = filteredManaged.filter((m) => m.name === itemKeyOrName);
    if (nameMatches.length === 1) {
      targetInst = nameMatches[0];
    } else if (nameMatches.length > 1) {
      const keys = nameMatches
        .map((m) => `${m.assistant}:${m.scope}:${m.kind}:${m.name}`)
        .join(', ');
      throw new CliError(
        'INVALID_ARGUMENT',
        `Multiple managed installations match "${itemKeyOrName}" (${keys}); pass the full item key.`
      );
    }
  }

  if (!targetInst) {
    throw new CliError(
      'NOT_FOUND',
      `Managed installation "${itemKeyOrName}" not found.`
    );
  }

  const result = await relinkInstallation(targetInst, targetSource, {
    homeRoot,
    projectRoot: targetInst.scope === 'project' ? (targetInst.projectPath ?? workspaceRoot) : undefined,
    write: Boolean(opts.write),
  });

  return {
    mode: result.mode,
    key: result.key,
    item: result.item,
    assistant: result.assistant,
    scope: result.scope,
    kind: result.kind,
    path: result.path,
    oldSource: result.oldSource,
    oldSourceId: result.oldSourceId,
    newSource: result.newSource,
    packageId: result.packageId,
    artifactId: result.artifactId,
    sourceRevision: result.sourceRevision,
    sourceContentHash: result.sourceContentHash,
  };
}

