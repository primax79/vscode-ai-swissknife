import * as fs from 'fs';
import * as path from 'path';
import {
  toInstallationSourceIdentity,
  type ManagedInstallation,
  type ResolvedRevision,
  type Source,
  type Package,
  type Artifact,
} from '../domain/types';
import type {
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
  readSkill,
} from '../adapters/codec';
import { parseClaudeAgentMarkdown, parseClaudeCommandMarkdown } from '../adapters/claude';
import { parseKiloAgentMarkdown, parseKiloCommandMarkdown } from '../adapters/kilo';
import { getAdapter, getAdapterWithHomeRoot } from '../adapters/registry';
import { getSourceResolver } from '../sources/registry';
import { isUntrackedArtifactError } from '../sources/localFolder';
import { resolveAndTranslate } from './plan';
import { describeRevisionGap } from './revisionGap';
import type { DriftReport } from './types';
import type { SourceResolution } from '../sources/types';

export interface SourceLookupLists {
  globalSources: Source[];
  workspaceSources: Source[];
}

export type SourceLookupInput =
  | SourceLookupLists
  | Source[]
  | ReadonlyMap<string, Source>
  | Map<string, Source>;

export type ResolvedInstallationSource =
  | { source: Source }
  | { unavailable: string; hint?: string; provenanceUnknown?: boolean };

export type ProvenanceUnknownReason =
  | 'no-source-id'
  | 'no-content-hash'
  | 'source-not-in-manifest'
  | 'needs-fetch'
  | 'artifact-not-in-source'
  | 'hash-mismatch'
  | 'ambiguous-sources-hash-mismatch'
  | 'ambiguous-multiple-matches';

export interface ProvenanceCandidateMatch {
  source: Source;
  pkg: Package;
  artifact: Artifact;
  sourceHash: string;
  revision?: ResolvedRevision;
}

export type ProvenanceEvaluationResult =
  | {
      outcome: 'adopted';
      match: ProvenanceCandidateMatch;
    }
  | {
      outcome: 'unknown';
      reason: ProvenanceUnknownReason;
      hint?: string;
      details: string;
    };

type ProvenanceResolvedCallback = (
  inst: ManagedInstallation,
  homeRoot?: string
) => Promise<void>;

let _onProvenanceResolved: ProvenanceResolvedCallback | undefined;

export function setProvenanceResolvedCallback(
  cb: ProvenanceResolvedCallback | undefined
): void {
  _onProvenanceResolved = cb;
}

function normalizeSourceLists(sources: SourceLookupInput): SourceLookupLists {
  if (
    sources &&
    typeof sources === 'object' &&
    !Array.isArray(sources) &&
    'globalSources' in sources &&
    'workspaceSources' in sources
  ) {
    return {
      globalSources: sources.globalSources,
      workspaceSources: sources.workspaceSources,
    };
  }
  const all: Source[] = Array.isArray(sources)
    ? sources
    : sources && typeof (sources as Map<string, Source>).values === 'function'
    ? Array.from((sources as Map<string, Source>).values())
    : [];
  return {
    globalSources: all.filter((s) => s.scope === 'global'),
    workspaceSources: all.filter((s) => s.scope === 'project'),
  };
}

function getSourceLocation(source: Source): string {
  return toInstallationSourceIdentity(source).location;
}

function locationsMatch(source: Source, recordedLocation: string): boolean {
  if (!recordedLocation) return true;
  const currentLocation = getSourceLocation(source);
  if (currentLocation === recordedLocation) return true;
  if (source.type === 'local-folder' && currentLocation && recordedLocation) {
    return path.resolve(currentLocation) === path.resolve(recordedLocation);
  }
  return false;
}

/**
 * Resolves the upstream source for a ManagedInstallation according to spec §3 rule 1:
 * - When `installation.source` is recorded: match by `source.scope` + `source.id`, verify `type` and `location`.
 *   If missing from its scope, returns `{ unavailable, hint? }` (with a hint if a same-id source exists in the other scope).
 * - For legacy installations without `installation.source`: prefers the source in the installation's own scope
 *   (global installs -> globalSources, project installs -> workspaceSources), falling back to the other scope if unique.
 */
export function resolveInstallationSource(
  installation: ManagedInstallation,
  sources: SourceLookupInput
): ResolvedInstallationSource {
  const { globalSources, workspaceSources } = normalizeSourceLists(sources);

  if (installation.source) {
    const rec = installation.source;
    const isGlobal = rec.scope === 'global';
    const targetList = isGlobal ? globalSources : workspaceSources;
    const otherList = isGlobal ? workspaceSources : globalSources;
    const scopeName = isGlobal ? 'global' : 'workspace';
    const otherScopeName = isGlobal ? 'workspace' : 'global';

    const match = targetList.find((s) => s.id === rec.id);
    if (!match) {
      const otherMatch = otherList.find((s) => s.id === rec.id);
      const hint = otherMatch
        ? `A source with id "${rec.id}" (${otherMatch.type}) exists in ${otherScopeName} scope (re-link to ${otherScopeName} "${rec.id}").`
        : undefined;
      return {
        unavailable: `Source "${rec.id}" not found in ${scopeName} manifest.`,
        ...(hint ? { hint } : {}),
      };
    }

    if (match.type !== rec.type) {
      return {
        unavailable: `Source "${rec.id}" in ${scopeName} scope changed type from "${rec.type}" to "${match.type}".`,
      };
    }

    if (!locationsMatch(match, rec.location)) {
      const currentLoc = getSourceLocation(match);
      return {
        unavailable: `Source "${rec.id}" in ${scopeName} scope changed location from "${rec.location}" to "${currentLoc}".`,
      };
    }

    return { source: match };
  }

  if (installation.provenance === 'unknown') {
    const hint = installation.provenanceHint;
    return {
      unavailable: hint
        ? `Provenance unknown for "${installation.name}": ${hint}`
        : `Provenance unknown for "${installation.name}" — re-link to a source or reinstall.`,
      ...(hint ? { hint } : {}),
      provenanceUnknown: true,
    };
  }

  const sourceId = installation.sourceId;
  if (!sourceId) {
    return {
      unavailable: `No source ID recorded for "${installation.name}".`,
    };
  }

  const allMatching = [...globalSources, ...workspaceSources].filter((s) => s.id === sourceId);
  if (allMatching.length > 1) {
    return {
      unavailable: `Multiple registered sources match id "${sourceId}" for "${installation.name}" — provenance unknown; re-link to a source or reinstall.`,
      provenanceUnknown: true,
    };
  }

  const preferredList = installation.scope === 'global' ? globalSources : workspaceSources;
  const fallbackList = installation.scope === 'global' ? workspaceSources : globalSources;

  const preferredMatch = preferredList.find((s) => s.id === sourceId);
  if (preferredMatch) {
    return { source: preferredMatch };
  }

  const fallbackMatch = fallbackList.find((s) => s.id === sourceId);
  if (fallbackMatch) {
    return { source: fallbackMatch };
  }

  return {
    unavailable: `Source "${sourceId}" not found in manifest.`,
  };
}

