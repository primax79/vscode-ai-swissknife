import * as fs from 'fs';
import * as path from 'path';
import {
  toInstallationSourceIdentity,
  type AssistantId,
  type InstallationSourceIdentity,
  type ItemKind,
  type ManagedInstallation,
  type Package,
  type Artifact,
  type ResolvedRevision,
  type Scope,
  type Source,
} from '../domain/types';
import type {
  Adapter,
  CanonicalSkill,
  CanonicalAgent,
  CanonicalCommand,
  CanonicalMcpServer,
  CanonicalHook,
  CanonicalRule,
} from '../adapters/types';
import {
  canonicalSkillHash,
  canonicalAgentHash,
  canonicalCommandHash,
  canonicalMcpServerHash,
  canonicalHookHash,
  canonicalRuleHash,
} from '../adapters/codec';
import { getAdapter, getAdapterWithHomeRoot } from '../adapters/registry';
import { getSourceResolver } from '../sources/registry';
import { planInstall, resolveAndTranslate } from './plan';
import { applyInstall } from './apply';
import {
  checkForUpstreamUpdate,
  analyzeLocalDrift,
  checkDriftForAll,
  resolveInstallationSource,
  sourceResolutionKey,
  matchInstallationArtifact,
  type SourceLookupInput,
} from './drift';
import { manifestPath, readState, writeState, withStateLock } from '../domain/registry';
import { copyToTrash } from './softDelete';
import type { DriftReport, PreparedInstall } from './types';
import type { SourceResolution } from '../sources/types';

export type { DriftReport, PreparedInstall };

export interface PlanUpdateOptions {
  resolution?: SourceResolution;
  targetAdapter?: Adapter;
  homeRoot?: string;
  projectRoot?: string;
  resolverOpts?: { cacheDir?: string };
}

export interface UpdateFilter {
  scope?: Scope;
  assistant?: AssistantId;
  sourceId?: string;
  kind?: ItemKind;
}

export interface PlanUpdateAllParams {
  installations: ManagedInstallation[];
  sources: SourceLookupInput;
  reports?: DriftReport[] | ReadonlyMap<string, DriftReport> | Map<string, DriftReport>;
  filter?: UpdateFilter;
  includeModified?: boolean;
  homeRoot?: string;
  projectRoot?: string;
  resolverOpts?: { cacheDir?: string };
}

export interface UpdatePlanItem {
  installation: ManagedInstallation;
  source: Source;
  report?: DriftReport;
  prepared: PreparedInstall;
}

export interface SkippedModifiedItem {
  installation: ManagedInstallation;
  status: 'modified-locally' | 'modified-and-update-available';
  report?: DriftReport;
  reason?: string;
}

export interface CannotUpdateItem {
  installation: ManagedInstallation;
  reason: string;
  report?: DriftReport;
}

export interface UpToDateItem {
  installation: ManagedInstallation;
  report?: DriftReport;
}

export interface HeldItem {
  installation: ManagedInstallation;
  reason?: string;
  report?: DriftReport;
}

export type HeldUpdateItem = HeldItem;

export interface PlanUpdateAllResult {
  toUpdate: UpdatePlanItem[];
  skippedModified: SkippedModifiedItem[];
  cannotUpdate: CannotUpdateItem[];
  upToDate: UpToDateItem[];
  held: HeldItem[];
  buckets: {
    toUpdate: UpdatePlanItem[];
    skippedModified: SkippedModifiedItem[];
    cannotUpdate: CannotUpdateItem[];
    upToDate: UpToDateItem[];
    held: HeldItem[];
  };
  counts: {
    toUpdate: number;
    skippedModified: number;
    cannotUpdate: number;
    upToDate: number;
    held: number;
    total: number;
  };
}

export interface ApplyUpdateAllOptions {
  backupModified?: boolean;
  homeRoot?: string;
  onProgress?: (item: UpdatePlanItem, index: number, total: number) => void;
}

