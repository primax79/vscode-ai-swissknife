import * as fs from 'fs';
import * as path from 'path';
import type {
  AssistantId,
  ItemKind,
  Scope,
  Source,
  ManagedInstallation,
  ObservedArtifact,
} from '../domain/types';
import {
  readManifest,
  readState,
  fromDesiredSource,
} from '../domain/registry';
import { ALL_ADAPTERS, getAdapterWithHomeRoot, getAdapter } from '../adapters/registry';
import { getSourceResolver } from '../sources/registry';
import { scanInstalledInventory } from '../engine/discovery';
import { checkForUpstreamUpdate, analyzeLocalDrift } from '../engine/drift';
import { planInstallMatrix } from '../engine/installMatrix';
import { resolveAndTranslate } from '../engine/plan';
import { findWorkspaces, scanInventoryAcrossRoots } from '../engine/scanRoots';
import { serializeSkillMarkdown } from '../adapters/claude';
import { readSkill } from '../adapters/codec';
import type { CanonicalSkill } from '../adapters/types';
import { CliError } from './output';
import { createUnifiedDiff } from './diff';
import { refuseCodeKinds } from './gates';
export { requireWrite, refuseCodeKinds } from './gates';
import {
  planRedistribute,
  applyRedistribute,
  sanitizeTarget,
  type RedistributePlan,
  type RedistributeResult,
} from '../engine/redistribute';
import type {
  GlobalCliOptions,
  CliSource,
  CatalogResult,
  CatalogArtifact,
  CatalogDiagnostic,
  CliInstalledItem,
  CliInstalledRootsResult,
  CliUpdateItem,
  CliItemDetail,
  CliPlanInstallSummary,
} from './types';

const VALID_KINDS: readonly ItemKind[] = [
  'skill',
  'agent',
  'command',
  'mcp-server',
  'hook',
  'rule',
];

const VALID_SCOPES: readonly Scope[] = ['global', 'project'];

function parseScanOptions(opts: GlobalCliOptions): {
  maxDepth?: number;
  ignore?: string[];
  extraIgnore?: string[];
} {
  return {
    maxDepth:
      opts.maxDepth !== undefined
        ? parseInt(String(opts.maxDepth), 10)
        : undefined,
    ignore: opts.ignore
      ? Array.isArray(opts.ignore)
        ? opts.ignore
        : [opts.ignore]
      : undefined,
    extraIgnore: opts.extraIgnore
      ? Array.isArray(opts.extraIgnore)
        ? opts.extraIgnore
        : [opts.extraIgnore]
      : undefined,
  };
}

function resolveRoots(opts: GlobalCliOptions): { homeRoot?: string; workspaceRoot: string } {
  const homeRoot = opts.home ? path.resolve(opts.home) : undefined;
  const workspaceRoot = opts.workspace ? path.resolve(opts.workspace) : process.cwd();
  return { homeRoot, workspaceRoot };
}

function parseAssistantFilter(raw?: string): AssistantId[] | undefined {
  if (!raw) return undefined;
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const validIds = ALL_ADAPTERS.map((a) => a.assistant);
  for (const id of ids) {
    if (!validIds.includes(id as AssistantId)) {
      throw new CliError(
        'INVALID_ARGUMENT',
        `Invalid assistant "${id}". Supported assistants: ${validIds.join(', ')}`
      );
    }
  }
  return ids as AssistantId[];
}

function validateKind(kind?: string): ItemKind | undefined {
  if (!kind) return undefined;
  if (!VALID_KINDS.includes(kind as ItemKind)) {
    throw new CliError(
      'INVALID_ARGUMENT',
      `Invalid kind "${kind}". Supported kinds: ${VALID_KINDS.join(', ')}`
    );
  }
  return kind as ItemKind;
}

function validateScope(scope?: string): Scope | undefined {
  if (!scope) return undefined;
  if (!VALID_SCOPES.includes(scope as Scope)) {
    throw new CliError(
      'INVALID_ARGUMENT',
      `Invalid scope "${scope}". Must be "global" or "project"`
    );
  }
  return scope as Scope;
}