export type MatchedInstallationArtifact =
  | {
      matched: true;
      pkg: Package;
      artifact: Artifact;
      convertedFromId?: string;
      conversionNote?: string;
    }
  | {
      matched: false;
      reason: string;
      hint?: string;
    };

/**
 * Deterministically converts an installation's recorded `artifactId` across source id-shapes
 * (e.g. `local-folder` / `git-custom` / fallback `git-marketplace` path-based ids vs `git-marketplace` plugin-manifest ids)
 * when and only when the conversion preserves the exact same sourceId, plugin, kind, and artifact name.
 */
function findDeterministicIdShapeMatch(
  installation: ManagedInstallation,
  source: Source,
  packages: Package[]
): { pkg: Package; artifact: Artifact; note: string } | undefined {
  const rawId = installation.artifactId;
  if (!rawId) return undefined;

  const prefix = `${source.id}:`;
  if (!rawId.startsWith(prefix)) return undefined;
  const rest = rawId.slice(prefix.length);

  const kindSegment = installation.kind === 'mcp-server' ? 'mcp' : installation.kind;
  const candidateIds = new Set<string>();

  // Direction A: path-based id (local-folder / git-custom / marketplace fallback) -> git-marketplace manifest id
  // e.g. `<sourceId>:plugins/<plugin>/skills/<name>:<name>` -> `<sourceId>:<plugin>:skill:<name>`
  //      `<sourceId>:plugins/<plugin>/agents/<name>.md:<name>` -> `<sourceId>:<plugin>:agent:<name>`
  //      `<sourceId>:plugins/<plugin>/commands/<name>.md:<name>` -> `<sourceId>:<plugin>:command:<name>`
  //      `<sourceId>:plugins/<plugin>/(.)mcp.json:<name>:<name>` -> `<sourceId>:<plugin>:mcp:<name>`
  const skillPathMatch = rest.match(/^(?:(?:plugins\/)?([^/:]+)\/)?skills\/([^/:]+):\2$/);
  if (skillPathMatch && installation.kind === 'skill' && skillPathMatch[2] === installation.name) {
    const [, pluginName, skillName] = skillPathMatch;
    if (pluginName) {
      candidateIds.add(`${source.id}:${pluginName}:skill:${skillName}`);
    }
    candidateIds.add(`${source.id}:${skillName}:${skillName}`);
    candidateIds.add(`${source.id}:skills/${skillName}:${skillName}`);
  }

  const skillBareMatch = rest.match(/^([^/:]+):\1$/);
  if (skillBareMatch && installation.kind === 'skill' && skillBareMatch[1] === installation.name) {
    const skillName = skillBareMatch[1];
    candidateIds.add(`${source.id}:skills/${skillName}:${skillName}`);
  }

  const agentPathMatch = rest.match(/^(?:(?:plugins\/)?([^/:]+)\/)?(?:agents?\/)?([^/:]+?)(?:\.agent)?\.md:([^/:]+)$/);
  if (agentPathMatch && installation.kind === 'agent' && agentPathMatch[3] === installation.name) {
    const [, pluginName, , agentName] = agentPathMatch;
    if (pluginName) {
      candidateIds.add(`${source.id}:${pluginName}:agent:${agentName}`);
    } else {
      candidateIds.add(`${source.id}:agents/${agentName}.md:${agentName}`);
      candidateIds.add(`${source.id}:${agentName}.md:${agentName}`);
    }
    candidateIds.add(`${source.id}:${agentName}:${agentName}`);
  }

  const agentBareMatch = rest.match(/^([^/:]+):\1$/);
  if (agentBareMatch && installation.kind === 'agent' && agentBareMatch[1] === installation.name) {
    const agentName = agentBareMatch[1];
    candidateIds.add(`${source.id}:agents/${agentName}.md:${agentName}`);
    candidateIds.add(`${source.id}:${agentName}.md:${agentName}`);
  }

  const cmdPathMatch = rest.match(/^(?:(?:plugins\/)?([^/:]+)\/)?(?:commands?\/)?([^/:]+?)(?:\.command)?\.md:([^/:]+)$/);
  if (cmdPathMatch && installation.kind === 'command' && cmdPathMatch[3] === installation.name) {
    const [, pluginName, , cmdName] = cmdPathMatch;
    if (pluginName) {
      candidateIds.add(`${source.id}:${pluginName}:command:${cmdName}`);
    } else {
      candidateIds.add(`${source.id}:commands/${cmdName}.md:${cmdName}`);
      candidateIds.add(`${source.id}:command/${cmdName}.md:${cmdName}`);
      candidateIds.add(`${source.id}:${cmdName}.md:${cmdName}`);
    }
    candidateIds.add(`${source.id}:${cmdName}:${cmdName}`);
  }

  const cmdBareMatch = rest.match(/^([^/:]+):\1$/);
  if (cmdBareMatch && installation.kind === 'command' && cmdBareMatch[1] === installation.name) {
    const cmdName = cmdBareMatch[1];
    candidateIds.add(`${source.id}:commands/${cmdName}.md:${cmdName}`);
    candidateIds.add(`${source.id}:command/${cmdName}.md:${cmdName}`);
    candidateIds.add(`${source.id}:${cmdName}.md:${cmdName}`);
  }

  const hookBareMatch = rest.match(/^([^/:]+):\1$/);
  if (hookBareMatch && installation.kind === 'hook' && hookBareMatch[1] === installation.name) {
    const hookName = hookBareMatch[1];
    candidateIds.add(`${source.id}:hooks/${hookName}.json:${hookName}`);
    candidateIds.add(`${source.id}:${hookName}.json:${hookName}`);
  }

  const ruleBareMatch = rest.match(/^([^/:]+):\1$/);
  if (ruleBareMatch && installation.kind === 'rule' && ruleBareMatch[1] === installation.name) {
    const ruleName = ruleBareMatch[1];
    candidateIds.add(`${source.id}:rules/${ruleName}.md:${ruleName}`);
    candidateIds.add(`${source.id}:${ruleName}.md:${ruleName}`);
  }

  const mcpPathMatch = rest.match(/^(?:plugins\/)?([^/:]+)\/(?:\.?mcp\.json|mcps\/[^/:]+\.json):([^/:]+):\2$/);
  if (mcpPathMatch && installation.kind === 'mcp-server' && mcpPathMatch[2] === installation.name) {
    const [, pluginName, mcpId] = mcpPathMatch;
    candidateIds.add(`${source.id}:${pluginName}:mcp:${mcpId}`);
  }

  // Direction B: git-marketplace manifest id -> path-based id (local-folder / git-custom / marketplace fallback)
  // e.g. `<sourceId>:<plugin>:<kindSegment>:<name>` -> `<sourceId>:plugins/<plugin>/skills/<name>:<name>` (or `<plugin>/skills/<name>:<name>`)
  const mktMatch = rest.match(/^([^/:]+):(skill|agent|command|mcp):([^/:]+)$/);
  if (mktMatch && mktMatch[2] === kindSegment && mktMatch[3] === installation.name) {
    const [, pluginName, , artName] = mktMatch;
    if (installation.kind === 'skill') {
      candidateIds.add(`${source.id}:plugins/${pluginName}/skills/${artName}:${artName}`);
      candidateIds.add(`${source.id}:${pluginName}/skills/${artName}:${artName}`);
      candidateIds.add(`${source.id}:skills/${artName}:${artName}`);
      candidateIds.add(`${source.id}:${artName}:${artName}`);
    } else if (installation.kind === 'agent') {
      candidateIds.add(`${source.id}:plugins/${pluginName}/agents/${artName}.md:${artName}`);
      candidateIds.add(`${source.id}:${pluginName}/agents/${artName}.md:${artName}`);
      candidateIds.add(`${source.id}:agents/${artName}.md:${artName}`);
      candidateIds.add(`${source.id}:${artName}:${artName}`);
    } else if (installation.kind === 'command') {
      candidateIds.add(`${source.id}:plugins/${pluginName}/commands/${artName}.md:${artName}`);
      candidateIds.add(`${source.id}:${pluginName}/commands/${artName}.md:${artName}`);
      candidateIds.add(`${source.id}:commands/${artName}.md:${artName}`);
      candidateIds.add(`${source.id}:${artName}:${artName}`);
    } else if (installation.kind === 'mcp-server') {
      candidateIds.add(`${source.id}:plugins/${pluginName}/mcp.json:${artName}:${artName}`);
      candidateIds.add(`${source.id}:plugins/${pluginName}/.mcp.json:${artName}:${artName}`);
      candidateIds.add(`${source.id}:${pluginName}/mcp.json:${artName}:${artName}`);
      candidateIds.add(`${source.id}:${pluginName}/.mcp.json:${artName}:${artName}`);
    }
  }

  if (candidateIds.size === 0) return undefined;

  const hits: Array<{ pkg: Package; artifact: Artifact }> = [];
  for (const pkg of packages) {
    for (const art of pkg.artifacts) {
      if (
        candidateIds.has(art.id) &&
        art.kind === installation.kind &&
        art.name === installation.name
      ) {
        hits.push({ pkg, artifact: art });
      }
    }
  }

  if (hits.length === 1) {
    const hit = hits[0];
    return {
      pkg: hit.pkg,
      artifact: hit.artifact,
      note: `matched via deterministic id-shape conversion (${rawId} -> ${hit.artifact.id})`,
    };
  }

  return undefined;
}

