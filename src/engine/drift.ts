import * as child_process from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  toInstallationSourceIdentity,
  type AssistantId,
  type ManagedInstallation,
  type ResolvedRevision,
  type Source,
  type Package,
  type Artifact,
} from '../domain/types';
import type {
  CanonicalSkill,
  CanonicalSkillDocument,
  CanonicalSkillFile,
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
import {
  parseYamlValue,
  parseSkillMarkdown,
  parseClaudeAgentMarkdown,
  parseClaudeCommandMarkdown,
} from '../adapters/claude';
import { parseKiloAgentMarkdown, parseKiloCommandMarkdown } from '../adapters/kilo';
import { getAdapter, getAdapterWithHomeRoot } from '../adapters/registry';
import { getSourceResolver } from '../sources/registry';
import { isUntrackedArtifactError } from '../sources/localFolder';
import { runGit, resolveAndValidateCacheDir } from '../sources/gitProcess';
import { translateSkill } from '../translator/skill';
import { translateAgent } from '../translator/agent';
import { translateCommand } from '../translator/command';
import { translateMcpServer } from '../translator/mcp';
import { translateHook } from '../translator/hook';
import { translateRule } from '../translator/rule';
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
  | 'ambiguous-source'
  | 'hash-mismatch'
  | 'ambiguous-sources-hash-mismatch'
  | 'ambiguous-multiple-matches';

export interface ProvenanceCandidateMatch {
  source: Source;
  pkg: Package;
  artifact: Artifact;
  sourceHash?: string;
  revision?: ResolvedRevision;
  sourceContentHash?: string;
}

export type ProvenanceEvaluationResult =
  | {
      outcome: 'adopted';
      adoptionMode: 'adopted-with-commit' | 'adopted-source-only';
      rebaselined?: 'codec';
      realLocalEdit?: boolean;
      recomputedContentHash?: string;
      match: ProvenanceCandidateMatch;
    }
  | {
      outcome: 'unknown';
      reason: ProvenanceUnknownReason;
      rebaselined?: 'codec';
      realLocalEdit?: boolean;
      recomputedContentHash?: string;
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
      ...(installation.rebaselined ? { rebaselined: installation.rebaselined } : {}),
      details: hasLocalPatch
        ? 'Local adaptations applied (local.patch)'
        : 'Local content differs from installed version',
    };
  }

  return {
    installation,
    status: 'up-to-date',
    diskHash,
    ...(installation.rebaselined ? { rebaselined: installation.rebaselined } : {}),
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

const MAX_HISTORY_COMMITS = 200;

export interface ProvenanceHistoryCaches {
  blobCache: Map<string, Buffer>;
  gitLogCache: Map<string, Array<{ commit: string; relPath: string }>>;
  gitCtxCache: Map<string, { repoPrefix: string; headCommit: string } | null>;
  rawArtifactAtCommitCache: Map<
    string,
    CanonicalSkill | CanonicalAgent | CanonicalCommand | CanonicalMcpServer | CanonicalHook | CanonicalRule
  >;
  translationHashCache: Map<string, string>;
  legacyCommitHashesCache: Map<string, Set<string>>;
}

export function createProvenanceHistoryCaches(): ProvenanceHistoryCaches {
  return {
    blobCache: new Map(),
    gitLogCache: new Map(),
    gitCtxCache: new Map(),
    rawArtifactAtCommitCache: new Map(),
    translationHashCache: new Map(),
    legacyCommitHashesCache: new Map(),
  };
}

function isIgnoredHistorySkillSegment(name: string): boolean {
  return (
    name === '.git' ||
    name === 'node_modules' ||
    name === '__pycache__' ||
    name.endsWith('.pyc') ||
    name === 'index.json' ||
    name === 'local.patch' ||
    name.endsWith('.patch') ||
    name === '.DS_Store' ||
    name === 'Thumbs.db'
  );
}

/**
 * Pre-`d61fdd1` skill frontmatter parser (line-by-line without multi-line block folding).
 */
function parseSkillMarkdownPreD61fdd1(content: string): CanonicalSkillDocument {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n') && normalized !== '---') {
    return { name: '', description: '', body: content, extraFields: {} };
  }
  const closingIdx = normalized.indexOf('\n---', 3);
  if (closingIdx === -1) {
    return { name: '', description: '', body: content, extraFields: {} };
  }
  const yamlBlock = normalized.slice(4, closingIdx);
  let bodyStart = closingIdx + 4;
  if (normalized[bodyStart] === '\n') {
    bodyStart += 1;
  }
  const body = normalized.slice(bodyStart);
  const lines = yamlBlock.split('\n');
  let name = '';
  let description = '';
  const extraFields: Record<string, unknown> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      continue;
    }
    const key = trimmed.slice(0, colonIdx).trim();
    const rawVal = trimmed.slice(colonIdx + 1).trim();
    const parsedVal = parseYamlValue(rawVal);

    if (key === 'name') {
      name = typeof parsedVal === 'string' ? parsedVal : String(parsedVal ?? '');
    } else if (key === 'description') {
      description = typeof parsedVal === 'string' ? parsedVal : String(parsedVal ?? '');
    } else {
      extraFields[key] = parsedVal;
    }
  }

  return { name, description, body, extraFields };
}

function parseClaudeAgentMarkdownPreD61fdd1(content: string): CanonicalAgent {
  const cur = parseClaudeAgentMarkdown(content);
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n') && normalized !== '---') {
    return cur;
  }
  const closingIdx = normalized.indexOf('\n---', 3);
  if (closingIdx === -1) {
    return cur;
  }
  const yamlBlock = normalized.slice(4, closingIdx);
  const lines = yamlBlock.split('\n');
  let name = '';
  let description = '';
  const extraFields: Record<string, unknown> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const rawVal = trimmed.slice(colonIdx + 1).trim();
    const parsedVal = parseYamlValue(rawVal);
    if (key === 'name') {
      name = typeof parsedVal === 'string' ? parsedVal : String(parsedVal ?? '');
    } else if (key === 'description') {
      description = typeof parsedVal === 'string' ? parsedVal : String(parsedVal ?? '');
    } else if (!['tools', 'permissions', 'model', 'variant', 'mode'].includes(key)) {
      extraFields[key] = parsedVal;
    }
  }

  return {
    ...cur,
    name: name || cur.name,
    description: description || cur.description,
    extraFields,
  };
}

