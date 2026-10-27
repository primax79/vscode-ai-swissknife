import type {
  AssistantId,
  ItemKind,
  ManagedInstallation,
  ObservedArtifact,
  ObservedSourceMatch,
  Scope,
  Source,
} from '../domain/types';
import type { Adapter, LocationRef } from '../adapters/types';
import { getAdapter, getAdapterWithHomeRoot, getEnabledAdapters } from '../adapters/registry';
import { translateSkill } from '../translator/skill';
import { translateAgent } from '../translator/agent';
import { translateCommand } from '../translator/command';
import { translateMcpServer } from '../translator/mcp';
import { translateHook } from '../translator/hook';
import { translateRule } from '../translator/rule';
import { getIdentityKey, type InstalledObject, type Place } from './installedTree';

export type OriginResolution =
  | { kind: 'source'; sourceId: string; artifactId: string; scope: Scope }
  | { kind: 'candidates'; candidates: ObservedSourceMatch[] }
  | { kind: 'local'; place: Place };

export interface MissingPlaceOffered {
  assistant: AssistantId;
  scope: Scope;
}

export interface MissingPlaceUnsupported {
  assistant: AssistantId;
  scope: Scope;
  reason: string;
}

export interface ComputeMissingPlacesResult {
  offered: MissingPlaceOffered[];
  unsupported: MissingPlaceUnsupported[];
}

export interface ComputeMissingPlacesParams {
  placesOfObject?: Place[] | InstalledObject;
  places?: Place[];
  enabledAssistants?: Array<AssistantId | Adapter>;
  workspaceOpen?: boolean;
  kind?: ItemKind;
  projectRoot?: string;
  homeRoot?: string;
  adapters?: Adapter[];
}

export interface InstallCapabilityResult {
  supported: boolean;
  reason?: string;
}

function findManaged(place: Place, managed: ManagedInstallation[]): ManagedInstallation | undefined {
  const exact = managed.find((m) => getIdentityKey(m) === place.key);
  if (exact) {
    return exact;
  }
  const byNameAndPlace = managed.find(
    (m) =>
      m.assistant === place.assistant &&
      m.scope === place.scope &&
      (m.name === place.key ||
        place.key.endsWith(`:${m.name}`) ||
        (place as unknown as { name?: string }).name === m.name)
  );
  if (byNameAndPlace) {
    return byNameAndPlace;
  }
  const byPlace = managed.filter((m) => m.assistant === place.assistant && m.scope === place.scope);
  if (byPlace.length === 1) {
    return byPlace[0];
  }
  return undefined;
}

function findObserved(place: Place, observed: ObservedArtifact[]): ObservedArtifact | undefined {
  const exact = observed.find((o) => getIdentityKey(o) === place.key);
  if (exact) {
    return exact;
  }
  const byNameAndPlace = observed.find(
    (o) =>
      o.assistant === place.assistant &&
      o.scope === place.scope &&
      (o.name === place.key ||
        place.key.endsWith(`:${o.name}`) ||
        (place as unknown as { name?: string }).name === o.name)
  );
  if (byNameAndPlace) {
    return byNameAndPlace;
  }
  const byPlace = observed.filter((o) => o.assistant === place.assistant && o.scope === place.scope);
  if (byPlace.length === 1) {
    return byPlace[0];
  }
  return undefined;
}

/**
 * Resolves the source origin of an installed or observed place.
 *
 * Rules:
 * - managed place -> its recorded source: `{ kind: 'source', sourceId, artifactId, scope }`
 * - unmanaged with 1 candidate -> `{ kind: 'source', sourceId, artifactId, scope }`
 * - unmanaged with multiple candidates -> `{ kind: 'candidates', candidates }`
 * - unmanaged with 0 candidates (or no recorded source) -> `{ kind: 'local', place }`
 */
