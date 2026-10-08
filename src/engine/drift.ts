import * as fs from 'fs';
import type { ManagedInstallation, Source } from '../domain/types';
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

  if (installation.contentHash && diskHash !== installation.contentHash) {
    return {
      installation,
      status: 'modified-locally',
      diskHash,
      details: 'Local content differs from installed version',
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
      cacheDir ? { cacheDir } : undefined
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
        diskHash: localReport.diskHash,
        sourceHash,
        details: 'Local files were modified and upstream source has a newer version',
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

function findSourceInSources(
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

/**
 * Checks drift for all given installations against the provided sources.
 * Resolves each source ONCE per run (with concurrency 1 per source, and sources running
 * in parallel up to a bound of 4).
 * A failing source marks only its own installations as failed, never aborting the run.
 */
export async function checkDriftForAll(
  installations: ManagedInstallation[],
  sources: Source[] | ReadonlyMap<string, Source> | Map<string, Source>,
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

  // 1. Identify unique sources needed by the installations
  const neededSources = new Map<string, Source>();
  for (const inst of installations) {
    if (inst.sourceId && !neededSources.has(inst.sourceId)) {
      const src = findSourceInSources(sources, inst.sourceId);
      if (src) {
        neededSources.set(inst.sourceId, src);
      }
    }
  }

  // 2. Resolve each source once, with concurrency up to 4
  const sourcesToResolve: Source[] = [];
  for (const src of neededSources.values()) {
    if (!resolutions.has(src.id)) {
      sourcesToResolve.push(src);
    }
  }

  let nextIdx = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, sourcesToResolve.length) },
    async () => {
      while (nextIdx < sourcesToResolve.length) {
        const src = sourcesToResolve[nextIdx++];
        try {
          const resolver = getSourceResolver(src.type);
          const resolution = await resolver.resolve(src, {
            homeRoot,
            cacheDir: opts?.resolverOpts?.cacheDir,
          });
          resolutions.set(src.id, { resolution });
        } catch (err: unknown) {
          const error = err instanceof Error ? err : new Error(String(err));
          resolutions.set(src.id, { error });
        }
      }
    }
  );

  await Promise.all(workers);

  // 3. Check drift for each installation
  const reports = await Promise.all(
    installations.map(async (inst) => {
      const src = inst.sourceId ? neededSources.get(inst.sourceId) : undefined;
      if (!src) {
        return analyzeLocalDrift(inst, homeRoot);
      }
      const resEntry = resolutions.get(src.id);
      return checkForUpstreamUpdate(inst, src, homeRoot, {
        resolution: resEntry?.resolution,
        resolutionError: resEntry?.error,
        resolverOpts: opts?.resolverOpts,
      });
    })
  );

  return reports;
}
