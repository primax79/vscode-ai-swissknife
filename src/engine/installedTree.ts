/**
 * @file installedTree.ts
 *
 * Object-to-places tree model for the unified Installed view (Task 40.1).
 *
 * ## Shared Artifact Identity Rule
 *
 * `getArtifactIdentity` in `src/engine/crossFrameworkLookup.ts` is strictly typed for
 * `ManagedInstallation`, which exposes direct `sourceId` and `artifactId` properties.
 * `ObservedArtifact` stores source provenance under `obs.match?.sourceId` and
 * `obs.match?.artifactId`.
 *
 * This file defines ONE shared helper `getArtifactIdentity` supporting both
 * `ManagedInstallation` and `ObservedArtifact` (as well as general objects with kind/name):
 * - If provenance is present (`sourceId && artifactId`, or `match?.sourceId && match?.artifactId`),
 *   it returns `prov:${sourceId}:${artifactId}`.
 * - Otherwise, it falls back to `name:${kind}:${name}`.
 *
 * To ensure managed and unmanaged instances of the same artifact join the same
 * parent object in the tree while artifacts of different kinds remain distinct,
 * `buildInstalledTree` keys objects by `(kind, name)`. Each resulting `InstalledObject`
 * exposes `kind`, `name`, and an `identity`: if any place provides provenance, `identity`
 * retains that `prov:...` identity; otherwise it uses `name:${kind}:${name}`.
 *
 * ## Severity Ordering
 *
 * In `tasks/40-dashboard-collapsible-objects/40.1-installed-tree-model.md`, the initial sketch
 * listed `missing-on-disk > modified-and-update > modified-locally > update-available > ...`.
 * However, the existing Dashboard implementation (`dashboard.ts:~2225-2232` and `~2425-2432`)
 * assigns `update-available: 3` and `modified-locally: 2`, prioritizing an available update
 * over a purely local modification.
 *
 * Following the task instruction ("adjust only if the existing severities map in
 * dashboard.ts says otherwise — reuse its ordering and note any difference"), the severity
 * table exported here preserves the Dashboard's relative ordering:
 * missing-on-disk > modified-and-update-available > update-available > modified-locally >
 * different > local-only > checking > identical > up-to-date.
 */

import type {
  AssistantId,
  ItemKind,
  ManagedInstallation,
  ObservedArtifact,
  ObservedSourceMatch,
  Scope,
} from '../domain/types';
import { ALL_ADAPTERS } from '../adapters/registry';

export type ManagedPlaceState =
  | 'checking'
  | 'up-to-date'
  | 'update-available'
  | 'modified-locally'
  | 'modified-and-update-available'
  | 'missing-on-disk'
  | 'disabled';

export type UnmanagedPlaceState =
  | 'identical'
  | 'different'
  | 'local-only'
  | 'disabled';

export type PlaceState = ManagedPlaceState | UnmanagedPlaceState;

export interface PlaceMatch {
  status: 'identical' | 'different' | 'none';
  sourceId?: string;
}

export interface Place {
  key: string;
  assistant: AssistantId;
  scope: Scope;
  membership: 'managed' | 'unmanaged';
  state: PlaceState;
  match?: PlaceMatch;
  disabled: boolean;
  sourceId?: string;
}

export interface InstalledObject {
  kind: ItemKind;
  name: string;
  identity: string;
  places: Place[];
  worstState: PlaceState;
}

export interface BuildInstalledTreeOptions {
  statusByKey?:
    | Map<string, PlaceState | string>
    | Record<string, PlaceState | string>;
}

/**
 * Severity ranking for worst-state derivation. Higher number means worse/more actionable state.
 */
export const STATE_SEVERITY: Readonly<Record<PlaceState, number>> = Object.freeze({
  'missing-on-disk': 9,
  'modified-and-update-available': 8,
  'update-available': 7,
  'modified-locally': 6,
  'different': 5,
  'local-only': 4,
  'checking': 3,
  'identical': 2,
  'up-to-date': 1,
  'disabled': 0,
});

