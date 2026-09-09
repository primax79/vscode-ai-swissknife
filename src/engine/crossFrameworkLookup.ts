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


export function getArtifactIdentity(inst: ManagedInstallation): string {
  if (inst.sourceId && inst.artifactId) {
    return `prov:${inst.sourceId}:${inst.artifactId}`;
  }
  return `name:${inst.kind}:${inst.name}`;
}

export interface InstallationGroup {
  identityKey: string;
  scope: import('../domain/types').Scope;
  kind: import('../domain/types').ItemKind;
  name: string;
  installations: ManagedInstallation[];
}

export function groupByIdentityAndScope(all: ManagedInstallation[]): InstallationGroup[] {
  const groups = new Map<string, InstallationGroup>();
  for (const inst of all) {
    const identity = getArtifactIdentity(inst);
    const key = `${identity}|${inst.scope}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        identityKey: key,
        scope: inst.scope,
        kind: inst.kind,
        name: inst.name,
        installations: []
      };
      groups.set(key, group);
    }
    group.installations.push(inst);
  }
  return Array.from(groups.values());
}