function parseClaudeCommandMarkdownPreD61fdd1(
  content: string,
  defaultName = ''
): CanonicalCommand {
  const cur = parseClaudeCommandMarkdown(content, defaultName);
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n') && normalized !== '---') {
    return cur;
  }
  const closingIdx = normalized.indexOf('\n---', 3);
  if (closingIdx === -1) {
    return cur;
  }
  const yamlBlock = normalized.slice(4, closingIdx);
  const lines = yamlBlock.split('\n');
  let name = defaultName;
  let description = '';
  const extraFields: Record<string, unknown> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const rawVal = trimmed.slice(colonIdx + 1).trim();
    const parsedVal = parseYamlValue(rawVal);
    if (key === 'name') {
      name = typeof parsedVal === 'string' ? parsedVal : String(parsedVal ?? '');
    } else if (key === 'description') {
      description = typeof parsedVal === 'string' ? parsedVal : String(parsedVal ?? '');
    } else if (!['agent', 'model', 'subtask'].includes(key)) {
      extraFields[key] = parsedVal;
    }
  }

  return {
    ...cur,
    name: name || cur.name,
    description: description || cur.description,
    extraFields,
  };
}

function canonicalSkillHashPreNormalization(
  skill: CanonicalSkill,
  opts: { includeMetadata: boolean; modeStrategy: 'exact' | 'default' | 'regular644' }
): string {
  const hash = crypto.createHash('sha256');
  hash.update('name:');
  hash.update(skill.name);
  hash.update('\n');
  hash.update('description:');
  hash.update(skill.description);
  hash.update('\n');
  hash.update('body:');
  hash.update(skill.body);
  hash.update('\n');
  hash.update('extraFields:\n');
  const extraKeys = Object.keys(skill.extraFields)
    .filter((k) => (opts.includeMetadata ? true : k !== 'metadata'))
    .sort();
  for (const key of extraKeys) {
    hash.update(`${key}:`);
    hash.update(JSON.stringify(skill.extraFields[key]));
    hash.update('\n');
  }
  hash.update('files:\n');
  const sortedFiles = [...skill.files].sort((a, b) => {
    const normA = path.posix.normalize(a.path.split(path.sep).join('/'));
    const normB = path.posix.normalize(b.path.split(path.sep).join('/'));
    return normA.localeCompare(normB);
  });
  for (const file of sortedFiles) {
    hash.update('path:');
    hash.update(path.posix.normalize(file.path.split(path.sep).join('/')));
    hash.update('\n');
    hash.update('content:');
    hash.update(file.content);
    hash.update('\n');
    hash.update('mode:');
    if (opts.modeStrategy === 'default') {
      hash.update('default');
    } else if (opts.modeStrategy === 'regular644') {
      hash.update('100644');
    } else {
      hash.update(file.mode !== undefined ? file.mode.toString(8) : 'default');
    }
    hash.update('\n');
  }
  return hash.digest('hex');
}

function canonicalAgentHashPreNormalization(
  agent: CanonicalAgent,
  includeMetadata: boolean
): string {
  const hash = crypto.createHash('sha256');
  hash.update(`name:${agent.name}\n`);
  hash.update(`description:${agent.description}\n`);
  if (agent.mode) hash.update(`mode:${agent.mode}\n`);
  hash.update('tools:\n');
  for (const t of [...agent.tools].sort()) hash.update(`${t}\n`);
  hash.update('permissions:\n');
  for (const k of Object.keys(agent.permissions).sort()) {
    hash.update(`${k}:${agent.permissions[k]}\n`);
  }
  if (agent.model) hash.update(`model:${agent.model}\n`);
  if (agent.variant) hash.update(`variant:${agent.variant}\n`);
  hash.update(`body:\n${agent.body}\n`);
  hash.update('extraFields:\n');
  const extraKeys = Object.keys(agent.extraFields)
    .filter((k) => (includeMetadata ? true : k !== 'metadata'))
    .sort();
  for (const key of extraKeys) {
    hash.update(`${key}:${JSON.stringify(agent.extraFields[key])}\n`);
  }
  return hash.digest('hex');
}

function canonicalCommandHashPreNormalization(
  cmd: CanonicalCommand,
  includeMetadata: boolean
): string {
  const hash = crypto.createHash('sha256');
  hash.update(`name:${cmd.name}\n`);
  hash.update(`description:${cmd.description}\n`);
  if (cmd.agent) hash.update(`agent:${cmd.agent}\n`);
  if (cmd.model) hash.update(`model:${cmd.model}\n`);
  if (cmd.subtask !== undefined) hash.update(`subtask:${cmd.subtask}\n`);
  hash.update(`body:\n${cmd.body}\n`);
  hash.update('extraFields:\n');
  const extraKeys = Object.keys(cmd.extraFields)
    .filter((k) => (includeMetadata ? true : k !== 'metadata'))
    .sort();
  for (const key of extraKeys) {
    hash.update(`${key}:${JSON.stringify(cmd.extraFields[key])}\n`);
  }
  return hash.digest('hex');
}

async function readAllFilesInSkillDir(
  skillDir: string
): Promise<{ skillMdContent: string; allFiles: CanonicalSkillFile[] }> {
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  const skillMdContent = await fs.promises.readFile(skillMdPath, 'utf-8');
  const allFiles: CanonicalSkillFile[] = [];

  async function walk(currentDir: string, relativeRoot: string) {
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') {
        continue;
      }
      const fullPath = path.join(currentDir, entry.name);
      const relPath =
        relativeRoot === '' ? entry.name : path.posix.join(relativeRoot, entry.name);
      if (relPath === 'SKILL.md') continue;
      const stat = await fs.promises.lstat(fullPath);
      if (stat.isDirectory()) {
        await walk(fullPath, relPath);
      } else if (stat.isFile()) {
        const content = await fs.promises.readFile(fullPath);
        allFiles.push({ path: relPath, content, mode: stat.mode });
      }
    }
  }

  await walk(skillDir, '');
  return { skillMdContent, allFiles };
}

function computePreNormalizationSkillHashes(
  skillMdContent: string,
  allFiles: CanonicalSkillFile[],
  assistant?: AssistantId
): Set<string> {
  const docCur = parseSkillMarkdown(skillMdContent);
  const docLeg = parseSkillMarkdownPreD61fdd1(skillMdContent);
  const normFiles = allFiles.filter(
    (f) => !f.path.split('/').some(isIgnoredHistorySkillSegment)
  );
  const noPycacheFiles = allFiles.filter(
    (f) => !f.path.split('/').some((s) => s === '__pycache__' || s.endsWith('.pyc'))
  );

  const hashes = new Set<string>();
  for (const doc of [docCur, docLeg]) {
    for (const files of [allFiles, noPycacheFiles, normFiles]) {
      const baseSkill: CanonicalSkill = { ...doc, files };
      const variants: CanonicalSkill[] = [baseSkill];
      if (assistant) {
        const tr = translateSkill(baseSkill, assistant);
        if (tr.overall !== 'unsupported') {
          variants.push(tr.value);
        }
      }
      for (const sk of variants) {
        for (const includeMetadata of [true, false]) {
          for (const modeStrategy of ['exact', 'default', 'regular644'] as const) {
            hashes.add(
              canonicalSkillHashPreNormalization(sk, { includeMetadata, modeStrategy })
            );
          }
        }
      }
    }
  }
  return hashes;
}

export interface RebaselineCheckResult {
  diskExists: boolean;
  recomputedHash?: string;
  status: 'unchanged' | 'rebaselined-codec' | 'real-local-edit' | 'missing-on-disk';
}