/**
 * Matches an installed item to its upstream artifact in `resolution` (spec §3 rule 5):
 * - Matches strictly by exact `installation.artifactId` (or deterministic id-shape conversion
 *   preserving sourceId, plugin, kind, and name).
 * - Never falls back to `kind && name` across plugins/packages.
 * - When not found, returns `matched: false` with reason `"artifact <id> no longer in source"`
 *   and, if an artifact with the same `kind + name` exists, a hint `"same name found: <its id>"`.
 */
export function matchInstallationArtifact(
  installation: ManagedInstallation,
  source: Source,
  resolution: SourceResolution
): MatchedInstallationArtifact {
  const recordedId = installation.artifactId;

  if (recordedId) {
    for (const pkg of resolution.packages) {
      for (const art of pkg.artifacts) {
        if (art.id === recordedId) {
          return { matched: true, pkg, artifact: art };
        }
      }
    }

    const converted = findDeterministicIdShapeMatch(installation, source, resolution.packages);
    if (converted) {
      return {
        matched: true,
        pkg: converted.pkg,
        artifact: converted.artifact,
        convertedFromId: recordedId,
        conversionNote: converted.note,
      };
    }
  }

  const sameNameArtifacts: Artifact[] = [];
  for (const pkg of resolution.packages) {
    for (const art of pkg.artifacts) {
      if (art.kind === installation.kind && art.name === installation.name) {
        sameNameArtifacts.push(art);
      }
    }
  }

  // Legacy installations without `artifactId`: accept only if there is a single unambiguous artifact in the source
  if (!recordedId && sameNameArtifacts.length === 1) {
    const art = sameNameArtifacts[0];
    const pkg = resolution.packages.find((p) => p.artifacts.includes(art))!;
    return { matched: true, pkg, artifact: art };
  }

  const displayId = recordedId ?? `${source.id}:${installation.name}`;
  const reason = `artifact ${displayId} no longer in source`;
  const hint =
    sameNameArtifacts.length > 0
      ? `same name found: ${sameNameArtifacts.map((a) => a.id).join(', ')}`
      : undefined;

  return {
    matched: false,
    reason,
    ...(hint ? { hint } : {}),
  };
}

