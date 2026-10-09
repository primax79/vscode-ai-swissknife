import * as fs from 'fs';
import * as path from 'path';
import type {
  AssistantId,
  ItemKind,
  ManagedInstallation,
  Package,
  Artifact,
  Scope,
  Source,
} from '../domain/types';
import type { Adapter } from '../adapters/types';
import { getAdapter, getAdapterWithHomeRoot } from '../adapters/registry';
import { getSourceResolver } from '../sources/registry';
import { planInstall } from './plan';
import { applyInstall } from './apply';
import { checkForUpstreamUpdate, analyzeLocalDrift, checkDriftForAll } from './drift';
import { manifestPath } from '../domain/registry';
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
  sources: Source[] | ReadonlyMap<string, Source> | Map<string, Source>;
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

export interface PlanUpdateAllResult {
  toUpdate: UpdatePlanItem[];
  skippedModified: SkippedModifiedItem[];
  cannotUpdate: CannotUpdateItem[];
  upToDate: UpToDateItem[];
  buckets: {
    toUpdate: UpdatePlanItem[];
    skippedModified: SkippedModifiedItem[];
    cannotUpdate: CannotUpdateItem[];
    upToDate: UpToDateItem[];
  };
  counts: {
    toUpdate: number;
    skippedModified: number;
    cannotUpdate: number;
    upToDate: number;
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

  if (options?.resolution) {
    for (const pkg of options.resolution.packages) {
      for (const art of pkg.artifacts) {
        if (
          (inst.artifactId && art.id === inst.artifactId) ||
          (art.kind === inst.kind && art.name === inst.name)
        ) {
          targetPkg = pkg;
          targetArt = art;
          break;
        }
      }
      if (targetArt) break;
    }
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
    projectRoot: inst.projectPath ?? options?.projectRoot,
    resolverOpts: options?.resolverOpts,
  });
}

function findSource(
  sources: Source[] | ReadonlyMap<string, Source> | Map<string, Source>,
  sourceId: string
): Source | undefined {
  if (Array.isArray(sources)) {
    return sources.find((s) => s.id === sourceId);
  }
  if (sources && typeof (sources as any).get === 'function') {
    return (sources as Map<string, Source>).get(sourceId);
  }
  return undefined;
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

    // 2. Check sourceId
    if (!inst.sourceId) {
      cannotUpdate.push({
        installation: inst,
        reason: `Cannot update "${inst.name}": no source ID recorded.`,
      });
      continue;
    }

    // 3. Find source in manifest
    const source = findSource(sources, inst.sourceId);
    if (!source) {
      cannotUpdate.push({
        installation: inst,
        reason: `Source "${inst.sourceId}" not found in manifest.`,
      });
      continue;
    }

    // 4. Drift report
    let report = findReport(effectiveReports, inst);
    if (!report) {
      try {
        const resEntry = sourceResolutions.get(source.id);
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

    // 5. Missing on disk
    if (report.status === 'missing-on-disk') {
      cannotUpdate.push({
        installation: inst,
        reason: report.details ?? `Item is missing on disk at ${inst.path}`,
        report,
      });
      continue;
    }

    // 6. Modified & update availability
    const isModified =
      report.status === 'modified-locally' ||
      report.status === 'modified-and-update-available';

    const hasUpdate =
      report.status === 'update-available' ||
      report.status === 'modified-and-update-available' ||
      (report.status === 'modified-locally' &&
        Boolean(report.sourceHash && report.sourceHash !== inst.contentHash));

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
    let resEntry = sourceResolutions.get(source.id);
    if (!resEntry) {
      try {
        const resolver = getSourceResolver(source.type);
        const resolution = await resolver.resolve(source, {
          homeRoot,
          cacheDir: resolverOpts?.cacheDir,
        });
        resEntry = { resolution };
        sourceResolutions.set(source.id, resEntry);
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        resEntry = { error };
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
  };

  const counts = {
    toUpdate: toUpdate.length,
    skippedModified: skippedModified.length,
    cannotUpdate: cannotUpdate.length,
    upToDate: upToDate.length,
    total: toUpdate.length + skippedModified.length + cannotUpdate.length + upToDate.length,
  };

  return {
    toUpdate,
    skippedModified,
    cannotUpdate,
    upToDate,
    buckets,
    counts,
  };
}

/**
 * Copies the current installed files to the trash folder (_deleted/<kind>/<name>-<timestamp>/)
 * with a .origin.json sidecar preserving the exact pre-update version for recoverability.
 */
async function backupItemToTrash(
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

      const outcome = await applyInstall(item.prepared, options?.homeRoot);
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