export type UpdateItemOutcomeStatus =
  | 'applied'
  | 'refused'
  | 'rolled-back'
  | 'manual-recovery-required'
  | 'failed';

export interface UpdateItemOutcome {
  installation: ManagedInstallation;
  status: UpdateItemOutcomeStatus;
  reason?: string;
  warnings?: string[];
  backupPath?: string;
}

/**
 * Plans an update for a single installation from a source.
 * Recreates the placeholder package & artifact (or finds them in resolution) and invokes planInstall.
 */
export async function planUpdate(
  inst: ManagedInstallation,
  source: Source,
  options?: PlanUpdateOptions
): Promise<PreparedInstall> {
  if (inst.disabled) {
    return {
      supported: false,
      plan: {
        supported: false,
        sourceId: source.id,
        packageId: inst.packageId ?? `${source.id}:${inst.name}`,
        artifactId: inst.artifactId ?? `${source.id}:${inst.name}`,
        reason: `Cannot update disabled item "${inst.name}". Enable the item before updating.`,
      },
    };
  }

  let targetPkg: Package | undefined;
  let targetArt: Artifact | undefined;

  let resolution = options?.resolution;
  if (!resolution) {
    try {
      const resolver = getSourceResolver(source.type);
      resolution = await resolver.resolve(source, {
        cacheDir: options?.resolverOpts?.cacheDir,
        homeRoot: options?.homeRoot,
      });
    } catch {
      // resolution fallback
    }
  }

  if (resolution) {
    const matched = matchInstallationArtifact(inst, source, resolution);
    if (!matched.matched) {
      const reason = matched.hint ? `${matched.reason}; ${matched.hint}` : matched.reason;
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: inst.packageId ?? `${source.id}:${inst.name}`,
          artifactId: inst.artifactId ?? `${source.id}:${inst.name}`,
          reason,
        },
      };
    }
    targetPkg = matched.pkg;
    targetArt = matched.artifact;
  }

  const fakePkg: Package = targetPkg ?? {
    id: inst.packageId ?? `${source.id}:${inst.name}`,
    sourceId: source.id,
    nativeFormat: 'raw',
    artifacts: [],
  };

  const fakeArtifact: Artifact = targetArt ?? {
    id: inst.artifactId ?? `${source.id}:${inst.name}`,
    packageId: fakePkg.id,
    kind: inst.kind,
    name: inst.name,
    nativeFormat: 'raw',
  };

  const targetAdapter =
    options?.targetAdapter ??
    (options?.homeRoot
      ? getAdapterWithHomeRoot(inst.assistant, options.homeRoot)
      : getAdapter(inst.assistant));

  return await planInstall({
    source,
    pkg: fakePkg,
    artifact: fakeArtifact,
    targetAdapter,
    targetScope: inst.scope,
    projectRoot: inst.scope === 'project' ? (inst.projectPath ?? options?.projectRoot) : undefined,
    homeRoot: options?.homeRoot,
    resolverOpts: options?.resolverOpts,
    skipGitRefresh: Boolean(resolution),
  });
}

function isSameInstallation(a: ManagedInstallation, b: ManagedInstallation): boolean {
  if (a === b) return true;
  return (
    a.assistant === b.assistant &&
    a.scope === b.scope &&
    a.kind === b.kind &&
    a.name === b.name &&
    (a.projectPath ?? '') === (b.projectPath ?? '')
  );
}

function findReport(
  reports: DriftReport[] | ReadonlyMap<string, DriftReport> | Map<string, DriftReport> | undefined,
  inst: ManagedInstallation
): DriftReport | undefined {
  if (!reports) return undefined;
  if (Array.isArray(reports)) {
    return reports.find((r) => r.installation && isSameInstallation(r.installation, inst));
  }
  if (reports && typeof (reports as any).get === 'function') {
    const map = reports as Map<string, DriftReport>;
    const idKey = `${inst.assistant}:${inst.scope}:${inst.kind}:${inst.projectPath ?? ''}:${inst.name}`;
    if (map.has(idKey)) return map.get(idKey);
    if (map.has(inst.path)) return map.get(inst.path);
    if (map.has(inst as any)) return map.get(inst as any);
    for (const r of map.values()) {
      if (r && r.installation && isSameInstallation(r.installation, inst)) {
        return r;
      }
    }
  }
  return undefined;
}