/**
 * Re-baselines an installation's `contentHash` against the files ON DISK using the
 * current codec (`canonicalSkillHash`, etc.), distinguishing an algorithm/normalization
 * change (pre-`d61fdd1`/`2f949cc` codec) from a genuine local edit.
 */
export async function checkInstallationHashRebaseline(
  installation: ManagedInstallation,
  homeRoot?: string,
  candidateSourceSkillDirs?: string[]
): Promise<RebaselineCheckResult> {
  const localReport = await analyzeLocalDrift(installation, homeRoot);
  if (localReport.status === 'missing-on-disk' || !localReport.diskHash) {
    return {
      diskExists: false,
      status: 'missing-on-disk',
    };
  }

  const recomputedHash = localReport.diskHash;
  if (!installation.contentHash || installation.contentHash === recomputedHash) {
    return {
      diskExists: true,
      recomputedHash,
      status: 'unchanged',
    };
  }

  const recorded = installation.contentHash;

  try {
    if (installation.kind === 'skill') {
      const { skillMdContent, allFiles } = await readAllFilesInSkillDir(installation.path);
      const legacyDiskHashes = computePreNormalizationSkillHashes(
        skillMdContent,
        allFiles,
        installation.assistant
      );
      if (legacyDiskHashes.has(recorded)) {
        return {
          diskExists: true,
          recomputedHash,
          status: 'rebaselined-codec',
        };
      }

      // Check if a candidate source folder has ignored files (e.g. .DS_Store, index.json)
      // that were included in `recorded` under the pre-normalization codec while its
      // current normalized content hash matches `recomputedHash` on disk.
      if (candidateSourceSkillDirs) {
        for (const srcSkillDir of candidateSourceSkillDirs) {
          if (!fs.existsSync(path.join(srcSkillDir, 'SKILL.md'))) continue;
          try {
            const srcCurSkill = await readSkill(srcSkillDir);
            const trCur = translateSkill(srcCurSkill, installation.assistant);
            const srcCurHash =
              trCur.overall !== 'unsupported'
                ? canonicalSkillHash(trCur.value)
                : canonicalSkillHash(srcCurSkill);
            if (srcCurHash !== recomputedHash) continue;

            const srcAll = await readAllFilesInSkillDir(srcSkillDir);
            const srcLegacyHashes = computePreNormalizationSkillHashes(
              srcAll.skillMdContent,
              srcAll.allFiles,
              installation.assistant
            );
            if (srcLegacyHashes.has(recorded)) {
              return {
                diskExists: true,
                recomputedHash,
                status: 'rebaselined-codec',
              };
            }
          } catch {
            // ignore
          }
        }
      }
    } else if (installation.kind === 'agent') {
      const raw = await fs.promises.readFile(installation.path, 'utf-8');
      const curAgent =
        installation.assistant === 'kilo-code'
          ? parseKiloAgentMarkdown(raw)
          : parseClaudeAgentMarkdown(raw);
      const legAgent = parseClaudeAgentMarkdownPreD61fdd1(raw);
      const candidates = new Set<string>([
        canonicalAgentHashPreNormalization(curAgent, true),
        canonicalAgentHashPreNormalization(curAgent, false),
        canonicalAgentHashPreNormalization(legAgent, true),
        canonicalAgentHashPreNormalization(legAgent, false),
      ]);
      if (candidates.has(recorded)) {
        return {
          diskExists: true,
          recomputedHash,
          status: 'rebaselined-codec',
        };
      }
    } else if (installation.kind === 'command') {
      const raw = await fs.promises.readFile(installation.path, 'utf-8');
      const curCmd =
        installation.assistant === 'kilo-code'
          ? parseKiloCommandMarkdown(raw, installation.name)
          : parseClaudeCommandMarkdown(raw, installation.name);
      const legCmd = parseClaudeCommandMarkdownPreD61fdd1(raw, installation.name);
      const candidates = new Set<string>([
        canonicalCommandHashPreNormalization(curCmd, true),
        canonicalCommandHashPreNormalization(curCmd, false),
        canonicalCommandHashPreNormalization(legCmd, true),
        canonicalCommandHashPreNormalization(legCmd, false),
      ]);
      if (candidates.has(recorded)) {
        return {
          diskExists: true,
          recomputedHash,
          status: 'rebaselined-codec',
        };
      }
    }
  } catch {
    // fall through to real-local-edit
  }

  return {
    diskExists: true,
    recomputedHash,
    status: 'real-local-edit',
  };
}

function isValidHistorySkillRelativePath(p: string): boolean {
  if (!p || p === '.' || p === 'SKILL.md') return false;
  if (path.isAbsolute(p)) return false;
  if (p.includes('\0')) return false;
  for (const seg of p.split('/')) {
    if (seg === '..') return false;
  }
  const resolved = path.posix.resolve('/root', p);
  return resolved.startsWith('/root/') && resolved !== '/root/SKILL.md' && resolved !== '/root';
}

function readGitBlobBuffer(
  repoDir: string,
  blobSha: string,
  blobCache: Map<string, Buffer>
): Promise<Buffer> {
  const key = `${repoDir}::${blobSha}`;
  const cached = blobCache.get(key);
  if (cached) {
    return Promise.resolve(cached);
  }
  return new Promise((resolve, reject) => {
    child_process.execFile(
      'git',
      ['cat-file', 'blob', blobSha],
      {
        cwd: repoDir,
        encoding: 'buffer',
        maxBuffer: 50 * 1024 * 1024,
        timeout: 30_000,
      },
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        blobCache.set(key, stdout);
        resolve(stdout);
      }
    );
  });
}

