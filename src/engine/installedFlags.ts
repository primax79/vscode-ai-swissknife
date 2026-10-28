import * as fs from 'fs';
import * as path from 'path';
import type {
  AssistantId,
  ItemKind,
  InstallationSourceIdentity,
  InstalledFlag,
  ManagedInstallation,
  ObservedArtifact,
  Scope,
  Source,
} from '../domain/types';
import { readManifest } from '../domain/registry';
import { evaluateProvenanceCandidates } from './drift';

export type { InstalledFlag };

export const VALID_INSTALLED_FLAGS: readonly InstalledFlag[] = Object.freeze([
  'link',
  'copy',
  'broken-link',
  'orphan',
  'duplicate',
]);

const FLAG_ORDER: Record<InstalledFlag, number> = {
  copy: 1,
  link: 2,
  'broken-link': 3,
  orphan: 4,
  duplicate: 5,
};

export interface InstalledFlagsResult {
  flags: InstalledFlag[];
  linkTarget?: string;
  duplicateOf?: string[];
}

export interface FlaggedItemLike {
  key: string;
  path: string;
  assistant: AssistantId;
  scope: Scope;
  kind: ItemKind;
  name: string;
  membership?: 'managed' | 'observed' | 'unmanaged';
  source?: InstallationSourceIdentity;
  sourceId?: string;
  packageId?: string;
  artifactId?: string;
  contentHash?: string;
  provenance?: string;
  provenanceReason?: string;
  workspace?: string | null;
  match?:
    | 'identical'
    | 'different'
    | {
        status?: string;
        sourceId?: string;
        artifactId?: string;
        source?: InstallationSourceIdentity;
      };
  flags?: InstalledFlag[];
  linkTarget?: string;
  duplicateOf?: string[];
}

export interface ComputeInstalledFlagsOptions {
  homeRoot?: string;
  workspaceRoot?: string;
  sources?: Source[];
}

/**
 * Computes read-only flags for installed items:
 * - link: item path is a symlink (lstat), with linkTarget
 * - copy: item path is not a symlink (regular file/directory)
 * - broken-link: symlink whose target does not exist
 * - orphan: managed item whose artifact no longer exists in its registered source
 * - duplicate: same artifact installed in more than one place for the same assistant across scopes/roots
 */