export { runDescribe } from './definitions';
export async function runSources(opts: GlobalCliOptions): Promise<CliSource[]> {
  const { homeRoot, workspaceRoot } = resolveRoots(opts);
  const sources: CliSource[] = [];

  // Global sources
  try {
    const gManifest = await readManifest('global', undefined, homeRoot);
    for (const d of gManifest.sources) {
      sources.push({
        id: d.id,
        type: d.type,
        scope: 'global',
        ...(d.url ? { url: d.url } : {}),
        ...(d.localPath ? { localPath: d.localPath } : {}),
        ...(d.branch ? { branch: d.branch } : {}),
        ...(d.tag ? { tag: d.tag } : {}),
        ...(d.commit ? { commit: d.commit } : {}),
        ...(d.name ? { name: d.name } : {}),
      });
    }
  } catch {
    // ignore
  }

  // Workspace sources
  if (workspaceRoot) {
    try {
      const pManifest = await readManifest('project', workspaceRoot, homeRoot);
      for (const d of pManifest.sources) {
        sources.push({
          id: d.id,
          type: d.type,
          scope: 'project',
          ...(d.url ? { url: d.url } : {}),
          ...(d.localPath ? { localPath: d.localPath } : {}),
          ...(d.branch ? { branch: d.branch } : {}),
          ...(d.tag ? { tag: d.tag } : {}),
          ...(d.commit ? { commit: d.commit } : {}),
          ...(d.name ? { name: d.name } : {}),
        });
      }
    } catch {
      // ignore
    }
  }

  return sources;
}