export const SEVERITY_TABLE = STATE_SEVERITY;
export const STATE_SEVERITIES = STATE_SEVERITY;

/**
 * Compute the worst state from an array of place states using the severity table.
 */
export function computeWorstState(states: PlaceState[]): PlaceState {
  if (states.length === 0) {
    return 'up-to-date';
  }
  let worst = states[0];
  let worstSeverity = STATE_SEVERITY[worst] ?? -1;
  for (let i = 1; i < states.length; i++) {
    const s = states[i];
    const sev = STATE_SEVERITY[s] ?? -1;
    if (sev > worstSeverity) {
      worst = s;
      worstSeverity = sev;
    }
  }
  return worst;
}

/**
 * Helper to compute identity key matching src/ui/installedView.ts.
 */
export function getIdentityKey(item: {
  assistant: AssistantId;
  scope: Scope;
  kind: ItemKind;
  name: string;
  projectPath?: string;
}): string {
  return `${item.assistant}:${item.scope}:${item.kind}:${item.projectPath ?? ''}:${item.name}`;
}

/**
 * Shared helper to derive an artifact's identity string across managed and observed artifacts.
 */
export function getArtifactIdentity(
  item:
    | ManagedInstallation
    | ObservedArtifact
    | {
        kind: ItemKind;
        name: string;
        sourceId?: string;
        artifactId?: string;
        match?: ObservedSourceMatch;
      }
): string {
  if ('sourceId' in item && item.sourceId && 'artifactId' in item && item.artifactId) {
    return `prov:${item.sourceId}:${item.artifactId}`;
  }
  if ('match' in item && item.match?.sourceId && item.match?.artifactId) {
    return `prov:${item.match.sourceId}:${item.match.artifactId}`;
  }
  return `name:${item.kind}:${item.name}`;
}

function getAssistantOrder(assistant: AssistantId): number {
  const idx = ALL_ADAPTERS.findIndex((a) => a.assistant === assistant);
  return idx >= 0 ? idx : 999;
}

function getScopeOrder(scope: Scope): number {
  return scope === 'global' ? 0 : 1;
}

function comparePlaces(a: Place, b: Place): number {
  const diffAssistant = getAssistantOrder(a.assistant) - getAssistantOrder(b.assistant);
  if (diffAssistant !== 0) {
    return diffAssistant;
  }
  const diffScope = getScopeOrder(a.scope) - getScopeOrder(b.scope);
  if (diffScope !== 0) {
    return diffScope;
  }
  return a.key.localeCompare(b.key);
}

function lookupStatus(
  statusByKey:
    | Map<string, PlaceState | string>
    | Record<string, PlaceState | string>
    | undefined,
  key: string
): PlaceState | undefined {
  if (!statusByKey) {
    return undefined;
  }
  let raw: PlaceState | string | undefined;
  if (statusByKey instanceof Map) {
    raw = statusByKey.get(key);
  } else if (typeof statusByKey === 'object') {
    raw = statusByKey[key];
  }
  if (!raw) {
    return undefined;
  }
  if (raw === 'checking…') {
    return 'checking';
  }
  return raw as PlaceState;
}

interface ObjectAccumulator {
  kind: ItemKind;
  name: string;
  provenanceIdentity?: string;
  fallbackIdentity: string;
  places: Place[];
  placeMap: Map<string, Place>;
}

/**
 * Build the object-to-places tree from managed installations and observed artifacts.
 *
 * @param managed List of managed installations from on-disk state
 * @param observed List of observed unmanaged artifacts discovered on disk
 * @param opts Optional parameters (e.g. statusByKey for injecting drift statuses)
 * @returns Array of InstalledObject entries with sorted Place children and worstState
 */