async function resolveGitHistoryPathAndRepo(
  source: Source,
  pkg: Package,
  artifact: Artifact,
  options: {
    homeRoot?: string;
    cacheDir?: string;
    gitCtxCache: Map<string, { repoPrefix: string; headCommit: string } | null>;
  }
): Promise<{ repoDir: string; repoRelPath: string; logPathSpec: string } | null> {
  const prefix = `${source.id}:`;
  const pathId = pkg.id.startsWith(prefix) ? pkg.id.slice(prefix.length) : '';

  if (source.type === 'local-folder') {
    if (!source.localPath || !fs.existsSync(source.localPath)) {
      return null;
    }
    const resolvedLocal = path.resolve(source.localPath);
    let gitCtx = options.gitCtxCache.get(resolvedLocal);
    if (gitCtx === undefined) {
      try {
        const { stdout: prefixOut } = await runGit(
          ['rev-parse', '--show-prefix'],
          resolvedLocal
        );
        const { stdout: headOut } = await runGit(['rev-parse', 'HEAD'], resolvedLocal);
        gitCtx = {
          repoPrefix: prefixOut.replace(/\r?\n$/, ''),
          headCommit: headOut.trim(),
        };
      } catch {
        gitCtx = null;
      }
      options.gitCtxCache.set(resolvedLocal, gitCtx);
    }
    if (!gitCtx) {
      return null;
    }

    let relFromSource = '';
    if (artifact.path) {
      const absArt = path.isAbsolute(artifact.path)
        ? artifact.path
        : path.join(resolvedLocal, artifact.path);
      relFromSource = path
        .relative(resolvedLocal, path.resolve(absArt))
        .split(path.sep)
        .join('/');
      if (artifact.kind === 'skill' && relFromSource.endsWith('/SKILL.md')) {
        relFromSource = relFromSource.slice(0, -'/SKILL.md'.length);
      } else if (artifact.kind === 'skill' && relFromSource === 'SKILL.md') {
        relFromSource = '';
      }
    } else if (artifact.kind === 'mcp-server') {
      relFromSource = pathId.split(':')[0];
    } else if (artifact.kind === 'skill') {
      if (pathId && fs.existsSync(path.join(resolvedLocal, pathId, 'SKILL.md'))) {
        relFromSource = pathId === '.' ? '' : pathId;
      } else {
        relFromSource = '';
      }
    } else {
      relFromSource = pathId;
    }

    if (relFromSource === '.') {
      relFromSource = '';
    }
    const repoRelPath =
      relFromSource === ''
        ? gitCtx.repoPrefix.replace(/\/$/, '')
        : `${gitCtx.repoPrefix}${relFromSource}`;
    const logPathSpec = relFromSource === '' ? '.' : relFromSource;

    return {
      repoDir: resolvedLocal,
      repoRelPath,
      logPathSpec,
    };
  }

  if (
    source.type === 'git-custom' ||
    source.type === 'git-marketplace' ||
    source.type === 'git-single-item'
  ) {
    const baseCacheDir =
      options.cacheDir ??
      path.join(options.homeRoot ?? os.homedir(), '.ai-swissknife', 'cache', 'sources');
    const { targetDir } = resolveAndValidateCacheDir(baseCacheDir, source.id, source.url);
    if (!fs.existsSync(path.join(targetDir, '.git'))) {
      return null;
    }
    const resolvedTarget = path.resolve(targetDir);

    if (source.type === 'git-single-item') {
      return {
        repoDir: resolvedTarget,
        repoRelPath: '',
        logPathSpec: '.',
      };
    }

    let repoRelPath = '';
    if (artifact.path) {
      const absArt = path.isAbsolute(artifact.path)
        ? artifact.path
        : path.join(resolvedTarget, artifact.path);
      const rel = path
        .relative(resolvedTarget, path.resolve(absArt))
        .split(path.sep)
        .join('/');
      if (!rel.startsWith('..')) {
        repoRelPath = rel;
        if (artifact.kind === 'skill' && repoRelPath.endsWith('/SKILL.md')) {
          repoRelPath = repoRelPath.slice(0, -'/SKILL.md'.length);
        } else if (artifact.kind === 'skill' && repoRelPath === 'SKILL.md') {
          repoRelPath = '';
        }
      }
    }

    if (!repoRelPath) {
      if (source.type === 'git-marketplace') {
        const pluginCandidates = pathId
          ? [
              `plugins/${pathId}`,
              pathId,
              '.',
            ]
          : ['.'];
        for (const pRoot of pluginCandidates) {
          const base = pRoot === '.' ? '' : `${pRoot}/`;
          if (artifact.kind === 'skill') {
            for (const cand of [`${base}skills/${artifact.name}`, `${base}${artifact.name}`]) {
              if (fs.existsSync(path.join(resolvedTarget, cand, 'SKILL.md'))) {
                repoRelPath = cand;
                break;
              }
            }
          } else if (artifact.kind === 'agent') {
            for (const cand of [`${base}agents/${artifact.name}.md`, `${base}${artifact.name}.md`]) {
              if (fs.existsSync(path.join(resolvedTarget, cand))) {
                repoRelPath = cand;
                break;
              }
            }
          } else if (artifact.kind === 'command') {
            for (const cand of [
              `${base}commands/${artifact.name}.md`,
              `${base}command/${artifact.name}.md`,
              `${base}${artifact.name}.md`,
            ]) {
              if (fs.existsSync(path.join(resolvedTarget, cand))) {
                repoRelPath = cand;
                break;
              }
            }
          } else if (artifact.kind === 'mcp-server') {
            for (const cand of [`${base}.mcp.json`, `${base}mcp.json`]) {
              if (fs.existsSync(path.join(resolvedTarget, cand))) {
                repoRelPath = cand;
                break;
              }
            }
          }
          if (repoRelPath) break;
        }
      } else {
        if (artifact.kind === 'skill') {
          if (pathId && fs.existsSync(path.join(resolvedTarget, pathId, 'SKILL.md'))) {
            repoRelPath = pathId === '.' ? '' : pathId;
          } else if (fs.existsSync(path.join(resolvedTarget, 'skills', artifact.name, 'SKILL.md'))) {
            repoRelPath = `skills/${artifact.name}`;
          } else {
            repoRelPath = '';
          }
        } else if (artifact.kind === 'mcp-server') {
          repoRelPath = pathId.split(':')[0];
        } else {
          repoRelPath = pathId;
        }
      }
    }

    if (repoRelPath === '.') {
      repoRelPath = '';
    }
    return {
      repoDir: resolvedTarget,
      repoRelPath,
      logPathSpec: repoRelPath === '' ? '.' : repoRelPath,
    };
  }

  return null;
}

async function readCanonicalArtifactAtCommit(
  repoDir: string,
  repoRelPath: string,
  commit: string,
  artifact: Artifact,
  caches: ProvenanceHistoryCaches
): Promise<
  CanonicalSkill | CanonicalAgent | CanonicalCommand | CanonicalMcpServer | CanonicalHook | CanonicalRule