export async function runCatalog(
  opts: GlobalCliOptions & { source?: string; kind?: string }
): Promise<CatalogResult> {
  const { homeRoot, workspaceRoot } = resolveRoots(opts);
  const targetKind = validateKind(opts.kind);

  const registeredSources: Source[] = [];
  try {
    const gManifest = await readManifest('global', undefined, homeRoot);
    registeredSources.push(...gManifest.sources.map((d) => fromDesiredSource(d, undefined, homeRoot)));
  } catch {
    // ignore
  }

  if (workspaceRoot) {
    try {
      const pManifest = await readManifest('project', workspaceRoot, homeRoot);
      registeredSources.push(...pManifest.sources.map((d) => fromDesiredSource(d, workspaceRoot, homeRoot)));
    } catch {
      // ignore
    }
  }

  let sourcesToResolve = registeredSources;
  if (opts.source) {
    sourcesToResolve = registeredSources.filter((s) => s.id === opts.source);
    if (sourcesToResolve.length === 0) {
      throw new CliError('NOT_FOUND', `Source "${opts.source}" not found`);
    }
  }

  const artifacts: CatalogArtifact[] = [];
  const diagnostics: CatalogDiagnostic[] = [];

  for (const source of sourcesToResolve) {
    try {
      const resolver = getSourceResolver(source.type);
      const resolution = await resolver.resolve(source, { homeRoot });
      if (resolution) {
        for (const pkg of resolution.packages) {
          for (const art of pkg.artifacts) {
            if (targetKind && art.kind !== targetKind) {
              continue;
            }
            artifacts.push({
              sourceId: source.id,
              scope: source.scope,
              packageId: pkg.id,
              artifactId: art.id,
              kind: art.kind,
              name: art.name,
              ...(art.description ? { description: art.description } : {}),
              ...(pkg.version ? { version: pkg.version } : {}),
            });
          }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      diagnostics.push({
        sourceId: source.id,
        scope: source.scope,
        message,
      });
    }
  }

  return { artifacts, diagnostics };
}

export async function runInstalled<
  T extends GlobalCliOptions & { scope?: string; assistant?: string; kind?: string }
>(
  opts: T
): Promise<T extends { roots: string[] } ? CliInstalledRootsResult : CliInstalledItem[]>;
export async function runInstalled(
  opts: GlobalCliOptions & { scope?: string; assistant?: string; kind?: string }
): Promise<CliInstalledItem[] | CliInstalledRootsResult> {
  const filterScope = validateScope(opts.scope);
  const filterKind = validateKind(opts.kind);

  let assistantFilter: AssistantId[] | undefined;
  if (opts.assistant) {
    const parsed = parseAssistantFilter(opts.assistant);
    if (parsed) assistantFilter = parsed;
  } else if (opts.assistants) {
    assistantFilter = parseAssistantFilter(opts.assistants);
  }

  // When --roots is specified: multi-root scanning
  if (opts.roots && opts.roots.length > 0) {
    const homeRoot = opts.home ? path.resolve(opts.home) : undefined;
    const scanOpts = parseScanOptions(opts);
    const roots = Array.isArray(opts.roots) ? opts.roots : [opts.roots];

    const scanResult = await scanInventoryAcrossRoots(roots, {
      assistants: assistantFilter,
      scopes: filterScope ? [filterScope] : undefined,
      homeRoot,
      options: scanOpts,
    });

    const items = filterKind
      ? scanResult.items.filter((i) => i.kind === filterKind)
      : scanResult.items;

    return {
      items,
      installed: items,
      workspaces: scanResult.workspaces,
      skipped: scanResult.skipped,
    };
  }

  const { homeRoot, workspaceRoot } = resolveRoots(opts);

  const scopesToScan: Scope[] = filterScope
    ? [filterScope]
    : workspaceRoot
    ? ['global', 'project']
    : ['global'];

  const results: CliInstalledItem[] = [];

  for (const sc of scopesToScan) {
    const pRoot = sc === 'project' ? workspaceRoot : undefined;
    try {
      const inventory = await scanInstalledInventory(sc, pRoot, homeRoot);

      for (const m of inventory.managed) {
        if (assistantFilter && !assistantFilter.includes(m.assistant)) continue;
        if (filterKind && m.kind !== filterKind) continue;

        results.push({
          key: `${m.assistant}:${m.scope}:${m.kind}:${m.name}`,
          kind: m.kind,
          name: m.name,
          assistant: m.assistant,
          scope: m.scope,
          membership: 'managed',
          path: m.path,
          ...(m.sourceId ? { sourceId: m.sourceId } : {}),
          workspace: sc === 'global' ? null : workspaceRoot,
        });
      }

      for (const o of inventory.observed) {
        if (assistantFilter && !assistantFilter.includes(o.assistant)) continue;
        if (filterKind && o.kind !== filterKind) continue;

        const matchedStatus = o.match?.status === 'identical'
          ? 'identical'
          : o.match?.status === 'different'
          ? 'different'
          : undefined;

        results.push({
          key: `${o.assistant}:${o.scope}:${o.kind}:${o.name}`,
          kind: o.kind as ItemKind,
          name: o.name,
          assistant: o.assistant,
          scope: o.scope,
          membership: 'observed',
          path: o.path,
          ...(o.match?.sourceId ? { sourceId: o.match.sourceId } : {}),
          ...(matchedStatus ? { match: matchedStatus } : {}),
          workspace: sc === 'global' ? null : workspaceRoot,
        });
      }
    } catch {
      // ignore scope scan errors
    }
  }

  return results;
}

export async function runUpdates(
  opts: GlobalCliOptions & { scope?: string; assistant?: string; kind?: string }
): Promise<CliUpdateItem[]> {
  const filterScope = validateScope(opts.scope);
  const filterKind = validateKind(opts.kind);
  const filterAssistant = opts.assistant ? parseAssistantFilter(opts.assistant)?.[0] : undefined;

  // When --roots is specified: multi-root drift check
  if (opts.roots && opts.roots.length > 0) {
    const homeRoot = opts.home ? path.resolve(opts.home) : undefined;
    const scanOpts = parseScanOptions(opts);
    const roots = Array.isArray(opts.roots) ? opts.roots : [opts.roots];
    const { workspaces } = await findWorkspaces(roots, scanOpts);

    const updates: CliUpdateItem[] = [];

    // Global scope
    if (!filterScope || filterScope === 'global') {
      try {
        const gState = await readState('global', undefined, homeRoot);
        const gManifest = await readManifest('global', undefined, homeRoot);
        const gSources = gManifest.sources.map((d) => fromDesiredSource(d, undefined, homeRoot));

        for (const inst of gState.installations) {
          if (filterAssistant && inst.assistant !== filterAssistant) continue;
          if (filterKind && inst.kind !== filterKind) continue;

          const matchingSource = gSources.find((s) => s.id === inst.sourceId);
          let report;
          if (matchingSource) {
            report = await checkForUpstreamUpdate(inst, matchingSource, homeRoot);
          } else {
            report = await analyzeLocalDrift(inst, homeRoot);
          }

          updates.push({
            key: `${inst.assistant}:${inst.scope}:${inst.kind}:${inst.name}`,
            kind: inst.kind,
            name: inst.name,
            assistant: inst.assistant,
            scope: inst.scope,
            status: report.status,
            ...(inst.sourceId ? { sourceId: inst.sourceId } : {}),
            ...(report.details ? { details: report.details } : {}),
            workspace: null,
          });
        }
      } catch {
        // ignore
      }
    }

    // Workspace scope for each found workspace
    if (!filterScope || filterScope === 'project') {
      const multiWorkspace = workspaces.length > 1;

      for (const ws of workspaces) {
        const suffix = multiWorkspace ? `@${path.basename(ws)}` : '';
        try {
          const pState = await readState('project', ws, homeRoot);
          const pManifest = await readManifest('project', ws, homeRoot);
          const pSources = pManifest.sources.map((d) => fromDesiredSource(d, ws, homeRoot));

          for (const inst of pState.installations) {
            if (filterAssistant && inst.assistant !== filterAssistant) continue;
            if (filterKind && inst.kind !== filterKind) continue;

            const matchingSource = pSources.find((s) => s.id === inst.sourceId);
            let report;
            if (matchingSource) {
              report = await checkForUpstreamUpdate(inst, matchingSource, homeRoot);
            } else {
              report = await analyzeLocalDrift(inst, homeRoot);
            }

            updates.push({
              key: `${inst.assistant}:${inst.scope}:${inst.kind}:${inst.name}${suffix}`,
              kind: inst.kind,
              name: inst.name,
              assistant: inst.assistant,
              scope: inst.scope,
              status: report.status,
              ...(inst.sourceId ? { sourceId: inst.sourceId } : {}),
              ...(report.details ? { details: report.details } : {}),
              workspace: ws,
            });
          }
        } catch {
          // ignore
        }
      }
    }

    return updates;
  }

  const { homeRoot, workspaceRoot } = resolveRoots(opts);

  const allInstallations: Array<{ inst: ManagedInstallation; wsRoot?: string }> = [];
  const allSources: Source[] = [];

  // Global state & manifest
  try {
    const gState = await readState('global', undefined, homeRoot);
    for (const inst of gState.installations) {
      allInstallations.push({ inst });
    }
    const gManifest = await readManifest('global', undefined, homeRoot);
    allSources.push(...gManifest.sources.map((d) => fromDesiredSource(d, undefined, homeRoot)));
  } catch {
    // ignore
  }

  // Workspace state & manifest
  if (workspaceRoot) {
    try {
      const pState = await readState('project', workspaceRoot, homeRoot);
      for (const inst of pState.installations) {
        allInstallations.push({ inst, wsRoot: workspaceRoot });
      }
      const pManifest = await readManifest('project', workspaceRoot, homeRoot);
      allSources.push(...pManifest.sources.map((d) => fromDesiredSource(d, workspaceRoot, homeRoot)));
    } catch {
      // ignore
    }
  }

  const updates: CliUpdateItem[] = [];

  for (const { inst, wsRoot } of allInstallations) {
    if (filterScope && inst.scope !== filterScope) continue;
    if (filterAssistant && inst.assistant !== filterAssistant) continue;
    if (filterKind && inst.kind !== filterKind) continue;

    const matchingSource = allSources.find((s) => s.id === inst.sourceId);
    let report;
    if (matchingSource) {
      report = await checkForUpstreamUpdate(inst, matchingSource, homeRoot);
    } else {
      report = await analyzeLocalDrift(inst, homeRoot);
    }

    updates.push({
      key: `${inst.assistant}:${inst.scope}:${inst.kind}:${inst.name}`,
      kind: inst.kind,
      name: inst.name,
      assistant: inst.assistant,
      scope: inst.scope,
      status: report.status,
      ...(inst.sourceId ? { sourceId: inst.sourceId } : {}),
      ...(report.details ? { details: report.details } : {}),
      workspace: inst.scope === 'global' ? null : (wsRoot ?? null),
    });
  }

  return updates;
}

export async function runItem(
  key: string,
  opts: GlobalCliOptions & { diff?: boolean }
): Promise<CliItemDetail> {
  if (!key || typeof key !== 'string') {
    throw new CliError('INVALID_ARGUMENT', 'Item key argument is required');
  }

  let baseKey = key;
  let workspaceFolderName: string | undefined;
  const atIndex = key.lastIndexOf('@');
  if (atIndex !== -1) {
    baseKey = key.slice(0, atIndex);
    workspaceFolderName = key.slice(atIndex + 1);
  }

  const homeRoot = opts.home ? path.resolve(opts.home) : undefined;
  let targetWorkspaces: string[] = [];

  if (opts.roots && opts.roots.length > 0) {
    const scanOpts = parseScanOptions(opts);
    const roots = Array.isArray(opts.roots) ? opts.roots : [opts.roots];
    const { workspaces } = await findWorkspaces(roots, scanOpts);
    if (workspaceFolderName) {
      const match = workspaces.find((ws) => path.basename(ws) === workspaceFolderName);
      if (!match) {
        throw new CliError('NOT_FOUND', `Item "${key}" not found`);
      }
      targetWorkspaces = [match];
    } else {
      targetWorkspaces = workspaces;
    }
  } else if (workspaceFolderName) {
    if (opts.workspace && path.basename(opts.workspace) === workspaceFolderName) {
      targetWorkspaces = [path.resolve(opts.workspace)];
    } else if (path.basename(process.cwd()) === workspaceFolderName) {
      targetWorkspaces = [process.cwd()];
    } else {
      targetWorkspaces = [resolveRoots(opts).workspaceRoot];
    }
  } else {
    targetWorkspaces = [resolveRoots(opts).workspaceRoot];
  }

  // Gather inventory from all scopes
  const managedItems: ManagedInstallation[] = [];
  const observedItems: ObservedArtifact[] = [];

  try {
    const inv = await scanInstalledInventory('global', undefined, homeRoot);
    managedItems.push(...inv.managed);
    observedItems.push(...inv.observed);
  } catch {
    // ignore
  }

  for (const ws of targetWorkspaces) {
    try {
      const inv = await scanInstalledInventory('project', ws, homeRoot);
      managedItems.push(...inv.managed);
      observedItems.push(...inv.observed);
    } catch {
      // ignore
    }
  }

  const targetManaged = managedItems.find((m) => {
    const mBaseKey = `${m.assistant}:${m.scope}:${m.kind}:${m.name}`;
    if (m.scope === 'global') {
      return mBaseKey === key;
    }
    const wsFolder = m.projectPath ? path.basename(m.projectPath) : '';
    const suffixedKey = `${mBaseKey}@${wsFolder}`;
    if (key === suffixedKey) return true;
    if (key === mBaseKey && !workspaceFolderName) return true;
    if (mBaseKey === baseKey && workspaceFolderName && wsFolder === workspaceFolderName) return true;
    return false;
  });

  const targetObserved = observedItems.find((o) => {
    const oBaseKey = `${o.assistant}:${o.scope}:${o.kind}:${o.name}`;
    if (o.scope === 'global') {
      return oBaseKey === key;
    }
    const wsFolder = o.projectPath ? path.basename(o.projectPath) : '';
    const suffixedKey = `${oBaseKey}@${wsFolder}`;
    if (key === suffixedKey) return true;
    if (key === oBaseKey && !workspaceFolderName) return true;
    if (oBaseKey === baseKey && workspaceFolderName && wsFolder === workspaceFolderName) return true;
    return false;
  });

  if (!targetManaged && !targetObserved) {
    throw new CliError('NOT_FOUND', `Item "${key}" not found`);
  }

  // Gather sources
  const allSources: Source[] = [];
  try {
    const gManifest = await readManifest('global', undefined, homeRoot);
    allSources.push(...gManifest.sources.map((d) => fromDesiredSource(d, undefined, homeRoot)));
  } catch {
    // ignore
  }
  for (const ws of targetWorkspaces) {
    try {
      const pManifest = await readManifest('project', ws, homeRoot);
      allSources.push(...pManifest.sources.map((d) => fromDesiredSource(d, ws, homeRoot)));
    } catch {
      // ignore
    }
  }

  const membership = targetManaged ? 'managed' : 'observed';
  const item = targetManaged || targetObserved!;

  // Origin info
  let origin: CliItemDetail['origin'];
  if (targetManaged) {
    origin = {
      ...(targetManaged.sourceId ? { sourceId: targetManaged.sourceId } : {}),
      ...(targetManaged.packageId ? { packageId: targetManaged.packageId } : {}),
      ...(targetManaged.artifactId ? { artifactId: targetManaged.artifactId } : {}),
      ...(targetManaged.sourceRevision ? { sourceRevision: targetManaged.sourceRevision } : {}),
    };
  } else if (targetObserved) {
    if (targetObserved.match && targetObserved.match.status !== 'unmatched') {
      origin = {
        ...(targetObserved.match.sourceId ? { sourceId: targetObserved.match.sourceId } : {}),
        ...(targetObserved.match.packageId ? { packageId: targetObserved.match.packageId } : {}),
        ...(targetObserved.match.artifactId ? { artifactId: targetObserved.match.artifactId } : {}),
        ...(targetObserved.match.sourceRevision ? { sourceRevision: targetObserved.match.sourceRevision } : {}),
        status: targetObserved.match.status,
      };
    } else {
      origin = { type: 'local' };
    }
  }

  // Find installed-in places
  const installedIn: CliItemDetail['installedIn'] = [];
  for (const m of managedItems) {
    if (m.name === item.name && m.kind === item.kind) {
      if (!(m.assistant === item.assistant && m.scope === item.scope && m.projectPath === item.projectPath)) {
        installedIn.push({
          assistant: m.assistant,
          scope: m.scope,
          membership: 'managed',
          path: m.path,
          workspace: m.scope === 'global' ? null : (m.projectPath ?? null),
        });
      }
    }
  }
  for (const o of observedItems) {
    if (o.name === item.name && o.kind === item.kind) {
      if (!(o.assistant === item.assistant && o.scope === item.scope && o.projectPath === item.projectPath)) {
        installedIn.push({
          assistant: o.assistant,
          scope: o.scope,
          membership: 'observed',
          path: o.path,
          workspace: o.scope === 'global' ? null : (o.projectPath ?? null),
        });
      }
    }
  }

  // Check diff availability & compute unified diff
  let diffAvailable = false;
  let diffContent: string | undefined;

  const sourceId = targetManaged?.sourceId || targetObserved?.match?.sourceId;
  const artifactId = targetManaged?.artifactId || targetObserved?.match?.artifactId;

  if (sourceId) {
    const source = allSources.find((s) => s.id === sourceId);
    if (source) {
      try {
        const resolver = getSourceResolver(source.type);
        const resolution = await resolver.resolve(source, { homeRoot });
        if (resolution) {
          let foundPkg;
          let foundArt;
          for (const pkg of resolution.packages) {
            for (const art of pkg.artifacts) {
              if (
                (artifactId && (art.id === artifactId || art.name === artifactId)) ||
                (art.kind === item.kind && art.name === item.name)
              ) {
                foundPkg = pkg;
                foundArt = art;
                break;
              }
            }
            if (foundArt) break;
          }

          if (foundPkg && foundArt) {
            const translatedResult = await resolveAndTranslate(
              source,
              foundPkg,
              foundArt,
              item.assistant
            );

            // Read local content
            let localStr = '';
            let origStr = '';

            if (item.kind === 'skill') {
              origStr = serializeSkillMarkdown(translatedResult.translated as CanonicalSkill);
              const skillFile = path.join(item.path, 'SKILL.md');
              if (fs.existsSync(skillFile)) {
                localStr = await fs.promises.readFile(skillFile, 'utf-8');
              } else {
                try {
                  const locSkill = await readSkill(item.path);
                  localStr = serializeSkillMarkdown(locSkill);
                } catch {
                  // ignore
                }
              }
            } else {
              // Agent, command, etc.
              const adapter = homeRoot
                ? getAdapterWithHomeRoot(item.assistant, homeRoot)
                : getAdapter(item.assistant);
              const loc = { scope: item.scope, projectRoot: item.projectPath };
              if (item.kind === 'agent') {
                const ag = await adapter.readAgent(item.name, loc);
                if (ag) localStr = JSON.stringify(ag, null, 2);
                origStr = JSON.stringify(translatedResult.translated, null, 2);
              } else if (item.kind === 'command') {
                const cmd = await adapter.readCommand(item.name, loc);
                if (cmd) localStr = JSON.stringify(cmd, null, 2);
                origStr = JSON.stringify(translatedResult.translated, null, 2);
              }
            }

            if (origStr && localStr && origStr !== localStr) {
              diffAvailable = true;
              if (opts.diff) {
                diffContent = createUnifiedDiff(origStr, localStr, 'upstream', 'local');
              }
            }
          }
        }
      } catch {
        // diff calculation failure leaves diffAvailable false
      }
    }
  }

  return {
    key,
    kind: item.kind as ItemKind,
    name: item.name,
    assistant: item.assistant,
    scope: item.scope,
    membership,
    path: item.path,
    workspace: item.scope === 'global' ? null : (item.projectPath ?? null),
    ...(origin ? { origin } : {}),
    installedIn,
    diffAvailable,
    ...(opts.diff && diffContent !== undefined ? { diff: diffContent } : {}),
  };
}

export async function runPlanInstall(
  opts: GlobalCliOptions & {
    source: string;
    artifact: string;
    assistants: string;
    scopes: string;
    overwriteCheck?: boolean;
  }
): Promise<CliPlanInstallSummary> {
  const { homeRoot, workspaceRoot } = resolveRoots(opts);

  if (!opts.source) {
    throw new CliError('INVALID_ARGUMENT', 'Missing required option --source <id>');
  }
  if (!opts.artifact) {
    throw new CliError('INVALID_ARGUMENT', 'Missing required option --artifact <id>');
  }
  if (!opts.assistants) {
    throw new CliError('INVALID_ARGUMENT', 'Missing required option --assistants <ids>');
  }
  if (!opts.scopes) {
    throw new CliError('INVALID_ARGUMENT', 'Missing required option --scopes <scopes>');
  }

  const assistantIds = parseAssistantFilter(opts.assistants);
  if (!assistantIds || assistantIds.length === 0) {
    throw new CliError('INVALID_ARGUMENT', 'At least one assistant must be specified in --assistants');
  }

  const rawScopes = opts.scopes.split(',').map((s) => s.trim()).filter(Boolean);
  const scopeList: Scope[] = [];
  for (const s of rawScopes) {
    const validated = validateScope(s);
    if (validated) scopeList.push(validated);
  }
  if (scopeList.length === 0) {
    throw new CliError('INVALID_ARGUMENT', 'At least one scope must be specified in --scopes');
  }

  // Find source
  const registeredSources: Source[] = [];
  try {
    const gManifest = await readManifest('global', undefined, homeRoot);
    registeredSources.push(...gManifest.sources.map((d) => fromDesiredSource(d, undefined, homeRoot)));
  } catch {
    // ignore
  }
  if (workspaceRoot) {
    try {
      const pManifest = await readManifest('project', workspaceRoot, homeRoot);
      registeredSources.push(...pManifest.sources.map((d) => fromDesiredSource(d, workspaceRoot, homeRoot)));
    } catch {
      // ignore
    }
  }

  const source = registeredSources.find((s) => s.id === opts.source);
  if (!source) {
    throw new CliError('NOT_FOUND', `Source "${opts.source}" not found`);
  }

  let resolution;
  try {
    const resolver = getSourceResolver(source.type);
    resolution = await resolver.resolve(source, { homeRoot });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CliError('SOURCE_RESOLUTION_FAILED', `Failed to resolve source "${opts.source}": ${msg}`);
  }

  if (!resolution) {
    throw new CliError('SOURCE_RESOLUTION_FAILED', `Failed to resolve source "${opts.source}"`);
  }

  let foundPkg;
  let foundArt;
  for (const pkg of resolution.packages) {
    for (const art of pkg.artifacts) {
      if (art.id === opts.artifact || art.name === opts.artifact) {
        foundPkg = pkg;
        foundArt = art;
        break;
      }
    }
    if (foundArt) break;
  }

  if (!foundPkg || !foundArt) {
    throw new CliError('NOT_FOUND', `Artifact "${opts.artifact}" not found in source "${opts.source}"`);
  }

  const planResult = await planInstallMatrix({
    items: [{ source, pkg: foundPkg, artifact: foundArt }],
    assistants: assistantIds,
    scopes: scopeList,
    projectRoot: workspaceRoot,
    homeRoot,
  });

  return planResult.summary;
}

export async function runRedistribute(
  opts: GlobalCliOptions & {
    target: string;
    item?: string | string[];
    scope?: string;
    assistant?: string;
    force?: boolean;
    installMissing?: boolean;
    write?: boolean;
    allowCodeKinds?: boolean;
  }
): Promise<RedistributePlan | RedistributeResult> {
  const { homeRoot, workspaceRoot } = resolveRoots(opts);

  if (!opts.target) {
    throw new CliError('INVALID_ARGUMENT', 'Target argument is required');
  }

  const filterScope = validateScope(opts.scope);
  const scopes: Scope[] | undefined = filterScope ? [filterScope] : undefined;

  let assistantFilter: AssistantId[] | undefined;
  if (opts.assistant) {
    assistantFilter = parseAssistantFilter(opts.assistant);
  } else if (opts.assistants) {
    assistantFilter = parseAssistantFilter(opts.assistants);
  }

  let items: string[] | undefined;
  if (Array.isArray(opts.item)) {
    items = opts.item
      .flatMap((s: string) => s.split(','))
      .map((s: string) => s.trim())
      .filter(Boolean);
  } else if (typeof opts.item === 'string') {
    items = opts.item
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const allInstallations: ManagedInstallation[] = [];
  const allSources: Source[] = [];

  // Global state & manifest
  try {
    const gState = await readState('global', undefined, homeRoot);
    allInstallations.push(...gState.installations);
    const gManifest = await readManifest('global', undefined, homeRoot);
    allSources.push(
      ...gManifest.sources.map((d) => fromDesiredSource(d, undefined, homeRoot))
    );
  } catch {
    // ignore
  }

  // Workspace state & manifest
  if (workspaceRoot) {
    try {
      const pState = await readState('project', workspaceRoot, homeRoot);
      allInstallations.push(...pState.installations);
      const pManifest = await readManifest('project', workspaceRoot, homeRoot);
      allSources.push(
        ...pManifest.sources.map((d) =>
          fromDesiredSource(d, workspaceRoot, homeRoot)
        )
      );
    } catch {
      // ignore
    }
  }

  const plan = await planRedistribute({
    target: opts.target,
    installations: allInstallations,
    sources: allSources,
    assistants: assistantFilter,
    scopes,
    items,
    force: Boolean(opts.force),
    installMissing: Boolean(opts.installMissing),
    homeRoot,
    projectRoot: workspaceRoot,
  });

  // Gate: refuse executable/code kinds unless --allow-code-kinds is given
  refuseCodeKinds(plan.targets.map((t) => t.kind), opts.allowCodeKinds);

  if (!opts.write) {
    return {
      mode: 'plan',
      source: plan.source,
      targets: plan.targets.map(sanitizeTarget),
    };
  }

  return await applyRedistribute(plan, {
    homeRoot,
    projectRoot: workspaceRoot,
  });
}