export function resolveOrigin(
  place: Place,
  managed: ManagedInstallation[],
  observed: ObservedArtifact[],
  sources?: Array<Source | { id: string; scope: Scope }>
): OriginResolution {
  if (place.membership === 'managed') {
    const inst = findManaged(place, managed);
    if (inst && inst.sourceId && inst.artifactId) {
      let sourceScope: Scope = inst.scope ?? place.scope;
      if (sources && sources.length > 0) {
        const foundSource = sources.find((s) => s.id === inst.sourceId);
        if (foundSource) {
          sourceScope = foundSource.scope;
        }
      } else if ((inst as unknown as { sourceScope?: Scope }).sourceScope) {
        sourceScope = (inst as unknown as { sourceScope: Scope }).sourceScope;
      }
      return {
        kind: 'source',
        sourceId: inst.sourceId,
        artifactId: inst.artifactId,
        scope: sourceScope,
      };
    }
    return { kind: 'local', place };
  }

  if (place.membership === 'unmanaged') {
    const obs = findObserved(place, observed);
    if (obs) {
      let candidateList: ObservedSourceMatch[] = [];
      if (Array.isArray(obs.candidates)) {
        candidateList = obs.candidates;
      } else if (
        obs.match &&
        obs.match.status !== 'unmatched' &&
        obs.match.sourceId &&
        obs.match.artifactId
      ) {
        candidateList = [obs.match];
      }

      const validCandidates = candidateList.filter(
        (c) => Boolean(c.sourceId && c.artifactId && c.status !== 'unmatched')
      );

      if (validCandidates.length === 1) {
        const cand = validCandidates[0];
        let sourceScope: Scope = obs.scope ?? place.scope;
        if (sources && sources.length > 0) {
          const foundSource = sources.find((s) => s.id === cand.sourceId);
          if (foundSource) {
            sourceScope = foundSource.scope;
          }
        } else if ((cand as unknown as { scope?: Scope }).scope) {
          sourceScope = (cand as unknown as { scope: Scope }).scope;
        }
        return {
          kind: 'source',
          sourceId: cand.sourceId!,
          artifactId: cand.artifactId!,
          scope: sourceScope,
        };
      }

      if (validCandidates.length > 1) {
        return {
          kind: 'candidates',
          candidates: validCandidates,
        };
      }
    }
    return { kind: 'local', place };
  }

  // Fallback if place.membership is unspecified or mixed
  const inst = findManaged(place, managed);
  if (inst && inst.sourceId && inst.artifactId) {
    let sourceScope: Scope = inst.scope ?? place.scope;
    if (sources && sources.length > 0) {
      const foundSource = sources.find((s) => s.id === inst.sourceId);
      if (foundSource) {
        sourceScope = foundSource.scope;
      }
    }
    return {
      kind: 'source',
      sourceId: inst.sourceId,
      artifactId: inst.artifactId,
      scope: sourceScope,
    };
  }

  const obs = findObserved(place, observed);
  if (obs) {
    const candidateList = Array.isArray(obs.candidates)
      ? obs.candidates
      : obs.match && obs.match.status !== 'unmatched' && obs.match.sourceId && obs.match.artifactId
      ? [obs.match]
      : [];
    const validCandidates = candidateList.filter(
      (c) => Boolean(c.sourceId && c.artifactId && c.status !== 'unmatched')
    );
    if (validCandidates.length === 1) {
      return {
        kind: 'source',
        sourceId: validCandidates[0].sourceId!,
        artifactId: validCandidates[0].artifactId!,
        scope: obs.scope ?? place.scope,
      };
    }
    if (validCandidates.length > 1) {
      return {
        kind: 'candidates',
        candidates: validCandidates,
      };
    }
  }

  return { kind: 'local', place };
}

/**
 * Checks whether the given adapter supports installing the specified item kind at the given scope,
 * reusing the same rules and diagnostic messages as planInstall without writing anything to disk.
 */
