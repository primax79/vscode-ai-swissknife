import type { ManagedInstallation } from '../domain/types';

export type MatchStrategy = 'provenance' | 'name-fallback';

export interface RelatedInstallation {
  installation: ManagedInstallation;
  strategy: MatchStrategy;
}

function isSameInstallation(a: ManagedInstallation, b: ManagedInstallation): boolean {
  if (a === b) {
    return true;
  }
  return (
    a.assistant === b.assistant &&
    a.scope === b.scope &&
    a.name === b.name &&
    a.path === b.path
  );
}

export function findRelatedInstallations(
  target: ManagedInstallation,
  all: ManagedInstallation[]
): RelatedInstallation[] {
  const results: RelatedInstallation[] = [];
  const hasProvenance = Boolean(target.sourceId && target.artifactId);

  for (const inst of all) {
    if (isSameInstallation(inst, target)) {
      continue;
    }

    if (hasProvenance) {
      if (inst.sourceId === target.sourceId && inst.artifactId === target.artifactId) {
        results.push({
          installation: inst,
          strategy: 'provenance',
        });
      }
    } else {
      if (inst.name === target.name && inst.kind === target.kind) {
        results.push({
          installation: inst,
          strategy: 'name-fallback',
        });
      }
    }
  }

  return results;
}