export function sourceResolutionKey(source: Source): string {
  const identity = toInstallationSourceIdentity(source);
  return `${identity.scope}:${identity.id}:${identity.type}:${identity.location}`;
}

export interface SourceResolutionCache {
  get(source: Source | string): Promise<SourceResolution | undefined> | SourceResolution | undefined;
  set?(source: Source | string, res: SourceResolution): void;
}

export interface CheckForUpstreamUpdateOptions {
  resolution?: SourceResolution;
  resolutionError?: unknown;
  cache?: SourceResolutionCache | Map<string, SourceResolution>;
  resolverOpts?: { cacheDir?: string };
}

export type CheckForUpstreamUpdateOpts =
  | SourceResolution
  | SourceResolutionCache
  | Map<string, SourceResolution>
  | CheckForUpstreamUpdateOptions;

export interface CheckDriftForAllOptions {
  homeRoot?: string;
  concurrency?: number;
  resolverOpts?: { cacheDir?: string };
  resolutions?: Map<string, { resolution?: SourceResolution; error?: Error }>;
}

/**
 * Analyzes whether an installed item has drifted on the local disk relative to its recorded contentHash in state.json.
 */
export async function analyzeLocalDrift(
  installation: ManagedInstallation,
  homeRoot?: string
): Promise<DriftReport> {
  const adapter = homeRoot ? getAdapterWithHomeRoot(installation.assistant, homeRoot) : getAdapter(installation.assistant);
  const loc = {
    scope: installation.scope,
    projectRoot: installation.projectPath,
  };

  let diskHash: string | undefined;

  if (installation.kind === 'skill') {
    if (!fs.existsSync(installation.path)) {
      return {
        installation,
        status: 'missing-on-disk',
        details: `Skill directory not found at ${installation.path}`,
      };
    }
    try {
      const skill = await readSkill(installation.path);
      diskHash = canonicalSkillHash(skill);
    } catch {
      return {
        installation,
        status: 'missing-on-disk',
        details: `Failed to read skill at ${installation.path}`,
      };
    }
  } else if (installation.kind === 'agent') {
    let agent: CanonicalAgent | null = null;
    if (installation.disabled) {
      if (!fs.existsSync(installation.path)) {
        return {
          installation,
          status: 'missing-on-disk',
          details: `Agent file not found at ${installation.path}`,
        };
      }
      try {
        const content = await fs.promises.readFile(installation.path, 'utf-8');
        agent =
          installation.assistant === 'kilo-code'
            ? parseKiloAgentMarkdown(content)
            : parseClaudeAgentMarkdown(content);
      } catch {
        return {
          installation,
          status: 'missing-on-disk',
          details: `Failed to read agent at ${installation.path}`,
        };
      }
    } else {
      agent = await adapter.readAgent(installation.name, loc);
    }
    if (!agent) {
      return {
        installation,
        status: 'missing-on-disk',
        details: `Agent file not found for ${installation.name}`,
      };
    }
    diskHash = canonicalAgentHash(agent);
  } else if (installation.kind === 'command') {
    let cmd: CanonicalCommand | null = null;
    if (installation.disabled) {
      if (!fs.existsSync(installation.path)) {
        return {
          installation,
          status: 'missing-on-disk',
          details: `Command file not found at ${installation.path}`,
        };
      }
      try {
        const content = await fs.promises.readFile(installation.path, 'utf-8');
        cmd =
          installation.assistant === 'kilo-code'
            ? parseKiloCommandMarkdown(content, installation.name)
            : parseClaudeCommandMarkdown(content, installation.name);
      } catch {
        return {
          installation,
          status: 'missing-on-disk',
          details: `Failed to read command at ${installation.path}`,
        };
      }
    } else {
      cmd = await adapter.readCommand(installation.name, loc);
    }
    if (!cmd) {
      return {
        installation,
        status: 'missing-on-disk',
        details: `Command file not found for ${installation.name}`,
      };
    }
    diskHash = canonicalCommandHash(cmd);
  } else if (installation.kind === 'mcp-server') {
    const mcp = await adapter.readMcpServer(installation.name, loc);
    if (!mcp) {
      return {
        installation,
        status: 'missing-on-disk',
        details: `MCP server config not found for ${installation.name}`,
      };
    }
    diskHash = canonicalMcpServerHash(mcp);
  } else if (installation.kind === 'hook') {
    const hook = await adapter.readHook(installation.name, loc);
    if (!hook) {
      return {
        installation,
        status: 'missing-on-disk',
        details: `Hook config not found for ${installation.name}`,
      };
    }
    diskHash = canonicalHookHash(hook);
  } else if (installation.kind === 'rule') {
    const rule = await adapter.readRule(loc);
    if (!rule) {
      return {
        installation,
        status: 'missing-on-disk',
        details: `Rule not found for scope ${installation.scope}`,
      };
    }
    diskHash = canonicalRuleHash(rule);
  }

  const hasLocalPatch =
    installation.kind === 'skill' &&
    Boolean(installation.path) &&
    fs.existsSync(path.join(installation.path, 'local.patch'));

  if (installation.contentHash && diskHash !== installation.contentHash) {
    return {
      installation,
      status: 'modified-locally',
      hasLocalPatch,
      diskHash,
      details: hasLocalPatch
        ? 'Local adaptations applied (local.patch)'
        : 'Local content differs from installed version',
    };
  }

  return {
    installation,
    status: 'up-to-date',
    diskHash,
  };
}

/**
 * Checks whether an installed item has a newer version available from its upstream source.
 * Accepts an optional pre-resolved SourceResolution (or a per-run cache object) to avoid re-resolving.
 */
/** Appends the dirty-working-tree and id-conversion notes to a drift detail message. */
function withNotes(base: string, dirtyWorkingTree: boolean, conversionNote?: string): string {
  const notes = [dirtyWorkingTree ? 'dirty working tree' : undefined, conversionNote].filter(Boolean);
  return notes.length ? `${base} (${notes.join('; ')})` : base;
}