export function checkInstallCapability(
  adapter: Adapter,
  kind: ItemKind,
  scope: Scope,
  projectRoot?: string
): InstallCapabilityResult {
  if (
    kind !== 'skill' &&
    kind !== 'agent' &&
    kind !== 'command' &&
    kind !== 'mcp-server' &&
    kind !== 'hook' &&
    kind !== 'rule'
  ) {
    return {
      supported: false,
      reason: `Artifact kind "${kind}" is not supported`,
    };
  }

  // Adapter custom override (e.g. for mock adapters in tests)
  if (typeof (adapter as unknown as { canInstall?: unknown }).canInstall === 'function') {
    const custom = (adapter as unknown as { canInstall: (k: ItemKind, s: Scope) => unknown }).canInstall(
      kind,
      scope
    );
    if (custom === false) {
      return {
        supported: false,
        reason: `Target adapter for "${adapter.assistant}" does not support ${kind} installation`,
      };
    }
    if (typeof custom === 'object' && custom && !(custom as { supported: boolean }).supported) {
      return {
        supported: false,
        reason:
          (custom as { reason?: string }).reason ??
          `Target adapter for "${adapter.assistant}" does not support ${kind} installation`,
      };
    }
  }

  const loc: LocationRef = {
    scope,
    ...(scope === 'project' ? { projectRoot: projectRoot ?? '/workspace' } : {}),
  };

  if (kind === 'rule') {
    const tr = translateRule({ content: '' }, adapter.assistant);
    if (tr.overall === 'unsupported') {
      return {
        supported: false,
        reason: `Target assistant "${adapter.assistant}" is not supported for rules`,
      };
    }
    if (!adapter.rulePath) {
      return {
        supported: false,
        reason: `Target adapter for "${adapter.assistant}" does not support rule installation`,
      };
    }
    try {
      adapter.rulePath(loc);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { supported: false, reason: msg };
    }
    return { supported: true };
  }

  if (kind === 'hook') {
    const tr = translateHook(
      { name: 'test', event: 'PreToolUse', command: 'test', extraFields: {} },
      adapter.assistant
    );
    if (tr.overall === 'unsupported') {
      return {
        supported: false,
        reason: `Target assistant "${adapter.assistant}" is not supported for hooks`,
      };
    }
    if (!adapter.hookPath) {
      return {
        supported: false,
        reason: `Target adapter for "${adapter.assistant}" does not support hook installation`,
      };
    }
    try {
      adapter.hookPath('test', loc);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { supported: false, reason: msg };
    }
    return { supported: true };
  }

  if (kind === 'mcp-server') {
    const tr = translateMcpServer(
      { id: 'test', type: 'stdio', extraFields: {} },
      adapter.assistant
    );
    if (tr.overall === 'unsupported') {
      return {
        supported: false,
        reason: `Target assistant "${adapter.assistant}" is not supported for MCP servers`,
      };
    }
    if (!adapter.mcpConfigPath) {
      return {
        supported: false,
        reason: `Target adapter for "${adapter.assistant}" does not support MCP installation`,
      };
    }
    try {
      adapter.mcpConfigPath(loc);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { supported: false, reason: msg };
    }
    return { supported: true };
  }

  if (kind === 'command') {
    const tr = translateCommand(
      { name: 'test', description: '', body: '', extraFields: {} },
      adapter.assistant
    );
    if (tr.overall === 'unsupported') {
      return {
        supported: false,
        reason: `Target assistant "${adapter.assistant}" is not supported for commands`,
      };
    }
    if (!adapter.commandPath) {
      return {
        supported: false,
        reason: `Target adapter for "${adapter.assistant}" does not support command installation`,
      };
    }
    try {
      adapter.commandPath('test', loc);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { supported: false, reason: msg };
    }
    return { supported: true };
  }

  if (kind === 'agent') {
    const tr = translateAgent(
      { name: 'test', description: '', tools: [], permissions: {}, body: '', extraFields: {} },
      adapter.assistant
    );
    if (tr.overall === 'unsupported') {
      return {
        supported: false,
        reason: `Target assistant "${adapter.assistant}" is not supported for agents`,
      };
    }
    if (!adapter.agentPath) {
      return {
        supported: false,
        reason: `Target adapter for "${adapter.assistant}" does not support agent installation`,
      };
    }
    try {
      adapter.agentPath('test', loc);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { supported: false, reason: msg };
    }
    return { supported: true };
  }

  if (kind === 'skill') {
    const tr = translateSkill(
      { name: 'test', description: '', body: '', extraFields: {}, files: [] },
      adapter.assistant
    );
    if (tr.overall === 'unsupported') {
      return {
        supported: false,
        reason: `Target assistant "${adapter.assistant}" is not supported in Phase 1`,
      };
    }
    if (!adapter.skillDir) {
      return {
        supported: false,
        reason: `Target adapter for "${adapter.assistant}" does not support skill installation`,
      };
    }
    try {
      adapter.skillDir('test', loc);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        supported: false,
        reason: `Failed to resolve target directory: ${msg}`,
      };
    }
    return { supported: true };
  }

  return { supported: true };
}