> {
  const rawKey = `${repoDir}::${commit}::${artifact.kind}::${repoRelPath}::${artifact.name}`;
  const cachedRaw = caches.rawArtifactAtCommitCache.get(rawKey);
  if (cachedRaw) {
    return cachedRaw;
  }

  if (artifact.kind === 'skill') {
    const treeSpec = repoRelPath ? `${commit}:${repoRelPath}` : commit;
    const { stdout: lsOut } = await runGit(
      ['ls-tree', '--full-tree', '-r', '-z', treeSpec],
      repoDir
    );
    const entries = lsOut.split('\0').filter((e) => e.length > 0);
    let skillMdBlobSha: string | undefined;
    const fileEntries: Array<{ relPath: string; blobSha: string; mode: number }> = [];

    for (const entry of entries) {
      const match = entry.match(/^([0-7]+) (\w+) ([0-9a-f]{40})\t([\s\S]+)$/);
      if (!match) continue;
      const [, modeStr, objType, blobSha, relPath] = match;
      const segments = relPath.split('/');
      if (segments.some(isIgnoredHistorySkillSegment)) {
        continue;
      }
      if (modeStr === '120000' || objType !== 'blob') {
        throw new Error(`Unsupported file type at ${relPath}`);
      }
      if (relPath === 'SKILL.md') {
        skillMdBlobSha = blobSha;
        continue;
      }
      if (!isValidHistorySkillRelativePath(relPath)) {
        throw new Error(`Invalid path: ${relPath}`);
      }
      fileEntries.push({
        relPath,
        blobSha,
        mode: parseInt(modeStr, 8),
      });
    }

    if (!skillMdBlobSha) {
      throw new Error(`SKILL.md not found in ${treeSpec}`);
    }

    const skillMdBuf = await readGitBlobBuffer(repoDir, skillMdBlobSha, caches.blobCache);
    const doc = parseSkillMarkdown(skillMdBuf.toString('utf-8'));

    const files: CanonicalSkillFile[] = [];
    const seenPaths = new Set<string>();
    for (const f of fileEntries) {
      const norm = path.posix.normalize(f.relPath);
      if (seenPaths.has(norm)) {
        throw new Error(`Duplicate normalized path: ${norm}`);
      }
      seenPaths.add(norm);
      const buf = await readGitBlobBuffer(repoDir, f.blobSha, caches.blobCache);
      files.push({
        path: f.relPath,
        content: buf,
        mode: f.mode,
      });
    }

    const skill: CanonicalSkill = {
      ...doc,
      files,
    };
    caches.rawArtifactAtCommitCache.set(rawKey, skill);
    return skill;
  }

  const objectSpec = `${commit}:${repoRelPath}`;
  const { stdout: rawContent } = await runGit(['show', objectSpec], repoDir);

  if (artifact.kind === 'agent') {
    const agent = parseClaudeAgentMarkdown(rawContent);
    caches.rawArtifactAtCommitCache.set(rawKey, agent);
    return agent;
  }

  if (artifact.kind === 'command') {
    const command = parseClaudeCommandMarkdown(rawContent, artifact.name);
    caches.rawArtifactAtCommitCache.set(rawKey, command);
    return command;
  }

  if (artifact.kind === 'mcp-server') {
    const parsed = JSON.parse(rawContent);
    const serverConfig = (parsed.mcpServers?.[artifact.name] ??
      parsed.mcp?.[artifact.name] ??
      (parsed.command || parsed.url ? parsed : {})) as Record<string, unknown>;
    const extraFields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(serverConfig)) {
      if (!['id', 'type', 'command', 'args', 'url', 'env', 'headers'].includes(k)) {
        extraFields[k] = v;
      }
    }
    const mcp: CanonicalMcpServer = {
      id: artifact.name,
      type:
        (serverConfig.type as 'stdio' | 'http' | 'sse') ??
        (serverConfig.command ? 'stdio' : 'sse'),
      ...(serverConfig.command ? { command: String(serverConfig.command) } : {}),
      ...(Array.isArray(serverConfig.args) ? { args: serverConfig.args.map(String) } : {}),
      ...(serverConfig.url ? { url: String(serverConfig.url) } : {}),
      ...(serverConfig.env ? { env: serverConfig.env as Record<string, string> } : {}),
      ...(serverConfig.headers
        ? { headers: serverConfig.headers as Record<string, string> }
        : {}),
      extraFields,
    };
    caches.rawArtifactAtCommitCache.set(rawKey, mcp);
    return mcp;
  }

  if (artifact.kind === 'hook') {
    const parsed = JSON.parse(rawContent);
    const hook: CanonicalHook = {
      name: artifact.name,
      event: parsed.event ?? 'PreToolUse',
      command: parsed.command ?? '',
      timeout: parsed.timeout,
      extraFields: { ...parsed },
    };
    caches.rawArtifactAtCommitCache.set(rawKey, hook);
    return hook;
  }

  const rule: CanonicalRule = {
    name: artifact.name,
    content: rawContent,
  };
  caches.rawArtifactAtCommitCache.set(rawKey, rule);
  return rule;
}

function translateCanonicalArtifactForAssistant(
  kind: Artifact['kind'],
  rawContent:
    | CanonicalSkill
    | CanonicalAgent
    | CanonicalCommand
    | CanonicalMcpServer
    | CanonicalHook
    | CanonicalRule,
  assistant: AssistantId
): unknown {
  switch (kind) {
    case 'skill': {
      const tr = translateSkill(rawContent as CanonicalSkill, assistant);
      if (tr.overall === 'unsupported') throw new Error('Unsupported translation');
      return tr.value;
    }
    case 'agent': {
      const tr = translateAgent(rawContent as CanonicalAgent, assistant);
      if (tr.overall === 'unsupported') throw new Error('Unsupported translation');
      return tr.value;
    }
    case 'command': {
      const tr = translateCommand(rawContent as CanonicalCommand, assistant);
      if (tr.overall === 'unsupported') throw new Error('Unsupported translation');
      return tr.value;
    }
    case 'mcp-server': {
      const tr = translateMcpServer(rawContent as CanonicalMcpServer, assistant);
      if (tr.overall === 'unsupported') throw new Error('Unsupported translation');
      return tr.value;
    }
    case 'hook': {
      const tr = translateHook(rawContent as CanonicalHook, assistant);
      if (tr.overall === 'unsupported') throw new Error('Unsupported translation');
      return tr.value;
    }
    case 'rule': {
      const tr = translateRule(rawContent as CanonicalRule, assistant);
      if (tr.overall === 'unsupported') throw new Error('Unsupported translation');
      return tr.value;
    }
  }
}

async function hashArtifactAtCommit(
  sourceKey: string,
  repoDir: string,
  repoRelPath: string,
  commit: string,
  artifact: Artifact,
  assistant: AssistantId,
  caches: ProvenanceHistoryCaches
): Promise<string> {
  const cacheKey = `${sourceKey}::${commit}::${artifact.id}::${assistant}`;
  const cached = caches.translationHashCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const raw = await readCanonicalArtifactAtCommit(
    repoDir,
    repoRelPath,
    commit,
    artifact,
    caches
  );
  const translated = translateCanonicalArtifactForAssistant(artifact.kind, raw, assistant);
  const hash = computeCanonicalHash(artifact.kind, translated);
  caches.translationHashCache.set(cacheKey, hash);
  return hash;
}