export async function checkForUpstreamUpdate(
  installation: ManagedInstallation,
  source: Source,
  homeRoot?: string | CheckForUpstreamUpdateOpts,
  opts?: CheckForUpstreamUpdateOpts
): Promise<DriftReport> {
  let effectiveHomeRoot: string | undefined;
  let effectiveOpts: CheckForUpstreamUpdateOpts | undefined;

  if (typeof homeRoot === 'string') {
    effectiveHomeRoot = homeRoot;
    effectiveOpts = opts;
  } else if (homeRoot !== undefined && homeRoot !== null) {
    effectiveHomeRoot = undefined;
    effectiveOpts = homeRoot;
  } else {
    effectiveHomeRoot = undefined;
    effectiveOpts = opts;
  }

  const localReport = await analyzeLocalDrift(installation, effectiveHomeRoot);
  if (localReport.status === 'missing-on-disk') {
    return localReport;
  }

  if (installation.provenance === 'unknown') {
    const hint = installation.provenanceHint;
    const details = hint
      ? `Provenance unknown for "${installation.name}" — ${hint}`
      : `Provenance unknown for "${installation.name}" — re-link to a source or reinstall.`;
    return {
      installation,
      status: 'provenance-unknown',
      hasLocalPatch: localReport.hasLocalPatch,
      diskHash: localReport.diskHash,
      reason: details,
      details,
      ...(hint ? { hint } : {}),
    };
  }

  let resolution: SourceResolution | undefined;
  let resolutionError: unknown | undefined;

  if (effectiveOpts) {
    if ('packages' in effectiveOpts && Array.isArray((effectiveOpts as SourceResolution).packages)) {
      resolution = effectiveOpts as SourceResolution;
    } else if ('resolution' in effectiveOpts && (effectiveOpts as CheckForUpstreamUpdateOptions).resolution) {
      resolution = (effectiveOpts as CheckForUpstreamUpdateOptions).resolution;
    } else if (
      'resolutionError' in effectiveOpts &&
      (effectiveOpts as CheckForUpstreamUpdateOptions).resolutionError !== undefined
    ) {
      resolutionError = (effectiveOpts as CheckForUpstreamUpdateOptions).resolutionError;
    } else if (typeof (effectiveOpts as any).get === 'function') {
      try {
        const cache = effectiveOpts as SourceResolutionCache;
        const val = cache.get(source) ?? cache.get(source.id);
        resolution = val instanceof Promise ? await val : val;
      } catch (err) {
        resolutionError = err;
      }
    } else if (
      'cache' in effectiveOpts &&
      effectiveOpts.cache &&
      typeof (effectiveOpts.cache as any).get === 'function'
    ) {
      try {
        const cache = effectiveOpts.cache as SourceResolutionCache;
        const val = cache.get(source) ?? cache.get(source.id);
        resolution = val instanceof Promise ? await val : val;
      } catch (err) {
        resolutionError = err;
      }
    }
  }

  if (resolutionError !== undefined) {
    const msg = resolutionError instanceof Error ? resolutionError.message : String(resolutionError);
    return {
      ...localReport,
      details: `Failed to resolve upstream source: ${msg}`,
    };
  }

  if (!resolution) {
    try {
      const resolver = getSourceResolver(source.type);
      const cacheDir =
        effectiveOpts && 'resolverOpts' in effectiveOpts
          ? (effectiveOpts as CheckForUpstreamUpdateOptions).resolverOpts?.cacheDir
          : undefined;
      resolution = await resolver.resolve(source, { homeRoot: effectiveHomeRoot, cacheDir });

      if (effectiveOpts && typeof (effectiveOpts as any).set === 'function') {
        (effectiveOpts as any).set(source, resolution);
      } else if (
        effectiveOpts &&
        'cache' in effectiveOpts &&
        effectiveOpts.cache &&
        typeof (effectiveOpts.cache as any).set === 'function'
      ) {
        (effectiveOpts.cache as any).set(source, resolution);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ...localReport,
        details: `Failed to resolve upstream source: ${msg}`,
      };
    }
  }

  // Find matching package & artifact in resolution (spec §3 rule 5: exact artifactId, no kind+name fallback)
  const matchedArt = matchInstallationArtifact(installation, source, resolution);
  if (!matchedArt.matched) {
    const details = matchedArt.hint
      ? `${matchedArt.reason}; ${matchedArt.hint}`
      : matchedArt.reason;
    return {
      installation,
      status: 'source-unavailable',
      hasLocalPatch: localReport.hasLocalPatch,
      diskHash: localReport.diskHash,
      reason: matchedArt.reason,
      details,
      ...(matchedArt.hint ? { hint: matchedArt.hint } : {}),
    };
  }

  const foundPkg = matchedArt.pkg;
  const foundArt = matchedArt.artifact;
  const conversionNote = matchedArt.conversionNote;

  const cacheDir =
    effectiveOpts && 'resolverOpts' in effectiveOpts
      ? (effectiveOpts as CheckForUpstreamUpdateOptions).resolverOpts?.cacheDir
      : undefined;

  const installedCommit = installation.sourceRevision?.commit || undefined;
  let currentCommit = foundPkg.version?.commit || undefined;
  const isDirtyWorkingTree = Boolean(
    source.type === 'local-folder' && source.readWorkingTree && foundPkg.version?.dirty
  );
  const isDirty = isDirtyWorkingTree || Boolean(installation.sourceRevision?.dirty);
  const baselineSourceHash = installation.sourceContentHash ?? installation.contentHash;

  let commitsBehind: number | undefined;
  if (installedCommit && currentCommit) {
    if (installedCommit === currentCommit) {
      commitsBehind = 0;
    } else {
      try {
        const gap = await describeRevisionGap(installation, source, {
          cacheDir,
          homeRoot: effectiveHomeRoot,
          currentCommit,
        });
        if (gap.commitsBehind !== null && gap.commitsBehind !== undefined) {
          commitsBehind = gap.commitsBehind;
        }
      } catch {
        // ignore revision gap failure
      }
    }
  }

  // Spec §2 fast path: current source commit == sourceRevision.commit and not dirty -> no update, NO translation/hash of the source
  if (
    installedCommit &&
    currentCommit &&
    installedCommit === currentCommit &&
    !isDirty &&
    baselineSourceHash
  ) {
    return {
      ...localReport,
      sourceHash: baselineSourceHash,
      installedCommit,
      currentCommit,
      ...(commitsBehind !== undefined ? { commitsBehind } : {}),
      ...(conversionNote
        ? {
            details: localReport.details
              ? `${localReport.details} (${conversionNote})`
              : conversionNote,
          }
        : {}),
    };
  }

  let sourceHash: string | undefined;
  try {
    const result = await resolveAndTranslate(
      source,
      foundPkg,
      foundArt,
      installation.assistant,
      { cacheDir, homeRoot: effectiveHomeRoot }
    );

    if (!currentCommit && foundPkg.version?.commit) {
      currentCommit = foundPkg.version.commit;
    }

    if (foundArt.kind === 'skill') {
      sourceHash = canonicalSkillHash(result.translated as CanonicalSkill);
    } else if (foundArt.kind === 'agent') {
      sourceHash = canonicalAgentHash(result.translated as CanonicalAgent);
    } else if (foundArt.kind === 'command') {
      sourceHash = canonicalCommandHash(result.translated as CanonicalCommand);
    } else if (foundArt.kind === 'mcp-server') {
      sourceHash = canonicalMcpServerHash(result.translated as CanonicalMcpServer);
    } else if (foundArt.kind === 'hook') {
      sourceHash = canonicalHookHash(result.translated as CanonicalHook);
    } else if (foundArt.kind === 'rule') {
      sourceHash = canonicalRuleHash(result.translated as CanonicalRule);
    }
  } catch (err: unknown) {
    if (isUntrackedArtifactError(err)) {
      return {
        installation,
        status: 'source-unavailable',
        hasLocalPatch: localReport.hasLocalPatch,
        diskHash: localReport.diskHash,
        ...(installedCommit ? { installedCommit } : {}),
        ...(currentCommit ? { currentCommit } : {}),
        ...(commitsBehind !== undefined ? { commitsBehind } : {}),
        details: err.message,
        hint: err.hint,
      };
    }
    return {
      ...localReport,
      ...(installedCommit ? { installedCommit } : {}),
      ...(currentCommit ? { currentCommit } : {}),
      ...(commitsBehind !== undefined ? { commitsBehind } : {}),
    };
  }

  const effectiveDirtyWorkingTree = Boolean(
    source.type === 'local-folder' && source.readWorkingTree && foundPkg.version?.dirty
  );
  const effectiveDirty = effectiveDirtyWorkingTree || Boolean(installation.sourceRevision?.dirty);

  const commitFields = {
    ...(installedCommit ? { installedCommit } : {}),
    ...(currentCommit ? { currentCommit } : {}),
    ...(commitsBehind !== undefined ? { commitsBehind } : {}),
  };

  if (sourceHash && baselineSourceHash && sourceHash !== baselineSourceHash) {
    if (localReport.status === 'modified-locally') {
      const baseDetails = localReport.hasLocalPatch
        ? 'Upstream source has a newer version and local adaptation patch is applied'
        : 'Local files were modified and upstream source has a newer version';
      return {
        installation,
        status: 'modified-and-update-available',
        hasLocalPatch: localReport.hasLocalPatch,
        diskHash: localReport.diskHash,
        sourceHash,
        ...commitFields,
        ...(effectiveDirtyWorkingTree ? { dirty: true } : {}),
        details: withNotes(baseDetails, effectiveDirtyWorkingTree, conversionNote),
      };
    }
    const baseDetails = 'A newer version is available from upstream source';
    return {
      installation,
      status: 'update-available',
      diskHash: localReport.diskHash,
      sourceHash,
      ...commitFields,
      ...(effectiveDirtyWorkingTree ? { dirty: true } : {}),
      details: withNotes(baseDetails, effectiveDirtyWorkingTree, conversionNote),
    };
  }

  return {
    ...localReport,
    sourceHash,
    ...commitFields,
    ...(effectiveDirty ? { dirty: true } : {}),
    ...(conversionNote
      ? {
          details: localReport.details
            ? `${localReport.details} (${conversionNote})`
            : conversionNote,
        }
      : {}),
  };
}