/**
 * Computes missing places for an object:
 * Full grid of enabled-assistants × {global, project} MINUS the object's existing places.
 * - Same identity, any membership.
 * - Disabled places COUNT AS PRESENT (never offered, never in unsupported).
 * - Project entries are omitted when workspaceOpen is false.
 * - Places that the adapter cannot support are placed in `unsupported` with the reason.
 */
export function computeMissingPlaces(
  params: ComputeMissingPlacesParams
): ComputeMissingPlacesResult {
  let places: Place[] = [];
  if (Array.isArray(params.placesOfObject)) {
    places = params.placesOfObject;
  } else if (
    params.placesOfObject &&
    typeof params.placesOfObject === 'object' &&
    Array.isArray((params.placesOfObject as InstalledObject).places)
  ) {
    places = (params.placesOfObject as InstalledObject).places;
  } else if (Array.isArray(params.places)) {
    places = params.places;
  }

  const existingSet = new Set<string>();
  for (const p of places) {
    existingSet.add(`${p.assistant}:${p.scope}`);
  }

  let effectiveKind: ItemKind | undefined = params.kind;
  if (!effectiveKind && params.placesOfObject && !Array.isArray(params.placesOfObject)) {
    effectiveKind = (params.placesOfObject as InstalledObject).kind;
  }
  if (!effectiveKind && places.length > 0) {
    for (const p of places) {
      const parts = p.key.split(':');
      if (
        parts.length >= 3 &&
        ['skill', 'agent', 'command', 'mcp-server', 'hook', 'rule'].includes(parts[2])
      ) {
        effectiveKind = parts[2] as ItemKind;
        break;
      }
    }
  }
  if (!effectiveKind) {
    effectiveKind = 'skill';
  }

  const adapterMap = new Map<AssistantId, Adapter>();
  const assistantIds: AssistantId[] = [];

  if (params.enabledAssistants && params.enabledAssistants.length > 0) {
    for (const entry of params.enabledAssistants) {
      if (typeof entry === 'string') {
        assistantIds.push(entry);
      } else {
        assistantIds.push(entry.assistant);
        adapterMap.set(entry.assistant, entry);
      }
    }
  } else {
    const enabled = getEnabledAdapters();
    for (const a of enabled) {
      assistantIds.push(a.assistant);
      adapterMap.set(a.assistant, a);
    }
  }

  if (params.adapters) {
    for (const a of params.adapters) {
      adapterMap.set(a.assistant, a);
    }
  }

  const uniqueAssistantIds = Array.from(new Set(assistantIds));
  const scopes: Scope[] = params.workspaceOpen ? ['global', 'project'] : ['global'];

  const offered: MissingPlaceOffered[] = [];
  const unsupported: MissingPlaceUnsupported[] = [];

  for (const assistant of uniqueAssistantIds) {
    for (const scope of scopes) {
      const key = `${assistant}:${scope}`;
      if (existingSet.has(key)) {
        continue;
      }

      let adapter = adapterMap.get(assistant);
      if (!adapter) {
        try {
          adapter = params.homeRoot
            ? getAdapterWithHomeRoot(assistant, params.homeRoot)
            : getAdapter(assistant);
        } catch {
          unsupported.push({
            assistant,
            scope,
            reason: `Target assistant "${assistant}" is not supported`,
          });
          continue;
        }
      }

      const cap = checkInstallCapability(adapter, effectiveKind, scope, params.projectRoot);
      if (!cap.supported) {
        unsupported.push({
          assistant,
          scope,
          reason:
            cap.reason ?? `Target assistant "${assistant}" does not support ${effectiveKind}`,
        });
      } else {
        offered.push({
          assistant,
          scope,
        });
      }
    }
  }

  return { offered, unsupported };
}