export function buildInstalledTree(
  managed: ManagedInstallation[] = [],
  observed: ObservedArtifact[] = [],
  opts?: BuildInstalledTreeOptions
): InstalledObject[] {
  const objectMap = new Map<string, ObjectAccumulator>();

  // Process managed installations
  for (const inst of managed) {
    const groupKey = `${inst.kind}:${inst.name}`;
    let acc = objectMap.get(groupKey);
    if (!acc) {
      acc = {
        kind: inst.kind,
        name: inst.name,
        fallbackIdentity: `name:${inst.kind}:${inst.name}`,
        places: [],
        placeMap: new Map(),
      };
      objectMap.set(groupKey, acc);
    }

    if (!acc.provenanceIdentity && inst.sourceId && inst.artifactId) {
      acc.provenanceIdentity = `prov:${inst.sourceId}:${inst.artifactId}`;
    }

    const key = getIdentityKey(inst);
    const injected = lookupStatus(opts?.statusByKey, key);
    const disabled = Boolean(inst.disabled || injected === 'disabled');
    const state: PlaceState = disabled ? 'disabled' : (injected ?? 'checking');

    const place: Place = {
      key,
      assistant: inst.assistant,
      scope: inst.scope,
      membership: 'managed',
      state,
      disabled,
      sourceId: inst.sourceId,
    };

    if (!acc.placeMap.has(key)) {
      acc.placeMap.set(key, place);
      acc.places.push(place);
    } else {
      // If already present (e.g. duplicate), update place
      const idx = acc.places.findIndex((p) => p.key === key);
      if (idx >= 0) {
        acc.places[idx] = place;
      }
      acc.placeMap.set(key, place);
    }
  }

  // Process observed artifacts
  for (const obs of observed) {
    const groupKey = `${obs.kind}:${obs.name}`;
    let acc = objectMap.get(groupKey);
    if (!acc) {
      acc = {
        kind: obs.kind,
        name: obs.name,
        fallbackIdentity: `name:${obs.kind}:${obs.name}`,
        places: [],
        placeMap: new Map(),
      };
      objectMap.set(groupKey, acc);
    }

    if (!acc.provenanceIdentity && obs.match?.sourceId && obs.match?.artifactId) {
      acc.provenanceIdentity = `prov:${obs.match.sourceId}:${obs.match.artifactId}`;
    }

    const key = getIdentityKey(obs);

    // If already recorded as managed, do not let unmanaged overwrite managed place
    if (acc.placeMap.has(key)) {
      const existing = acc.placeMap.get(key)!;
      if (existing.membership === 'managed') {
        continue;
      }
    }

    const disabled = Boolean(obs.disabled);
    let state: PlaceState;
    if (disabled) {
      state = 'disabled';
    } else if (obs.match?.status === 'identical') {
      state = 'identical';
    } else if (obs.match?.status === 'different') {
      state = 'different';
    } else {
      state = 'local-only';
    }

    let match: PlaceMatch;
    if (obs.match?.status === 'identical') {
      match = { status: 'identical', sourceId: obs.match.sourceId };
    } else if (obs.match?.status === 'different') {
      match = { status: 'different', sourceId: obs.match.sourceId };
    } else {
      match = { status: 'none', sourceId: obs.match?.sourceId };
    }

    const place: Place = {
      key,
      assistant: obs.assistant,
      scope: obs.scope,
      membership: 'unmanaged',
      state,
      match,
      disabled,
      sourceId: obs.candidates?.[0]?.sourceId || obs.match?.sourceId,
    };

    if (!acc.placeMap.has(key)) {
      acc.placeMap.set(key, place);
      acc.places.push(place);
    } else {
      // If already present (e.g. duplicate), update place
      const idx = acc.places.findIndex((p) => p.key === key);
      if (idx >= 0) {
        acc.places[idx] = place;
      }
      acc.placeMap.set(key, place);
    }
  }

  const result: InstalledObject[] = [];
  for (const acc of objectMap.values()) {
    acc.places.sort(comparePlaces);
    const worstState = computeWorstState(acc.places.map((p) => p.state));
    result.push({
      kind: acc.kind,
      name: acc.name,
      identity: acc.provenanceIdentity ?? acc.fallbackIdentity,
      places: acc.places,
      worstState,
    });
  }

  return result;
}