function computeCanonicalHash(kind: Artifact['kind'], translated: unknown): string {
  switch (kind) {
    case 'skill':
      return canonicalSkillHash(translated as CanonicalSkill);
    case 'agent':
      return canonicalAgentHash(translated as CanonicalAgent);
    case 'command':
      return canonicalCommandHash(translated as CanonicalCommand);
    case 'mcp-server':
      return canonicalMcpServerHash(translated as CanonicalMcpServer);
    case 'hook':
      return canonicalHookHash(translated as CanonicalHook);
    case 'rule':
      return canonicalRuleHash(translated as CanonicalRule);
  }
}

/**
 * Evaluates candidate sources for a legacy installation that lacks `installation.source`.
 * Adopts a candidate ONLY if it is the ONLY one whose current artifact (exact `artifactId`,
 * deterministic 49.3 id-shape conversion, or unambiguous `kind + name`) hashes to
 * `installation.contentHash` at a reachable commit (cached clone HEAD or source HEAD;
 * for git local folders, committed HEAD).
 */
export async function evaluateProvenanceCandidates(
  installation: ManagedInstallation,
  allSources: Source[],
  options?: {
    homeRoot?: string;
    cacheDir?: string;
    offline?: boolean;
    preResolved?: Map<string, { resolution?: SourceResolution; error?: Error }>;
    hashCache?: Map<string, string>;
  }
): Promise<ProvenanceEvaluationResult> {
  if (!installation.sourceId) {
    return {
      outcome: 'unknown',
      reason: 'no-source-id',
      details: `No sourceId recorded for "${installation.name}" — re-link to a source or reinstall.`,
    };
  }

  if (!installation.contentHash) {
    return {
      outcome: 'unknown',
      reason: 'no-content-hash',
      details: `No contentHash recorded for "${installation.name}" — re-link to a source or reinstall.`,
    };
  }

  const candidates = allSources.filter((s) => s.id === installation.sourceId);
  if (candidates.length === 0) {
    return {
      outcome: 'unknown',
      reason: 'source-not-in-manifest',
      details: `Source "${installation.sourceId}" is not registered in global or workspace manifest — re-link to a source or reinstall.`,
    };
  }

  const preResolved =
    options?.preResolved ?? new Map<string, { resolution?: SourceResolution; error?: Error }>();
  const hashCache = options?.hashCache ?? new Map<string, string>();

  let needsFetch = false;
  let artifactFoundCount = 0;
  const matchingCandidates: ProvenanceCandidateMatch[] = [];

  for (const candidate of candidates) {
    const effectiveCandidate: Source =
      candidate.type === 'local-folder'
        ? { ...candidate, readWorkingTree: false }
        : candidate;
    const key = sourceResolutionKey(effectiveCandidate);
    const origKey = sourceResolutionKey(candidate);

    let resEntry = preResolved.get(key) ?? preResolved.get(origKey);
    if (!resEntry) {
      try {
        const resolver = getSourceResolver(effectiveCandidate.type);
        const resolution = await resolver.resolve(effectiveCandidate, {
          homeRoot: options?.homeRoot,
          cacheDir: options?.cacheDir,
          offline: options?.offline,
        });
        resEntry = { resolution };
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        resEntry = { error };
      }
      preResolved.set(key, resEntry);
    }

    if (resEntry.error || !resEntry.resolution) {
      needsFetch = true;
      continue;
    }

    const matched = matchInstallationArtifact(
      installation,
      effectiveCandidate,
      resEntry.resolution
    );
    if (!matched.matched) {
      continue;
    }

    artifactFoundCount++;

    const hashKey = `${key}::${matched.pkg.id}::${matched.artifact.id}::${installation.assistant}`;
    let sourceHash = hashCache.get(hashKey);
    if (sourceHash === undefined) {
      try {
        const { translated } = await resolveAndTranslate(
          effectiveCandidate,
          matched.pkg,
          matched.artifact,
          installation.assistant,
          {
            homeRoot: options?.homeRoot,
            cacheDir: options?.cacheDir,
          }
        );
        sourceHash = computeCanonicalHash(matched.artifact.kind, translated);
        hashCache.set(hashKey, sourceHash);
      } catch {
        needsFetch = true;
        continue;
      }
    }

    if (sourceHash === installation.contentHash) {
      matchingCandidates.push({
        source: candidate,
        pkg: matched.pkg,
        artifact: matched.artifact,
        sourceHash,
        revision: matched.pkg.version,
      });
    }
  }

  if (needsFetch) {
    return {
      outcome: 'unknown',
      reason: 'needs-fetch',
      hint: 'check sources to resolve',
      details: `Source "${installation.sourceId}" needs a fetch to verify provenance — check sources to resolve.`,
    };
  }

  if (matchingCandidates.length === 1) {
    return {
      outcome: 'adopted',
      match: matchingCandidates[0],
    };
  }

  if (matchingCandidates.length > 1) {
    return {
      outcome: 'unknown',
      reason: 'ambiguous-multiple-matches',
      details: `Multiple registered sources with id "${installation.sourceId}" match "${installation.name}" — re-link to a source or reinstall.`,
    };
  }

  if (artifactFoundCount === 0) {
    return {
      outcome: 'unknown',
      reason: 'artifact-not-in-source',
      details: `Artifact "${installation.artifactId ?? installation.name}" not found in source "${installation.sourceId}" — re-link to a source or reinstall.`,
    };
  }

  const reason: ProvenanceUnknownReason =
    candidates.length > 1 ? 'ambiguous-sources-hash-mismatch' : 'hash-mismatch';
  return {
    outcome: 'unknown',
    reason,
    details: `Installed content hash of "${installation.name}" does not match current HEAD of source "${installation.sourceId}" — re-link to a source or reinstall.`,
  };
}