async function getHistoryCommitsForArtifact(
  repoDir: string,
  repoRelPath: string,
  logPathSpec: string,
  artifactKind: Artifact['kind'],
  fallbackHeadCommit: string | undefined,
  installationPackageId: string | undefined,
  sourceId: string,
  caches: ProvenanceHistoryCaches
): Promise<Array<{ commit: string; relPath: string }>> {
  const prefix = `${sourceId}:`;
  const legacyRelPath =
    installationPackageId && installationPackageId.startsWith(prefix)
      ? installationPackageId.slice(prefix.length)
      : '';
  const hasDistinctLegacyPath =
    Boolean(legacyRelPath) &&
    legacyRelPath.includes('/') &&
    legacyRelPath !== repoRelPath &&
    legacyRelPath !== logPathSpec;

  const logKey = `${repoDir}::${repoRelPath}::${logPathSpec}::${hasDistinctLegacyPath ? legacyRelPath : ''}`;
  const cached = caches.gitLogCache.get(logKey);
  if (cached) {
    return cached;
  }

  const entries: Array<{ commit: string; relPath: string }> = [];
  const seen = new Set<string>();
  const addEntry = (commit: string, relPath: string) => {
    const k = `${commit}::${relPath}`;
    if (!seen.has(k) && entries.length < MAX_HISTORY_COMMITS) {
      seen.add(k);
      entries.push({ commit, relPath });
    }
  };

  try {
    const { stdout } = await runGit(
      ['log', '--format=%H', '-n', String(MAX_HISTORY_COMMITS), '--', logPathSpec],
      repoDir
    );
    for (const line of stdout.trim().split(/\r?\n/)) {
      const c = line.trim();
      if (c) addEntry(c, repoRelPath);
    }
  } catch {
    // ignore
  }

  // For skills, also follow SKILL.md across directory/plugin moves (up to 200 commits total)
  if (artifactKind === 'skill' && entries.length < MAX_HISTORY_COMMITS) {
    const skillMdSpec =
      logPathSpec === '.' || logPathSpec === '' ? 'SKILL.md' : `${logPathSpec}/SKILL.md`;
    try {
      const { stdout } = await runGit(
        [
          'log',
          '--follow',
          '--name-only',
          '--format=COMMIT:%H',
          '-n',
          String(MAX_HISTORY_COMMITS),
          '--',
          skillMdSpec,
        ],
        repoDir
      );
      let currentCommit: string | undefined;
      for (const line of stdout.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        if (t.startsWith('COMMIT:')) {
          currentCommit = t.slice('COMMIT:'.length).trim();
        } else if (currentCommit && t.endsWith('/SKILL.md')) {
          const dirAtCommit = t.slice(0, -'/SKILL.md'.length);
          addEntry(currentCommit, dirAtCommit);
        } else if (currentCommit && t === 'SKILL.md') {
          addEntry(currentCommit, '');
        }
      }
    } catch {
      // ignore
    }
  }

  if (hasDistinctLegacyPath && entries.length < MAX_HISTORY_COMMITS) {
    try {
      const { stdout } = await runGit(
        ['log', '--format=%H', '-n', String(MAX_HISTORY_COMMITS), '--', legacyRelPath],
        repoDir
      );
      for (const line of stdout.trim().split(/\r?\n/)) {
        const c = line.trim();
        if (c) addEntry(c, legacyRelPath);
      }
    } catch {
      // ignore
    }
  }

  if (entries.length === 0 && fallbackHeadCommit) {
    addEntry(fallbackHeadCommit, repoRelPath);
  }

  caches.gitLogCache.set(logKey, entries);
  return entries;
}

async function computeLegacyHashesAtSkillCommit(
  repoDir: string,
  repoRelPath: string,
  commit: string,
  assistant: AssistantId,
  caches: ProvenanceHistoryCaches
): Promise<Set<string>> {
  const legKey = `${repoDir}::${commit}::${repoRelPath}::${assistant}`;
  const cached = caches.legacyCommitHashesCache.get(legKey);
  if (cached) {
    return cached;
  }
  const treeSpec = repoRelPath ? `${commit}:${repoRelPath}` : commit;
  const { stdout: lsOut } = await runGit(
    ['ls-tree', '--full-tree', '-r', '-z', treeSpec],
    repoDir
  );
  const entries = lsOut.split('\0').filter((e) => e.length > 0);
  let skillMdBlobSha: string | undefined;
  const allFiles: CanonicalSkillFile[] = [];

  for (const entry of entries) {
    const match = entry.match(/^([0-7]+) (\w+) ([0-9a-f]{40})\t([\s\S]+)$/);
    if (!match) continue;
    const [, modeStr, objType, blobSha, relPath] = match;
    if (modeStr === '120000' || objType !== 'blob') continue;
    if (relPath === 'SKILL.md') {
      skillMdBlobSha = blobSha;
      continue;
    }
    const buf = await readGitBlobBuffer(repoDir, blobSha, caches.blobCache);
    allFiles.push({
      path: relPath,
      content: buf,
      mode: parseInt(modeStr, 8),
    });
  }

  if (!skillMdBlobSha) {
    const empty = new Set<string>();
    caches.legacyCommitHashesCache.set(legKey, empty);
    return empty;
  }

  const skillMdBuf = await readGitBlobBuffer(repoDir, skillMdBlobSha, caches.blobCache);
  const hashes = computePreNormalizationSkillHashes(
    skillMdBuf.toString('utf-8'),
    allFiles,
    assistant
  );
  caches.legacyCommitHashesCache.set(legKey, hashes);
  return hashes;
}

async function findInstallCommitInHistory(
  source: Source,
  effectiveCandidate: Source,
  pkg: Package,
  artifact: Artifact,
  installation: ManagedInstallation,
  targetHash: string | undefined,
  options: {
    homeRoot?: string;
    cacheDir?: string;
    caches: ProvenanceHistoryCaches;
    recordedLegacyHash?: string;
    recomputedDiskHash?: string;
  }
): Promise<{
  matchedHash: boolean;
  commit?: string;
  sourceHash?: string;
  rebaselinedByCommit?: boolean;
}> {
  if (!targetHash) {
    return { matchedHash: false };
  }

  const sourceKey = sourceResolutionKey(effectiveCandidate);
  const gitInfo = await resolveGitHistoryPathAndRepo(
    effectiveCandidate,
    pkg,
    artifact,
    {
      homeRoot: options.homeRoot,
      cacheDir: options.cacheDir,
      gitCtxCache: options.caches.gitCtxCache,
    }
  );

  if (!gitInfo) {
    // Non-git source (e.g. plain local-folder): compare against current content hash
    const hashKey = `${sourceKey}::CURRENT::${pkg.id}::${artifact.id}::${installation.assistant}`;
    let currentHash = options.caches.translationHashCache.get(hashKey);
    if (currentHash === undefined) {
      const { translated } = await resolveAndTranslate(
        effectiveCandidate,
        pkg,
        artifact,
        installation.assistant,
        {
          homeRoot: options.homeRoot,
          cacheDir: options.cacheDir,
        }
      );
      currentHash = computeCanonicalHash(artifact.kind, translated);
      options.caches.translationHashCache.set(hashKey, currentHash);
    }
    return {
      matchedHash: currentHash === targetHash,
      commit: pkg.version?.commit,
      sourceHash: currentHash,
    };
  }

  const commitEntries = await getHistoryCommitsForArtifact(
    gitInfo.repoDir,
    gitInfo.repoRelPath,
    gitInfo.logPathSpec,
    artifact.kind,
    pkg.version?.commit,
    installation.packageId,
    source.id,
    options.caches
  );

  for (const { commit, relPath } of commitEntries) {
    try {
      const h = await hashArtifactAtCommit(
        `${sourceKey}::${relPath}`,
        gitInfo.repoDir,
        relPath,
        commit,
        artifact,
        installation.assistant,
        options.caches
      );
      if (h === targetHash) {
        return {
          matchedHash: true,
          commit,
          sourceHash: h,
        };
      }
    } catch {
      // Artifact may not exist or be valid at an older rename/commit; continue walking history
    }
  }

  // If the recorded hash was computed with the pre-normalization codec at a commit in history:
  // - If `recomputedDiskHash` equals that commit's current-codec hash, it is a codec rebaseline!
  // - If `recomputedDiskHash` differs from that commit's current-codec hash, it is a real local edit
  //   made on top of that install commit (so we still recover `commit` and its normalized `sourceHash`!).
  const legacyTarget = options.recordedLegacyHash ?? targetHash;
  if (artifact.kind === 'skill' && legacyTarget) {
    for (const { commit, relPath } of commitEntries) {
      try {
        const legHashes = await computeLegacyHashesAtSkillCommit(
          gitInfo.repoDir,
          relPath,
          commit,
          installation.assistant,
          options.caches
        );
        if (legHashes.has(legacyTarget)) {
          const curCommitHash = await hashArtifactAtCommit(
            `${sourceKey}::${relPath}`,
            gitInfo.repoDir,
            relPath,
            commit,
            artifact,
            installation.assistant,
            options.caches
          );
          const isRebaseline =
            options.recomputedDiskHash !== undefined &&
            curCommitHash === options.recomputedDiskHash;
          return {
            matchedHash: true,
            commit,
            sourceHash: curCommitHash,
            rebaselinedByCommit: isRebaseline,
          };
        }
      } catch {
        // continue
      }
    }
  }

  return { matchedHash: false };
}

