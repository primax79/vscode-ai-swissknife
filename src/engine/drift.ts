import * as fs from 'fs';
import * as path from 'path';
import { toInstallationSourceIdentity, type ManagedInstallation, type Source } from '../domain/types';
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
import { resolveAndTranslate } from './plan';
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
  | { unavailable: string; hint?: string };

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

  const sourceId = installation.sourceId;
  if (!sourceId) {
    return {
      unavailable: `No source ID recorded for "${installation.name}".`,
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

  // Find matching package & artifact in resolution
  let foundPkg;
  let foundArt;

  for (const pkg of resolution.packages) {
    for (const art of pkg.artifacts) {
      if (
        (installation.artifactId && art.id === installation.artifactId) ||
        (art.kind === installation.kind && art.name === installation.name)
      ) {
        foundPkg = pkg;
        foundArt = art;
        break;
      }
    }
    if (foundArt) break;
  }

  if (!foundPkg || !foundArt) {
    return localReport;
  }

  let sourceHash: string | undefined;
  try {
    const cacheDir =
      effectiveOpts && 'resolverOpts' in effectiveOpts
        ? (effectiveOpts as CheckForUpstreamUpdateOptions).resolverOpts?.cacheDir
        : undefined;
    const result = await resolveAndTranslate(
      source,
      foundPkg,
      foundArt,
      installation.assistant,
      { cacheDir, homeRoot: effectiveHomeRoot }
    );

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
  } catch {
    return localReport;
  }

  if (sourceHash && installation.contentHash && sourceHash !== installation.contentHash) {
    if (localReport.status === 'modified-locally') {
      return {
        installation,
        status: 'modified-and-update-available',
        hasLocalPatch: localReport.hasLocalPatch,
        diskHash: localReport.diskHash,
        sourceHash,
        details: localReport.hasLocalPatch
          ? 'Upstream source has a newer version and local adaptation patch is applied'
          : 'Local files were modified and upstream source has a newer version',
      };
    }
    return {
      installation,
      status: 'update-available',
      diskHash: localReport.diskHash,
      sourceHash,
      details: 'A newer version is available from upstream source',
    };
  }

  return {
    ...localReport,
    sourceHash,
  };
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
    }
  }

  // 2. Resolve each source once, with concurrency up to 4
  const sourcesToResolve: Array<{ key: string; src: Source }> = [];
  for (const [key, src] of neededSources.entries()) {
    if (!resolutions.has(key) && !resolutions.has(src.id)) {
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
          resolutions.set(src.id, { resolution });
        } catch (err: unknown) {
          const error = err instanceof Error ? err : new Error(String(err));
          resolutions.set(key, { error });
          resolutions.set(src.id, { error });
        }
      }
    }
  );

  await Promise.all(workers);

  // 3. Check drift for each installation
  const reports = await Promise.all(
    installations.map(async (inst) => {
      const resolvedSrc = instResolutions.get(inst);
      if (!resolvedSrc) {
        return analyzeLocalDrift(inst, homeRoot);
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
            details: resolvedSrc.hint
              ? `${resolvedSrc.unavailable} ${resolvedSrc.hint}`
              : resolvedSrc.unavailable,
            ...(resolvedSrc.hint ? { hint: resolvedSrc.hint } : {}),
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