/**
 * Applies a `ProvenanceEvaluationResult` to a `ManagedInstallation` in place.
 * Returns `true` if the installation record was modified.
 */
export function applyProvenanceEvaluation(
  inst: ManagedInstallation,
  evalResult: ProvenanceEvaluationResult,
  homeRoot?: string
): boolean {
  if (evalResult.outcome === 'adopted') {
    const { source, pkg, artifact, revision } = evalResult.match;
    inst.source = toInstallationSourceIdentity(source, homeRoot);
    inst.sourceId = source.id;
    inst.packageId = pkg.id;
    inst.artifactId = artifact.id;
    if (revision?.commit) {
      inst.sourceRevision = {
        commit: revision.commit,
        ...(revision.requestedRef ? { requestedRef: revision.requestedRef } : {}),
      };
    }
    inst.sourceContentHash = inst.contentHash;
    delete inst.provenance;
    delete inst.provenanceReason;
    delete inst.provenanceHint;
    return true;
  }

  const changed =
    inst.provenance !== 'unknown' ||
    inst.provenanceReason !== evalResult.reason ||
    inst.provenanceHint !== evalResult.hint;
  inst.provenance = 'unknown';
  inst.provenanceReason = evalResult.reason;
  if (evalResult.hint) {
    inst.provenanceHint = evalResult.hint;
  } else {
    delete inst.provenanceHint;
  }
  return changed;
}

/**
 * Checks drift for all given installations against the provided sources.
 * Resolves each source ONCE per run (with concurrency 1 per source, and sources running
 * in parallel up to a bound of 4).
 * A failing source marks only its own installations as failed, never aborting the run.
 */