/**
 * Evaluates candidate sources for a legacy installation that lacks `installation.source`:
 * 1. Single candidate containing the artifact (exact `artifactId` or 49.3 id-shape conversion):
 *    adopts that source identity even if the current content hash differs, then walks up to 200
 *    git commits of the artifact to recover `sourceRevision.commit` and `sourceContentHash`
 *    (leaving them unset when not found so normal content comparison reports `update-available`).
 * 2. Multiple candidates (same `sourceId` in both scopes): adopts the unique candidate whose
 *    git history (or current content) contains `installation.contentHash`; if both or neither
 *    match, returns `provenance-unknown` with `reason: 'ambiguous-source'` and both candidates in `hint`.
 * 3. `source-not-in-manifest` and `artifact-not-in-source` remain `provenance-unknown`.
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
    historyCaches?: ProvenanceHistoryCaches;
  }
): Promise<ProvenanceEvaluationResult> {
  if (!installation.sourceId) {
    const rb = await checkInstallationHashRebaseline(installation, options?.homeRoot);
    return {
      outcome: 'unknown',
      reason: 'no-source-id',
      ...(rb.status === 'rebaselined-codec'
        ? { rebaselined: 'codec' as const, recomputedContentHash: rb.recomputedHash }
        : rb.status === 'real-local-edit'
          ? { realLocalEdit: true }
          : {}),
      details: `No sourceId recorded for "${installation.name}" — re-link to a source or reinstall.`,
    };
  }

  const candidates = allSources.filter((s) => s.id === installation.sourceId);
  if (candidates.length === 0) {
    const rb = await checkInstallationHashRebaseline(installation, options?.homeRoot);
    return {
      outcome: 'unknown',
      reason: 'source-not-in-manifest',
      ...(rb.status === 'rebaselined-codec'
        ? { rebaselined: 'codec' as const, recomputedContentHash: rb.recomputedHash }
        : rb.status === 'real-local-edit'
          ? { realLocalEdit: true }
          : {}),
      details: `Source "${installation.sourceId}" is not registered in global or workspace manifest — re-link to a source or reinstall.`,
    };
  }

  const preResolved =
    options?.preResolved ?? new Map<string, { resolution?: SourceResolution; error?: Error }>();
  const caches = options?.historyCaches ?? createProvenanceHistoryCaches();
  if (options?.hashCache) {
    caches.translationHashCache = options.hashCache;
  }

  let needsFetch = false;
  const candidatesWithArtifact: Array<{
    source: Source;
    effectiveCandidate: Source;
    pkg: Package;
    artifact: Artifact;
  }> = [];

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

    candidatesWithArtifact.push({
      source: candidate,
      effectiveCandidate,
      pkg: matched.pkg,
      artifact: matched.artifact,
    });
  }

  const candidateSkillDirs = candidatesWithArtifact
    .map((c) => c.artifact.path)
    .filter((p): p is string => Boolean(p));
  const rebaselineRes = await checkInstallationHashRebaseline(
    installation,
    options?.homeRoot,
    candidateSkillDirs
  );
  let rebaselined: 'codec' | undefined =
    rebaselineRes.status === 'rebaselined-codec' ? 'codec' : undefined;
  let realLocalEdit: boolean | undefined =
    rebaselineRes.status === 'real-local-edit' ? true : undefined;
  let recomputedContentHash: string | undefined =
    rebaselineRes.status === 'rebaselined-codec'
      ? rebaselineRes.recomputedHash
      : undefined;
  const effectiveSearchHash =
    rebaselineRes.status === 'rebaselined-codec'
      ? rebaselineRes.recomputedHash
      : installation.contentHash;

  if (needsFetch) {
    return {
      outcome: 'unknown',
      reason: 'needs-fetch',
      ...(rebaselined ? { rebaselined, recomputedContentHash } : {}),
      ...(realLocalEdit ? { realLocalEdit } : {}),
      hint: 'check sources to resolve',
      details: `Source "${installation.sourceId}" needs a fetch to verify provenance — check sources to resolve.`,
    };
  }

  if (candidatesWithArtifact.length === 0) {
    return {
      outcome: 'unknown',
      reason: 'artifact-not-in-source',
      ...(rebaselined ? { rebaselined, recomputedContentHash } : {}),
      ...(realLocalEdit ? { realLocalEdit } : {}),
      details: `Artifact "${installation.artifactId ?? installation.name}" not found in source "${installation.sourceId}" — re-link to a source or reinstall.`,
    };
  }

  // Case 1: Single candidate source with that sourceId across both scopes, and it contains the artifact
  if (candidates.length === 1 && candidatesWithArtifact.length === 1) {
    const single = candidatesWithArtifact[0];
    const historyRes = await findInstallCommitInHistory(
      single.source,
      single.effectiveCandidate,
      single.pkg,
      single.artifact,
      installation,
      effectiveSearchHash,
      {
        homeRoot: options?.homeRoot,
        cacheDir: options?.cacheDir,
        caches,
        recordedLegacyHash: installation.contentHash,
        recomputedDiskHash: rebaselineRes.recomputedHash,
      }
    );

    if (historyRes.rebaselinedByCommit && rebaselineRes.recomputedHash) {
      rebaselined = 'codec';
      realLocalEdit = undefined;
      recomputedContentHash = rebaselineRes.recomputedHash;
    }

    const finalInstalledHash =
      rebaselined && recomputedContentHash
        ? recomputedContentHash
        : installation.contentHash;

    if (historyRes.matchedHash && historyRes.commit) {
      return {
        outcome: 'adopted',
        adoptionMode: 'adopted-with-commit',
        ...(rebaselined ? { rebaselined, recomputedContentHash } : {}),
        ...(realLocalEdit ? { realLocalEdit } : {}),
        match: {
          source: single.source,
          pkg: single.pkg,
          artifact: single.artifact,
          sourceHash: historyRes.sourceHash,
          revision: {
            commit: historyRes.commit,
            ...(single.pkg.version?.requestedRef
              ? { requestedRef: single.pkg.version.requestedRef }
              : {}),
          },
          sourceContentHash: historyRes.sourceHash ?? finalInstalledHash,
        },
      };
    }

    if (historyRes.matchedHash && !historyRes.commit) {
      return {
        outcome: 'adopted',
        adoptionMode: 'adopted-source-only',
        ...(rebaselined ? { rebaselined, recomputedContentHash } : {}),
        ...(realLocalEdit ? { realLocalEdit } : {}),
        match: {
          source: single.source,
          pkg: single.pkg,
          artifact: single.artifact,
          sourceHash: historyRes.sourceHash,
          revision: undefined,
          sourceContentHash: historyRes.sourceHash ?? finalInstalledHash,
        },
      };
    }

    // Single candidate whose current content and 200-commit history do not match contentHash:
    // adopt source identity, leave sourceRevision empty and sourceContentHash unset.
    return {
      outcome: 'adopted',
      adoptionMode: 'adopted-source-only',
      ...(rebaselined ? { rebaselined, recomputedContentHash } : {}),
      ...(realLocalEdit ? { realLocalEdit } : {}),
      match: {
        source: single.source,
        pkg: single.pkg,
        artifact: single.artifact,
        revision: undefined,
        sourceContentHash: undefined,
      },
    };
  }

  // Case 2: Multiple candidates with the same sourceId in both scopes
  const formatCandidatesHint = (cands: Source[]): string => {
    const labels = cands.map((c) => {
      const sc = c.scope === 'project' ? 'workspace' : 'global';
      const loc = c.type === 'local-folder' ? (c.localPath ?? '') : (c.url ?? '');
      return `${sc}:${c.id} (${loc})`;
    });
    return `candidates: ${labels.join(', ')}`;
  };

  if (!effectiveSearchHash) {
    const hint = formatCandidatesHint(candidates);
    return {
      outcome: 'unknown',
      reason: 'ambiguous-source',
      ...(rebaselined ? { rebaselined, recomputedContentHash } : {}),
      ...(realLocalEdit ? { realLocalEdit } : {}),
      hint,
      details: `Ambiguous source "${installation.sourceId}" for "${installation.name}" (${hint}) — re-link to a source or reinstall.`,
    };
  }

  const historyMatches: Array<{
    source: Source;
    pkg: Package;
    artifact: Artifact;
    commit?: string;
    sourceHash?: string;
    rebaselinedByCommit?: boolean;
  }> = [];

  for (const cand of candidatesWithArtifact) {
    const historyRes = await findInstallCommitInHistory(
      cand.source,
      cand.effectiveCandidate,
      cand.pkg,
      cand.artifact,
      installation,
      effectiveSearchHash,
      {
        homeRoot: options?.homeRoot,
        cacheDir: options?.cacheDir,
        caches,
        recordedLegacyHash: installation.contentHash,
        recomputedDiskHash: rebaselineRes.recomputedHash,
      }
    );
    if (historyRes.matchedHash) {
      historyMatches.push({
        source: cand.source,
        pkg: cand.pkg,
        artifact: cand.artifact,
        commit: historyRes.commit,
        sourceHash: historyRes.sourceHash,
        rebaselinedByCommit: historyRes.rebaselinedByCommit,
      });
    }
  }

  if (historyMatches.length === 1) {
    const winner = historyMatches[0];
    if (winner.rebaselinedByCommit && rebaselineRes.recomputedHash) {
      rebaselined = 'codec';
      realLocalEdit = undefined;
      recomputedContentHash = rebaselineRes.recomputedHash;
    }
    const finalInstalledHash =
      rebaselined && recomputedContentHash
        ? recomputedContentHash
        : installation.contentHash;
    return {
      outcome: 'adopted',
      adoptionMode: winner.commit ? 'adopted-with-commit' : 'adopted-source-only',
      ...(rebaselined ? { rebaselined, recomputedContentHash } : {}),
      ...(realLocalEdit ? { realLocalEdit } : {}),
      match: {
        source: winner.source,
        pkg: winner.pkg,
        artifact: winner.artifact,
        sourceHash: winner.sourceHash,
        revision: winner.commit
          ? {
              commit: winner.commit,
              ...(winner.pkg.version?.requestedRef
                ? { requestedRef: winner.pkg.version.requestedRef }
                : {}),
            }
          : undefined,
        sourceContentHash: winner.sourceHash ?? finalInstalledHash,
      },
    };
  }

  const hint = formatCandidatesHint(candidates);
  return {
    outcome: 'unknown',
    reason: 'ambiguous-source',
    ...(rebaselined ? { rebaselined, recomputedContentHash } : {}),
    ...(realLocalEdit ? { realLocalEdit } : {}),
    hint,
    details: `Ambiguous source "${installation.sourceId}" for "${installation.name}" (${hint}) — re-link to a source or reinstall.`,
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
  let hashChanged = false;
  if (evalResult.rebaselined === 'codec') {
    inst.rebaselined = 'codec';
  }
  if (evalResult.rebaselined === 'codec' && evalResult.recomputedContentHash) {
    if (inst.contentHash !== evalResult.recomputedContentHash) {
      inst.contentHash = evalResult.recomputedContentHash;
      hashChanged = true;
    }
  }

  if (evalResult.outcome === 'adopted') {
    const { source, pkg, artifact, revision, sourceContentHash } = evalResult.match;
    inst.source = toInstallationSourceIdentity(source, homeRoot);
    inst.sourceId = source.id;
    inst.packageId = pkg.id;
    inst.artifactId = artifact.id;
    if (revision?.commit) {
      inst.sourceRevision = {
        commit: revision.commit,
        ...(revision.requestedRef ? { requestedRef: revision.requestedRef } : {}),
      };
    } else {
      delete inst.sourceRevision;
    }
    if (sourceContentHash !== undefined) {
      inst.sourceContentHash = sourceContentHash;
    } else {
      delete inst.sourceContentHash;
    }
    delete inst.provenance;
    delete inst.provenanceReason;
    delete inst.provenanceHint;
    return true;
  }

  const changed =
    hashChanged ||
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

  const historyCaches = createProvenanceHistoryCaches();

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
            historyCaches,
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
