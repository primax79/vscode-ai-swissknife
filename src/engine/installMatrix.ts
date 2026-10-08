import type { AssistantId, Scope, Source, Package, Artifact, ManagedInstallation } from '../domain/types';
import type { Adapter } from '../adapters/types';
import { getAdapter, getAdapterWithHomeRoot } from '../adapters/registry';
import type { PreparedInstall, ApplyOutcome, PlanInstallParams } from './types';
import { planInstall } from './plan';
import { applyInstall } from './apply';

export interface MatrixItem {
  source: Source;
  pkg: Package;
  artifact: Artifact;
}

export interface MatrixTarget<T extends MatrixItem = MatrixItem> {
  item: T;
  assistant: AssistantId;
  scope: Scope;
  prepared: PreparedInstall;
}

export interface MatrixSummary<T extends MatrixItem = MatrixItem> {
  counts: {
    new: number;
    conflict: number;
    unsupported: number;
    total: number;
  };
  new: MatrixTarget<T>[];
  conflict: MatrixTarget<T>[];
  unsupported: MatrixTarget<T>[];
  buckets: {
    new: MatrixTarget<T>[];
    conflict: MatrixTarget<T>[];
    unsupported: MatrixTarget<T>[];
  };
}

export interface PlanInstallMatrixParams<T extends MatrixItem = MatrixItem> {
  items: T[];
  assistants: Array<AssistantId | PlanInstallParams['targetAdapter']>;
  scopes: Scope[];
  projectRoot?: string;
  homeRoot?: string;
  resolverOpts?: { cacheDir?: string };
}

export interface PlanInstallMatrixResult<T extends MatrixItem = MatrixItem> {
  targets: MatrixTarget<T>[];
  summary: MatrixSummary<T>;
}

export interface ApplyInstallMatrixOptions {
  overwrite?: boolean;
  homeRoot?: string;
}

export type MatrixTargetOutcome<T extends MatrixItem = MatrixItem> =
  | { status: 'applied'; installation: ManagedInstallation; warnings?: string[]; target: MatrixTarget<T>; outcome: ApplyOutcome }
  | { status: 'refused'; reason: string; target: MatrixTarget<T>; outcome: ApplyOutcome }
  | { status: 'rolled-back'; reason: string; target: MatrixTarget<T>; outcome: ApplyOutcome }
  | { status: 'manual-recovery-required'; reason: string; paths: string[]; target: MatrixTarget<T>; outcome: ApplyOutcome };

function toTargetOutcome<T extends MatrixItem>(
  target: MatrixTarget<T>,
  outcome: ApplyOutcome
): MatrixTargetOutcome<T> {
  switch (outcome.status) {
    case 'applied':
      return {
        status: 'applied',
        installation: outcome.installation,
        ...(outcome.warnings ? { warnings: outcome.warnings } : {}),
        target,
        outcome,
      };
    case 'refused':
      return {
        status: 'refused',
        reason: outcome.reason,
        target,
        outcome,
      };
    case 'rolled-back':
      return {
        status: 'rolled-back',
        reason: outcome.reason,
        target,
        outcome,
      };
    case 'manual-recovery-required':
      return {
        status: 'manual-recovery-required',
        reason: outcome.reason,
        paths: outcome.paths,
        target,
        outcome,
      };
  }
}

export async function planInstallMatrix<T extends MatrixItem = MatrixItem>(
  params: PlanInstallMatrixParams<T>
): Promise<PlanInstallMatrixResult<T>> {
  const targets: MatrixTarget<T>[] = [];

  for (const item of params.items) {
    for (const assistantEntry of params.assistants) {
      let assistantId: AssistantId;
      let targetAdapter: PlanInstallParams['targetAdapter'] | undefined;

      if (typeof assistantEntry === 'string') {
        assistantId = assistantEntry;
        try {
          targetAdapter = params.homeRoot
            ? getAdapterWithHomeRoot(assistantId, params.homeRoot)
            : getAdapter(assistantId);
        } catch {
          targetAdapter = undefined;
        }
      } else {
        assistantId = assistantEntry.assistant;
        targetAdapter = assistantEntry;
      }

      for (const scope of params.scopes) {
        if (scope === 'project' && !params.projectRoot) {
          const prepared: PreparedInstall = {
            supported: false,
            plan: {
              supported: false,
              sourceId: item.source.id,
              packageId: item.pkg.id,
              artifactId: item.artifact.id,
              reason: 'no workspace open',
            },
          };
          targets.push({
            item,
            assistant: assistantId,
            scope,
            prepared,
          });
          continue;
        }

        if (!targetAdapter) {
          const prepared: PreparedInstall = {
            supported: false,
            plan: {
              supported: false,
              sourceId: item.source.id,
              packageId: item.pkg.id,
              artifactId: item.artifact.id,
              reason: `Target assistant "${assistantId}" is not supported`,
            },
          };
          targets.push({
            item,
            assistant: assistantId,
            scope,
            prepared,
          });
          continue;
        }

        let prepared: PreparedInstall;
        try {
          prepared = await planInstall({
            source: item.source,
            pkg: item.pkg,
            artifact: item.artifact,
            targetAdapter,
            targetScope: scope,
            projectRoot: params.projectRoot,
            homeRoot: params.homeRoot,
            resolverOpts: params.resolverOpts,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          prepared = {
            supported: false,
            plan: {
              supported: false,
              sourceId: item.source.id,
              packageId: item.pkg.id,
              artifactId: item.artifact.id,
              reason: msg,
            },
          };
        }

        targets.push({
          item,
          assistant: assistantId,
          scope,
          prepared,
        });
      }
    }
  }

  const newTargets: MatrixTarget<T>[] = [];
  const conflictTargets: MatrixTarget<T>[] = [];
  const unsupportedTargets: MatrixTarget<T>[] = [];

  for (const target of targets) {
    if (!target.prepared.supported) {
      unsupportedTargets.push(target);
    } else if (target.prepared.plan.conflict) {
      conflictTargets.push(target);
    } else {
      newTargets.push(target);
    }
  }

  const summary: MatrixSummary<T> = {
    counts: {
      new: newTargets.length,
      conflict: conflictTargets.length,
      unsupported: unsupportedTargets.length,
      total: targets.length,
    },
    new: newTargets,
    conflict: conflictTargets,
    unsupported: unsupportedTargets,
    buckets: {
      new: newTargets,
      conflict: conflictTargets,
      unsupported: unsupportedTargets,
    },
  };

  return {
    targets,
    summary,
  };
}

export async function applyInstallMatrix<T extends MatrixItem = MatrixItem>(
  targetsOrResult: MatrixTarget<T>[] | { targets: MatrixTarget<T>[] },
  options: ApplyInstallMatrixOptions = {}
): Promise<MatrixTargetOutcome<T>[]> {
  const targets = Array.isArray(targetsOrResult) ? targetsOrResult : targetsOrResult.targets;
  const results: MatrixTargetOutcome<T>[] = [];

  for (const target of targets) {
    let outcome: ApplyOutcome;

    if (!target.prepared.supported) {
      outcome = {
        status: 'refused',
        reason: target.prepared.plan.reason,
      };
    } else if (target.prepared.plan.conflict && !options.overwrite) {
      outcome = {
        status: 'refused',
        reason: 'Installation already exists (conflict)',
      };
    } else {
      try {
        outcome = await applyInstall(target.prepared, options.homeRoot);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        outcome = {
          status: 'refused',
          reason: `Installation failed: ${msg}`,
        };
      }
    }

    results.push(toTargetOutcome(target, outcome));
  }

  return results;
}