export async function checkDriftForAll(
  installations: ManagedInstallation[],
  sources: SourceLookupInput,
  homeRootOrOptions?: string | CheckDriftForAllOptions,
  options?: CheckDriftForAllOptions
): Promise<DriftReport[]> {
  let homeRoot: string | undefined;
  let opts: CheckDriftForAllOptions | undefined;

  if (typeof homeRootOrOptions === 'string') {
    homeRoot = homeRootOrOptions;
    opts = options;
  } else if (homeRootOrOptions && typeof homeRootOrOptions === 'object') {
    opts = homeRootOrOptions;
    homeRoot = opts.homeRoot;
  } else {
    opts = options;
    homeRoot = opts?.homeRoot;
  }

  const concurrency = opts?.concurrency ?? 4;
  const resolutions = opts?.resolutions ?? new Map<string, { resolution?: SourceResolution; error?: Error }>();
  const { globalSources, workspaceSources } = normalizeSourceLists(sources);
  const allSources = [...globalSources, ...workspaceSources];

  // 1. Resolve the source for each installation and identify unique sources needed
  const instResolutions = new Map<ManagedInstallation, ResolvedInstallationSource>();
  const neededSources = new Map<string, Source>();

  for (const inst of installations) {
    if (!inst.source && !inst.sourceId) {
      continue;
    }
    const resolvedSrc = resolveInstallationSource(inst, sources);
    instResolutions.set(inst, resolvedSrc);
    if ('source' in resolvedSrc) {
      const key = sourceResolutionKey(resolvedSrc.source);
      if (!neededSources.has(key)) {
        neededSources.set(key, resolvedSrc.source);
      }
    } else if (resolvedSrc.provenanceUnknown && inst.sourceId) {
      for (const cand of allSources.filter((s) => s.id === inst.sourceId)) {
        const key = sourceResolutionKey(cand);
        if (!neededSources.has(key)) {
          neededSources.set(key, cand);
        }
      }
    }
  }

  // Count how many neededSources share each source.id
  const idCounts = new Map<string, number>();
  for (const src of neededSources.values()) {
    idCounts.set(src.id, (idCounts.get(src.id) ?? 0) + 1);
  }

  // 2. Resolve each source once, with concurrency up to 4
  const sourcesToResolve: Array<{ key: string; src: Source }> = [];
  for (const [key, src] of neededSources.entries()) {
    const canReuseById = (idCounts.get(src.id) ?? 0) === 1 && resolutions.has(src.id);
    if (!resolutions.has(key) && !canReuseById) {
      sourcesToResolve.push({ key, src });
    }
  }

  let nextIdx = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, sourcesToResolve.length) },
    async () => {
      while (nextIdx < sourcesToResolve.length) {
        const { key, src } = sourcesToResolve[nextIdx++];
        try {
          const resolver = getSourceResolver(src.type);
          const resolution = await resolver.resolve(src, {
            homeRoot,
            cacheDir: opts?.resolverOpts?.cacheDir,
          });
          resolutions.set(key, { resolution });
          if ((idCounts.get(src.id) ?? 0) === 1) {
            resolutions.set(src.id, { resolution });
          }
        } catch (err: unknown) {
          const error = err instanceof Error ? err : new Error(String(err));
          resolutions.set(key, { error });
          if ((idCounts.get(src.id) ?? 0) === 1) {
            resolutions.set(src.id, { error });
          }
        }
      }
    }
  );

  await Promise.all(workers);

  const hashCache = new Map<string, string>();

  // 3. Check drift for each installation
  const reports = await Promise.all(
    installations.map(async (inst) => {
      const resolvedSrc = instResolutions.get(inst);
      if (!resolvedSrc) {
        const localReport = await analyzeLocalDrift(inst, homeRoot);
        if (localReport.status === 'missing-on-disk') {
          return localReport;
        }
        if (inst.provenance === 'unknown') {
          const details = inst.provenanceHint
            ? `Provenance unknown for "${inst.name}" — ${inst.provenanceHint}`
            : `Provenance unknown for "${inst.name}" — re-link to a source or reinstall.`;
          return {
            installation: inst,
            status: 'provenance-unknown' as const,
            hasLocalPatch: localReport.hasLocalPatch,
            diskHash: localReport.diskHash,
            reason: details,
            details,
            ...(inst.provenanceHint ? { hint: inst.provenanceHint } : {}),
          };
        }
        return localReport;
      }

      if ('unavailable' in resolvedSrc) {
        const localReport = await analyzeLocalDrift(inst, homeRoot);
        if (localReport.status === 'missing-on-disk') {
          return localReport;
        }
        if (inst.source) {
          return {
            installation: inst,
            status: 'source-unavailable' as const,
            hasLocalPatch: localReport.hasLocalPatch,
            diskHash: localReport.diskHash,
            reason: resolvedSrc.unavailable,
            details: resolvedSrc.hint
              ? `${resolvedSrc.unavailable} ${resolvedSrc.hint}`
              : resolvedSrc.unavailable,
            ...(resolvedSrc.hint ? { hint: resolvedSrc.hint } : {}),
          };
        }

        if (resolvedSrc.provenanceUnknown) {
          const evalResult = await evaluateProvenanceCandidates(inst, allSources, {
            homeRoot,
            cacheDir: opts?.resolverOpts?.cacheDir,
            offline: false,
            preResolved: resolutions,
            hashCache,
          });
          applyProvenanceEvaluation(inst, evalResult, homeRoot);
          if (evalResult.outcome === 'adopted') {
            if (_onProvenanceResolved) {
              try {
                await _onProvenanceResolved(inst, homeRoot);
              } catch {
                // ignore persistence error during drift check
              }
            }
            const winnerSrc = evalResult.match.source;
            const winnerKey = sourceResolutionKey(winnerSrc);
            const resEntry = resolutions.get(winnerKey) ?? resolutions.get(winnerSrc.id);
            return checkForUpstreamUpdate(inst, winnerSrc, homeRoot, {
              resolution: resEntry?.resolution,
              resolutionError: resEntry?.error,
              resolverOpts: opts?.resolverOpts,
            });
          }

          return {
            installation: inst,
            status: 'provenance-unknown' as const,
            hasLocalPatch: localReport.hasLocalPatch,
            diskHash: localReport.diskHash,
            reason: evalResult.details,
            details: evalResult.details,
            ...(evalResult.hint ? { hint: evalResult.hint } : {}),
          };
        }

        return localReport;
      }

      const src = resolvedSrc.source;
      const key = sourceResolutionKey(src);
      const resEntry = resolutions.get(key) ?? resolutions.get(src.id);
      return checkForUpstreamUpdate(inst, src, homeRoot, {
        resolution: resEntry?.resolution,
        resolutionError: resEntry?.error,
        resolverOpts: opts?.resolverOpts,
      });
    })
  );

  return reports;
}