export async function computeInstalledFlags<T extends FlaggedItemLike>(
  items: T[],
  options?: ComputeInstalledFlagsOptions
): Promise<Map<string, InstalledFlagsResult>> {
  const results = new Map<string, InstalledFlagsResult>();
  if (items.length === 0) {
    return results;
  }

  // 1. Gather all registered sources across scopes if not provided
  let allSources = options?.sources;
  if (!allSources) {
    const gatheredSources: Source[] = [];
    try {
      const gManifest = await readManifest('global', undefined, options?.homeRoot);
      gatheredSources.push(...gManifest.sources);
    } catch {
      // ignore
    }
    const workspaces = new Set<string>();
    if (options?.workspaceRoot) {
      workspaces.add(options.workspaceRoot);
    }
    for (const item of items) {
      if (item.workspace) {
        workspaces.add(item.workspace);
      }
    }
    for (const ws of workspaces) {
      try {
        const pManifest = await readManifest('project', ws, options?.homeRoot);
        gatheredSources.push(...pManifest.sources);
      } catch {
        // ignore
      }
    }
    allSources = gatheredSources;
  }

  const preResolved = new Map<string, any>();

  // 2. Compute link, copy, broken-link, and orphan per item
  for (const item of items) {
    const flags: InstalledFlag[] = [];
    let linkTarget: string | undefined;

    let isSymlink = false;
    let isBroken = false;
    let fileExists = false;

    try {
      const lst = await fs.promises.lstat(item.path);
      fileExists = true;
      if (lst.isSymbolicLink()) {
        isSymlink = true;
        try {
          const rawTarget = await fs.promises.readlink(item.path);
          linkTarget = path.isAbsolute(rawTarget)
            ? rawTarget
            : path.resolve(path.dirname(item.path), rawTarget);

          try {
            await fs.promises.stat(item.path);
          } catch (err: unknown) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
              isBroken = true;
            } else {
              try {
                await fs.promises.stat(linkTarget);
              } catch {
                isBroken = true;
              }
            }
          }
        } catch {
          isBroken = true;
        }
      }
    } catch {
      // Missing on disk
    }

    if (isSymlink) {
      flags.push('link');
      if (isBroken) {
        flags.push('broken-link');
      }
    } else if (fileExists) {
      flags.push('copy');
    }

    // Check orphan: managed item whose artifact no longer exists in its registered source
    const isManaged = item.membership === 'managed' || item.membership === undefined;
    if (isManaged) {
      if (item.provenanceReason === 'artifact-not-in-source') {
        flags.push('orphan');
      } else if (item.sourceId && allSources) {
        const hasSource = allSources.some((s) => s.id === item.sourceId);
        if (hasSource) {
          const inst: ManagedInstallation = {
            assistant: item.assistant,
            scope: item.scope,
            kind: item.kind,
            name: item.name,
            path: item.path,
            sourceId: item.sourceId,
            artifactId: item.artifactId ?? item.name,
            packageId: item.packageId ?? '',
            installedAt: '',
            contentHash: item.contentHash,
            source: item.source,
            provenance: item.provenance as any,
            provenanceReason: item.provenanceReason,
          };
          try {
            const evalResult = await evaluateProvenanceCandidates(inst, allSources, {
              homeRoot: options?.homeRoot,
              offline: true,
              preResolved,
            });
            if (evalResult.outcome === 'unknown' && evalResult.reason === 'artifact-not-in-source') {
              flags.push('orphan');
            }
          } catch {
            // ignore resolution errors
          }
        }
      }
    }

    results.set(item.key, {
      flags,
      ...(linkTarget ? { linkTarget } : {}),
    });
  }

  // 3. Compute duplicate across scopes/roots for the same assistant
  const byAssistant = new Map<AssistantId, T[]>();
  for (const item of items) {
    const list = byAssistant.get(item.assistant) ?? [];
    list.push(item);
    byAssistant.set(item.assistant, list);
  }

  for (const [_asst, asstItems] of byAssistant) {
    const groupMap = new Map<string, T[]>();

    for (const item of asstItems) {
      const isManaged = item.membership === 'managed' || item.membership === undefined;
      const artId = item.artifactId || item.name;

      if (isManaged) {
        let sourceIdentity = item.source?.location;
        if (!sourceIdentity && item.sourceId) {
          const found = allSources?.find((s) => s.id === item.sourceId);
          sourceIdentity =
            (found?.type === 'local-folder' ? found.localPath : found?.url) || item.sourceId;
        } else if (!sourceIdentity) {
          sourceIdentity = item.sourceId || item.source?.id || 'unknown';
        }
        const key = `managed:${sourceIdentity}:${item.kind}:${artId}`;
        const grp = groupMap.get(key) ?? [];
        grp.push(item);
        groupMap.set(key, grp);

        // Also index by contentHash if available
        if (item.contentHash) {
          const hashKey = `hash:${item.kind}:${item.contentHash}`;
          const hashGrp = groupMap.get(hashKey) ?? [];
          hashGrp.push(item);
          groupMap.set(hashKey, hashGrp);
        }
      } else {
        // Unmanaged: same content hash
        if (item.contentHash) {
          const hashKey = `hash:${item.kind}:${item.contentHash}`;
          const hashGrp = groupMap.get(hashKey) ?? [];
          hashGrp.push(item);
          groupMap.set(hashKey, hashGrp);
        }
        // If unmanaged matched a source
        if (
          item.match &&
          typeof item.match === 'object' &&
          item.match.sourceId &&
          item.match.artifactId
        ) {
          let sourceIdentity = item.match.source?.location;
          if (!sourceIdentity) {
            const found = allSources?.find((s) => s.id === (item.match as any).sourceId);
            sourceIdentity =
              (found?.type === 'local-folder' ? found.localPath : found?.url) ||
              item.match.sourceId;
          }
          const key = `managed:${sourceIdentity}:${item.kind}:${item.match.artifactId}`;
          const grp = groupMap.get(key) ?? [];
          grp.push(item);
          groupMap.set(key, grp);
        }
      }
    }

    // Mark duplicates for groups with more than 1 item
    for (const group of groupMap.values()) {
      if (group.length > 1) {
        for (const item of group) {
          const res = results.get(item.key);
          if (res) {
            if (!res.flags.includes('duplicate')) {
              res.flags.push('duplicate');
            }
            const others = group.filter((o) => o !== item).map((o) => o.key);
            const currentDuplicates = new Set(res.duplicateOf ?? []);
            for (const otherKey of others) {
              currentDuplicates.add(otherKey);
            }
            res.duplicateOf = Array.from(currentDuplicates).sort();
          }
        }
      }
    }
  }

  // Sort flags deterministically
  for (const res of results.values()) {
    res.flags.sort((a, b) => FLAG_ORDER[a] - FLAG_ORDER[b]);
  }

  return results;
}

/**
 * Attaches computed flags to an array of items and returns the items.
 */
export async function attachFlagsToItems<T extends FlaggedItemLike>(
  items: T[],
  options?: ComputeInstalledFlagsOptions
): Promise<T[]> {
  const flagsMap = await computeInstalledFlags(items, options);
  for (const item of items) {
    const res = flagsMap.get(item.key);
    if (res) {
      item.flags = res.flags;
      if (res.linkTarget) {
        item.linkTarget = res.linkTarget;
      }
      if (res.duplicateOf) {
        item.duplicateOf = res.duplicateOf;
      }
    } else {
      item.flags = [];
    }
  }
  return items;
}

/**
 * Attaches computed flags to managed installations and observed artifacts in-place.
 */
export async function attachFlagsToInventory(
  managed: ManagedInstallation[],
  observed: ObservedArtifact[],
  options?: ComputeInstalledFlagsOptions
): Promise<void> {
  const allItems: FlaggedItemLike[] = [];
  for (const m of managed) {
    const key = `${m.assistant}:${m.scope}:${m.kind}:${m.name}`;
    allItems.push({
      ...m,
      key,
      membership: 'managed',
      workspace: m.scope === 'global' ? null : m.projectPath,
    });
  }
  for (const o of observed) {
    const key = `${o.assistant}:${o.scope}:${o.kind}:${o.name}`;
    allItems.push({
      ...o,
      key,
      membership: 'observed',
      workspace: o.scope === 'global' ? null : o.projectPath,
    });
  }

  const flagsMap = await computeInstalledFlags(allItems, options);
  for (const m of managed) {
    const key = `${m.assistant}:${m.scope}:${m.kind}:${m.name}`;
    const res = flagsMap.get(key);
    if (res) {
      m.flags = res.flags;
      m.linkTarget = res.linkTarget;
      m.duplicateOf = res.duplicateOf;
    }
  }
  for (const o of observed) {
    const key = `${o.assistant}:${o.scope}:${o.kind}:${o.name}`;
    const res = flagsMap.get(key);
    if (res) {
      o.flags = res.flags;
      o.linkTarget = res.linkTarget;
      o.duplicateOf = res.duplicateOf;
    }
  }
}