/**
 * Plans updates for many installations, classifying them into buckets:
 * - `toUpdate`: items with update-available (and modified items if `includeModified: true`)
 * - `skippedModified`: locally modified items skipped by default
 * - `cannotUpdate`: items missing sourceId, missing in manifest, failed resolution, missing on disk, or unsupported plan
 * - `upToDate`: items that are already current
 *
 * Each source is resolved at most once across the entire run. Never writes to disk.
 */
export async function planUpdateAll(params: PlanUpdateAllParams): Promise<PlanUpdateAllResult> {
  const {
    installations,
    sources,
    reports,
    filter,
    includeModified = false,
    homeRoot,
    projectRoot,
    resolverOpts,
  } = params;

  const toUpdate: UpdatePlanItem[] = [];
  const skippedModified: SkippedModifiedItem[] = [];
  const cannotUpdate: CannotUpdateItem[] = [];
  const upToDate: UpToDateItem[] = [];
  const held: HeldItem[] = [];

  const sourceResolutions = new Map<
    string,
    { resolution?: SourceResolution; error?: Error }
  >();

  // If reports were not supplied, resolve each source once via checkDriftForAll
  let effectiveReports = reports;
  if (!effectiveReports) {
    effectiveReports = await checkDriftForAll(installations, sources, {
      homeRoot,
      resolverOpts,
      resolutions: sourceResolutions,
    });
  }

  for (const inst of installations) {
    // 1. Filter
    if (filter) {
      if (filter.scope !== undefined && inst.scope !== filter.scope) continue;
      if (filter.assistant !== undefined && inst.assistant !== filter.assistant) continue;
      if (filter.sourceId !== undefined && inst.sourceId !== filter.sourceId) continue;
      if (filter.kind !== undefined && inst.kind !== filter.kind) continue;
    }

    // 1.5. Check if disabled
    if (inst.disabled) {
      cannotUpdate.push({
        installation: inst,
        reason: `Cannot update disabled item "${inst.name}". Enable the item before updating.`,
      });
      continue;
    }

    // 1.6. Check if held
    if (inst.held) {
      const report = findReport(effectiveReports, inst);
      held.push({
        installation: inst,
        report,
        reason: 'Item is held (skipped by Update all).',
      });
      continue;
    }

    // 2. Check source identity / sourceId
    if (!inst.source && !inst.sourceId) {
      cannotUpdate.push({
        installation: inst,
        reason: `Cannot update "${inst.name}": no source ID recorded.`,
      });
      continue;
    }

    // 3. Find source in manifest
    const resolvedSource = resolveInstallationSource(inst, sources);
    if ('unavailable' in resolvedSource) {
      const report = findReport(effectiveReports, inst);
      cannotUpdate.push({
        installation: inst,
        report,
        reason: resolvedSource.hint
          ? `${resolvedSource.unavailable} ${resolvedSource.hint}`
          : resolvedSource.unavailable,
      });
      continue;
    }
    const source = resolvedSource.source;
    const resKey = sourceResolutionKey(source);

    // 4. Drift report
    let report = findReport(effectiveReports, inst);
    if (!report) {
      try {
        const resEntry = sourceResolutions.get(resKey) ?? sourceResolutions.get(source.id);
        report = await checkForUpstreamUpdate(inst, source, homeRoot, {
          resolution: resEntry?.resolution,
          resolutionError: resEntry?.error,
          resolverOpts,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        cannotUpdate.push({
          installation: inst,
          reason: `Failed to check drift: ${msg}`,
        });
        continue;
      }
    }

    // 5. Missing on disk / source unavailable
    if (report.status === 'missing-on-disk') {
      cannotUpdate.push({
        installation: inst,
        reason: report.details ?? `Item is missing on disk at ${inst.path}`,
        report,
      });
      continue;
    }
    if (report.status === 'source-unavailable' || report.status === 'provenance-unknown') {
      cannotUpdate.push({
        installation: inst,
        reason: report.details ?? `Source "${source.id}" is unavailable.`,
        report,
      });
      continue;
    }

    // 6. Modified & update availability
    const isModified =
      report.status === 'modified-locally' ||
      report.status === 'modified-and-update-available';

    const baselineSourceHash = inst.sourceContentHash ?? inst.contentHash;
    const hasUpdate =
      report.status === 'update-available' ||
      report.status === 'modified-and-update-available' ||
      (report.status === 'modified-locally' &&
        Boolean(report.sourceHash && baselineSourceHash && report.sourceHash !== baselineSourceHash));

    if (!hasUpdate) {
      if (isModified) {
        skippedModified.push({
          installation: inst,
          status: report.status as 'modified-locally' | 'modified-and-update-available',
          report,
          reason: 'Modified locally but no upstream update is available.',
        });
      } else {
        upToDate.push({
          installation: inst,
          report,
        });
      }
      continue;
    }

    // Has update, but modified and not including modified
    if (isModified && !includeModified) {
      skippedModified.push({
        installation: inst,
        status: report.status as 'modified-locally' | 'modified-and-update-available',
        report,
        reason: 'Item was modified locally (skipped by default; opt in with includeModified).',
      });
      continue;
    }

    // 7. Resolve source (once per source across run)
    let resEntry = sourceResolutions.get(resKey) ?? sourceResolutions.get(source.id);
    if (!resEntry) {
      try {
        const resolver = getSourceResolver(source.type);
        const resolution = await resolver.resolve(source, {
          homeRoot,
          cacheDir: resolverOpts?.cacheDir,
        });
        resEntry = { resolution };
        sourceResolutions.set(resKey, resEntry);
        sourceResolutions.set(source.id, resEntry);
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        resEntry = { error };
        sourceResolutions.set(resKey, resEntry);
        sourceResolutions.set(source.id, resEntry);
      }
    }

    if (resEntry.error) {
      cannotUpdate.push({
        installation: inst,
        reason: `Failed to resolve source "${source.id}": ${resEntry.error.message}`,
        report,
      });
      continue;
    }

    // 8. Plan update
    let prepared: PreparedInstall;
    try {
      prepared = await planUpdate(inst, source, {
        resolution: resEntry.resolution,
        homeRoot,
        projectRoot,
        resolverOpts,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      cannotUpdate.push({
        installation: inst,
        reason: `Failed to plan update for ${inst.name}: ${msg}`,
        report,
      });
      continue;
    }

    if (!prepared.supported) {
      cannotUpdate.push({
        installation: inst,
        reason: prepared.plan.reason,
        report,
      });
      continue;
    }

    toUpdate.push({
      installation: inst,
      source,
      report,
      prepared,
    });
  }

  const buckets = {
    toUpdate,
    skippedModified,
    cannotUpdate,
    upToDate,
    held,
  };

  const counts = {
    toUpdate: toUpdate.length,
    skippedModified: skippedModified.length,
    cannotUpdate: cannotUpdate.length,
    upToDate: upToDate.length,
    held: held.length,
    total:
      toUpdate.length +
      skippedModified.length +
      cannotUpdate.length +
      upToDate.length +
      held.length,
  };

  return {
    toUpdate,
    skippedModified,
    cannotUpdate,
    upToDate,
    held,
    buckets,
    counts,
  };
}

/**
 * Copies the current installed files to the trash folder (_deleted/<kind>/<name>-<timestamp>/)
 * with a .origin.json sidecar preserving the exact pre-update version for recoverability.
 */
export async function backupItemToTrash(
  installation: ManagedInstallation,
  homeRoot?: string
): Promise<string> {
  return await copyToTrash(
    installation.path,
    installation.kind,
    installation.name,
    installation.scope,
    installation.projectPath ?? (installation.scope === 'project' ? process.cwd() : undefined),
    homeRoot,
    { assistant: installation.assistant }
  );
}

/**
 * Applies updates sequentially for all planned items in toUpdate.
 * If an item is modified, its current version is copied to trash first (_deleted/...).
 * One failing item never stops the rest.
 */
export async function applyUpdateAll(
  plan: PlanUpdateAllResult | { toUpdate: UpdatePlanItem[] } | UpdatePlanItem[],
  options?: ApplyUpdateAllOptions
): Promise<UpdateItemOutcome[]> {
  const items = Array.isArray(plan) ? plan : plan.toUpdate;
  const outcomes: UpdateItemOutcome[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    options?.onProgress?.(item, i, items.length);
    let backupPath: string | undefined;
    try {
      let isModified =
        item.report?.status === 'modified-locally' ||
        item.report?.status === 'modified-and-update-available';

      if (!item.report) {
        try {
          const localReport = await analyzeLocalDrift(item.installation, options?.homeRoot);
          isModified =
            localReport.status === 'modified-locally' ||
            localReport.status === 'modified-and-update-available';
        } catch {
          // ignore
        }
      }

      if (isModified && options?.backupModified !== false) {
        backupPath = await backupItemToTrash(item.installation, options?.homeRoot);
      }

      const outcome = await applyInstall(item.prepared, {
        homeRoot: options?.homeRoot,
        overwrite: true,
      });
      if (outcome.status === 'applied') {
        outcomes.push({
          installation: outcome.installation,
          status: 'applied',
          warnings: outcome.warnings,
          backupPath,
        });
      } else {
        outcomes.push({
          installation: item.installation,
          status: outcome.status,
          reason: outcome.reason,
          backupPath,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      outcomes.push({
        installation: item.installation,
        status: 'failed',
        reason: msg,
        backupPath,
      });
    }
  }

  return outcomes;
}

export interface SetHeldOptions {
  homeRoot?: string;
  projectRoot?: string;
}

/**
 * Sets the held flag on a managed installation and writes state under withStateLock.
 */
export async function setHeld(
  inst: ManagedInstallation,
  held: boolean,
  options?: SetHeldOptions
): Promise<ManagedInstallation> {
  const projectRoot = inst.projectPath ?? options?.projectRoot;
  const homeRoot = options?.homeRoot;

  return await withStateLock(inst.scope, projectRoot, homeRoot, async () => {
    const state = await readState(inst.scope, projectRoot, homeRoot);
    let matched = false;
    state.installations = state.installations.map((item) => {
      if (isSameInstallation(item, inst)) {
        matched = true;
        return {
          ...item,
          held,
        };
      }
      return item;
    });

    if (!matched) {
      const idx = state.installations.findIndex(
        (i) =>
          i.assistant === inst.assistant &&
          i.kind === inst.kind &&
          i.name === inst.name &&
          i.scope === inst.scope
      );
      if (idx !== -1) {
        state.installations[idx] = {
          ...state.installations[idx],
          held,
        };
      } else {
        state.installations.push({
          ...inst,
          held,
        });
      }
    }

    await writeState(inst.scope, state, projectRoot, homeRoot);
    inst.held = held;
    return inst;
  });
}

function computeHashForKind(kind: ItemKind, content: unknown): string {
  switch (kind) {
    case 'skill':
      return canonicalSkillHash(content as CanonicalSkill);
    case 'agent':
      return canonicalAgentHash(content as CanonicalAgent);
    case 'command':
      return canonicalCommandHash(content as CanonicalCommand);
    case 'mcp-server':
      return canonicalMcpServerHash(content as CanonicalMcpServer);
    case 'hook':
      return canonicalHookHash(content as CanonicalHook);
    case 'rule':
      return canonicalRuleHash(content as CanonicalRule);
  }
}

export interface RelinkOptions {
  homeRoot?: string;
  projectRoot?: string;
  write?: boolean;
  resolution?: SourceResolution;
  resolverOpts?: { cacheDir?: string; offline?: boolean };
}

export interface RelinkResult {
  mode: 'plan' | 'applied';
  key: string;
  item: string;
  assistant: AssistantId;
  scope: Scope;
  kind: ItemKind;
  path: string;
  oldSource?: InstallationSourceIdentity;
  oldSourceId?: string;
  newSource: InstallationSourceIdentity;
  packageId?: string;
  artifactId?: string;
  sourceRevision?: ResolvedRevision;
  sourceContentHash?: string;
  installation: ManagedInstallation;
}

/**
 * Re-links a managed installation to a chosen registered `Source`, writing `source`
 * (and updating `packageId`, `artifactId`, `sourceRevision`, `sourceContentHash` when
 * resolved) and clearing `provenance: 'unknown'`.
 * When `options.write === false`, computes and returns the plan without writing `state.json`.
 */
export async function relinkInstallation(
  inst: ManagedInstallation,
  targetSource: Source,
  options?: RelinkOptions
): Promise<RelinkResult> {
  const projectRoot = inst.projectPath ?? options?.projectRoot;
  const homeRoot = options?.homeRoot;
  const write = options?.write ?? true;
  const newSource = toInstallationSourceIdentity(targetSource, homeRoot);

  let newPackageId = inst.packageId;
  let newArtifactId = inst.artifactId;
  if (inst.sourceId && inst.sourceId !== targetSource.id) {
    const oldPrefix = `${inst.sourceId}:`;
    if (newPackageId?.startsWith(oldPrefix)) {
      newPackageId = `${targetSource.id}:${newPackageId.slice(oldPrefix.length)}`;
    }
    if (newArtifactId?.startsWith(oldPrefix)) {
      newArtifactId = `${targetSource.id}:${newArtifactId.slice(oldPrefix.length)}`;
    }
  }

  let newRevision: ResolvedRevision | undefined;
  let newSourceContentHash: string | undefined = inst.contentHash;

  try {
    const effectiveSource: Source =
      targetSource.type === 'local-folder'
        ? { ...targetSource, readWorkingTree: false }
        : targetSource;
    const resolution =
      options?.resolution ??
      (await getSourceResolver(effectiveSource.type).resolve(effectiveSource, {
        homeRoot,
        cacheDir: options?.resolverOpts?.cacheDir,
        offline: options?.resolverOpts?.offline,
      }));

    const probeInst: ManagedInstallation = {
      ...inst,
      source: newSource,
      sourceId: targetSource.id,
      packageId: newPackageId,
      artifactId: newArtifactId,
    };

    let matchedPkg: Package | undefined;
    let matchedArt: Artifact | undefined;

    const matched = matchInstallationArtifact(probeInst, effectiveSource, resolution);
    if (matched.matched) {
      matchedPkg = matched.pkg;
      matchedArt = matched.artifact;
    } else {
      const byKindAndName: Array<{ pkg: Package; artifact: Artifact }> = [];
      for (const pkg of resolution.packages) {
        for (const art of pkg.artifacts) {
          if (art.kind === inst.kind && art.name === inst.name) {
            byKindAndName.push({ pkg, artifact: art });
          }
        }
      }
      if (byKindAndName.length === 1) {
        matchedPkg = byKindAndName[0].pkg;
        matchedArt = byKindAndName[0].artifact;
      }
    }

    if (matchedPkg && matchedArt) {
      newPackageId = matchedPkg.id;
      newArtifactId = matchedArt.id;

      try {
        const { translated } = await resolveAndTranslate(
          effectiveSource,
          matchedPkg,
          matchedArt,
          inst.assistant,
          {
            homeRoot,
            cacheDir: options?.resolverOpts?.cacheDir,
          }
        );
        const sourceHash = computeHashForKind(matchedArt.kind, translated);
        if (sourceHash === inst.contentHash && matchedPkg.version?.commit) {
          newRevision = {
            commit: matchedPkg.version.commit,
            ...(matchedPkg.version.requestedRef
              ? { requestedRef: matchedPkg.version.requestedRef }
              : {}),
          };
          newSourceContentHash = sourceHash;
        }
      } catch {
        // leave revision undefined if content translation fails
      }
    }
  } catch {
    // If source resolution fails during relink, still record the explicit source identity
  }

  const updatedInst: ManagedInstallation = {
    ...inst,
    source: newSource,
    sourceId: targetSource.id,
    ...(newPackageId ? { packageId: newPackageId } : {}),
    ...(newArtifactId ? { artifactId: newArtifactId } : {}),
    ...(newRevision ? { sourceRevision: newRevision } : {}),
    ...(newSourceContentHash ? { sourceContentHash: newSourceContentHash } : {}),
  };
  if (!newRevision) {
    delete updatedInst.sourceRevision;
  }
  delete updatedInst.provenance;
  delete updatedInst.provenanceReason;
  delete updatedInst.provenanceHint;

  const oldSource = inst.source;
  const oldSourceId = inst.sourceId;

  if (write) {
    await withStateLock(inst.scope, projectRoot, homeRoot, async () => {
      const state = await readState(inst.scope, projectRoot, homeRoot);
      let matched = false;
      state.installations = state.installations.map((item) => {
        if (isSameInstallation(item, inst)) {
          matched = true;
          return updatedInst;
        }
        return item;
      });

      if (!matched) {
        const idx = state.installations.findIndex(
          (i) =>
            i.assistant === inst.assistant &&
            i.kind === inst.kind &&
            i.name === inst.name &&
            i.scope === inst.scope
        );
        if (idx !== -1) {
          state.installations[idx] = updatedInst;
        } else {
          state.installations.push(updatedInst);
        }
      }

      await writeState(inst.scope, state, projectRoot, homeRoot);
    });

    inst.source = updatedInst.source;
    inst.sourceId = updatedInst.sourceId;
    inst.packageId = updatedInst.packageId;
    inst.artifactId = updatedInst.artifactId;
    inst.sourceRevision = updatedInst.sourceRevision;
    inst.sourceContentHash = updatedInst.sourceContentHash;
    delete inst.provenance;
    delete inst.provenanceReason;
    delete inst.provenanceHint;
  }

  return {
    mode: write ? 'applied' : 'plan',
    key: `${inst.assistant}:${inst.scope}:${inst.kind}:${inst.name}`,
    item: inst.name,
    assistant: inst.assistant,
    scope: inst.scope,
    kind: inst.kind,
    path: inst.path,
    oldSource,
    oldSourceId,
    newSource,
    packageId: updatedInst.packageId,
    artifactId: updatedInst.artifactId,
    sourceRevision: updatedInst.sourceRevision,
    sourceContentHash: updatedInst.sourceContentHash,
    installation: updatedInst,
  };
}

export interface ReinstallOptions {
  homeRoot?: string;
  projectRoot?: string;
  resolution?: SourceResolution;
  targetAdapter?: Adapter;
  resolverOpts?: { cacheDir?: string };
}

export interface ReinstallResult {
  status: 'applied' | 'refused' | 'rolled-back' | 'manual-recovery-required';
  installation: ManagedInstallation;
  backupPath?: string;
  reason?: string;
}

/**
 * Reinstalls an existing managed installation from `source`, backing up any local
 * modifications to the trash first, and recording full `source` provenance.
 */
export async function reinstallInstallation(
  inst: ManagedInstallation,
  source: Source,
  options?: ReinstallOptions
): Promise<ReinstallResult> {
  const homeRoot = options?.homeRoot;
  const projectRoot = inst.projectPath ?? options?.projectRoot;

  let resolution = options?.resolution;
  if (!resolution) {
    try {
      const resolver = getSourceResolver(source.type);
      resolution = await resolver.resolve(source, {
        homeRoot,
        cacheDir: options?.resolverOpts?.cacheDir,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: 'refused',
        installation: inst,
        reason: `Failed to resolve source "${source.id}": ${msg}`,
      };
    }
  }

  const probeInst: ManagedInstallation = {
    ...inst,
    source: toInstallationSourceIdentity(source, homeRoot),
    sourceId: source.id,
  };
  if (inst.sourceId && inst.sourceId !== source.id) {
    const oldPrefix = `${inst.sourceId}:`;
    if (probeInst.packageId?.startsWith(oldPrefix)) {
      probeInst.packageId = `${source.id}:${probeInst.packageId.slice(oldPrefix.length)}`;
    }
    if (probeInst.artifactId?.startsWith(oldPrefix)) {
      probeInst.artifactId = `${source.id}:${probeInst.artifactId.slice(oldPrefix.length)}`;
    }
  }

  let matchedPkg: Package | undefined;
  let matchedArt: Artifact | undefined;
  const matched = matchInstallationArtifact(probeInst, source, resolution);
  if (matched.matched) {
    matchedPkg = matched.pkg;
    matchedArt = matched.artifact;
  } else {
    const byKindAndName: Array<{ pkg: Package; artifact: Artifact }> = [];
    for (const pkg of resolution.packages) {
      for (const art of pkg.artifacts) {
        if (art.kind === inst.kind && art.name === inst.name) {
          byKindAndName.push({ pkg, artifact: art });
        }
      }
    }
    if (byKindAndName.length === 1) {
      matchedPkg = byKindAndName[0].pkg;
      matchedArt = byKindAndName[0].artifact;
    }
  }

  if (!matchedPkg || !matchedArt) {
    return {
      status: 'refused',
      installation: inst,
      reason: `Artifact "${inst.name}" not found in source "${source.id}".`,
    };
  }

  let backupPath: string | undefined;
  try {
    const localDrift = await analyzeLocalDrift(inst, homeRoot);
    if (localDrift.status === 'modified-locally') {
      backupPath = await backupItemToTrash(inst, homeRoot);
    }
  } catch {
    // ignore backup error if missing on disk
  }

  const targetAdapter =
    options?.targetAdapter ??
    (homeRoot ? getAdapterWithHomeRoot(inst.assistant, homeRoot) : getAdapter(inst.assistant));

  const prepared = await planInstall({
    source,
    pkg: matchedPkg,
    artifact: matchedArt,
    targetAdapter,
    targetScope: inst.scope,
    projectRoot: inst.scope === 'project' ? projectRoot : undefined,
    homeRoot,
    resolverOpts: options?.resolverOpts,
  });

  if (!prepared.supported) {
    return {
      status: 'refused',
      installation: inst,
      ...(backupPath ? { backupPath } : {}),
      reason: prepared.plan.reason,
    };
  }

  const outcome = await applyInstall(prepared, homeRoot);
  if (outcome.status === 'applied') {
    inst.source = outcome.installation.source;
    inst.sourceId = outcome.installation.sourceId;
    inst.packageId = outcome.installation.packageId;
    inst.artifactId = outcome.installation.artifactId;
    inst.sourceRevision = outcome.installation.sourceRevision;
    inst.contentHash = outcome.installation.contentHash;
    inst.sourceContentHash = outcome.installation.sourceContentHash;
    delete inst.provenance;
    delete inst.provenanceReason;
    delete inst.provenanceHint;
    return {
      status: 'applied',
      installation: outcome.installation,
      ...(backupPath ? { backupPath } : {}),
    };
  }

  return {
    status: outcome.status,
    installation: inst,
    ...(backupPath ? { backupPath } : {}),
    reason: outcome.reason,
  };
}
