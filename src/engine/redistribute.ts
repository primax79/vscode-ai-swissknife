import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  AssistantId,
  ItemKind,
  ManagedInstallation,
  Package,
  Artifact,
  Scope,
  Source,
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
} from '../adapters/codec';
import { readState } from '../domain/registry';
import { ALL_ADAPTERS } from '../adapters/registry';
import { localFolderResolver } from '../sources/localFolder';
import { planInstallMatrix } from './installMatrix';
import { planUpdate, backupItemToTrash } from './update';
import { applyInstall } from './apply';
import { analyzeLocalDrift } from './drift';
import { resolveAndTranslate } from './plan';
import type { PreparedInstall } from './types';
import { CliError } from '../cli/output';

export type RedistributeClassification =
  | 'identical'
  | 'stale'
  | 'modified-locally'
  | 'missing-on-disk'
  | 'orphan'
  | 'missing';

export type RedistributeAction =
  | 'update'
  | 'install'
  | 'skip'
  | 'updated'
  | 'installed'
  | 'skipped'
  | 'failed';

export interface ChangedFilesMap {
  added: string[];
  changed: string[];
  removed: string[];
}

export interface RedistributeTarget {
  item: string;
  kind: ItemKind;
  assistant: AssistantId;
  scope: Scope;
  path: string;
  classification: RedistributeClassification;
  action: RedistributeAction;
  oldHash?: string;
  newHash?: string;
  changedFiles: ChangedFilesMap;
  backupPath?: string;
  reason?: string;
  installation?: ManagedInstallation;
  prepared?: PreparedInstall;
}

export interface PlanRedistributeParams {
  target: string;
  installations: ManagedInstallation[];
  sources: Source[] | ReadonlyMap<string, Source> | Map<string, Source>;
  assistants?: AssistantId[];
  scopes?: Scope[];
  items?: string[];
  force?: boolean;
  installMissing?: boolean;
  homeRoot?: string;
  projectRoot?: string;
  resolverOpts?: { cacheDir?: string };
}

export interface RedistributePlan {
  mode: 'plan';
  source: Source;
  targets: RedistributeTarget[];
}

export interface ApplyRedistributeOptions {
  homeRoot?: string;
  projectRoot?: string;
  onProgress?: (target: RedistributeTarget, index: number, total: number) => void;
}

export interface RedistributeResult {
  mode: 'applied';
  targets: RedistributeTarget[];
}

function toSourceList(
  sources: Source[] | ReadonlyMap<string, Source> | Map<string, Source>
): Source[] {
  if (Array.isArray(sources)) return sources;
  return Array.from(sources.values());
}

function sha256(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Traverses a file or directory on disk and returns a map of relative path -> sha256 hash.
 */
export function snapshotTree(targetPath: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(targetPath)) return map;

  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    const content = fs.readFileSync(targetPath);
    map.set(path.basename(targetPath), sha256(content));
    return map;
  }

  function traverse(dir: string, base: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(base, full);
      if (entry.isDirectory()) {
        traverse(full, base);
      } else if (entry.isFile()) {
        const content = fs.readFileSync(full);
        map.set(rel, sha256(content));
      }
    }
  }

  traverse(targetPath, targetPath);
  return map;
}

/**
 * Compares two snapshots (before and after) and returns added, changed, and removed files.
 */
export function diffSnapshots(
  before: Map<string, string>,
  after: Map<string, string>
): ChangedFilesMap {
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];

  for (const [file, hash] of after) {
    if (!before.has(file)) {
      added.push(file);
    } else if (before.get(file) !== hash) {
      changed.push(file);
    }
  }

  for (const file of before.keys()) {
    if (!after.has(file)) {
      removed.push(file);
    }
  }

  added.sort();
  changed.sort();
  removed.sort();

  return { added, changed, removed };
}

function computePlanChangedFiles(prepared: PreparedInstall): ChangedFilesMap {
  if (!prepared.supported) {
    return { added: [], changed: [], removed: [] };
  }

  const plan = prepared.plan;
  const existingMap = new Map<string, string>();
  for (const f of plan.existingFiles) {
    existingMap.set(f.path, f.contentHash);
  }
  const proposedMap = new Map<string, string>();
  for (const f of plan.proposedFiles) {
    proposedMap.set(f.path, f.contentHash);
  }

  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];

  for (const [p, h] of proposedMap) {
    const rel = plan.targetDir ? path.relative(plan.targetDir, p) : path.basename(p);
    const cleanRel = rel.startsWith('..') ? path.basename(p) : rel;
    if (!existingMap.has(p)) {
      added.push(cleanRel);
    } else if (existingMap.get(p) !== h) {
      changed.push(cleanRel);
    }
  }

  for (const [p] of existingMap) {
    const rel = plan.targetDir ? path.relative(plan.targetDir, p) : path.basename(p);
    const cleanRel = rel.startsWith('..') ? path.basename(p) : rel;
    if (!proposedMap.has(p)) {
      removed.push(cleanRel);
    }
  }

  added.sort();
  changed.sort();
  removed.sort();

  return { added, changed, removed };
}

function computeSourceHash(
  kind: ItemKind,
  translated: unknown
): string {
  if (kind === 'skill') {
    return canonicalSkillHash(translated as CanonicalSkill);
  } else if (kind === 'agent') {
    return canonicalAgentHash(translated as CanonicalAgent);
  } else if (kind === 'command') {
    return canonicalCommandHash(translated as CanonicalCommand);
  } else if (kind === 'mcp-server') {
    return canonicalMcpServerHash(translated as CanonicalMcpServer);
  } else if (kind === 'hook') {
    return canonicalHookHash(translated as CanonicalHook);
  } else if (kind === 'rule') {
    return canonicalRuleHash(translated as CanonicalRule);
  }
  return '';
}

export function sanitizeTarget(target: RedistributeTarget): RedistributeTarget {
  const { installation: _installation, prepared: _prepared, ...rest } = target;
  return rest;
}

/**
 * Plans a redistribution of edited artifacts from a local folder to installed copies.
 * Never modifies anything on disk.
 */
export async function planRedistribute(
  params: PlanRedistributeParams
): Promise<RedistributePlan> {
  const {
    target,
    installations,
    sources,
    assistants,
    scopes,
    items,
    force = false,
    installMissing = false,
    homeRoot,
    projectRoot,
    resolverOpts,
  } = params;

  const allSources = toSourceList(sources);

  // 1. Resolve target to matching registered local-folder source(s)
  let matchedSource: Source | undefined;
  let targetItemName: string | undefined;
  let targetSubfolder: string | undefined;

  // 1a. Check if target matches an installed item key or name
  const matchingInst = installations.find((i) => {
    const key = `${i.assistant}:${i.scope}:${i.kind}:${i.name}`;
    return key === target || i.name === target;
  });

  if (matchingInst) {
    const src = allSources.find((s) => s.id === matchingInst.sourceId);
    if (!src) {
      throw new CliError(
        'NOT_A_LOCAL_FOLDER_SOURCE',
        `Item "${target}" references unknown source "${matchingInst.sourceId}"`
      );
    }
    if (src.type !== 'local-folder') {
      throw new CliError(
        'NOT_A_LOCAL_FOLDER_SOURCE',
        `Item "${target}" was installed from source "${src.id}" of type "${src.type}", which is not a local-folder source`
      );
    }
    matchedSource = src;
    targetItemName = matchingInst.name;
  }

  // 1b. Check if target matches a source ID
  if (!matchedSource) {
    const srcById = allSources.find((s) => s.id === target);
    if (srcById) {
      if (srcById.type !== 'local-folder') {
        throw new CliError(
          'NOT_A_LOCAL_FOLDER_SOURCE',
          `Target "${target}" resolves to source "${srcById.id}" of type "${srcById.type}", which is not a local-folder source`
        );
      }
      matchedSource = srcById;
    }
  }

  // 1c. Treat target as a folder path
  if (!matchedSource) {
    const resolvedTarget = path.isAbsolute(target)
      ? path.resolve(target)
      : path.resolve(projectRoot ?? process.cwd(), target);

    for (const src of allSources) {
      if (src.type !== 'local-folder' || !src.localPath) continue;

      let absSrc = src.localPath;
      if (!path.isAbsolute(absSrc)) {
        absSrc =
          src.scope === 'project'
            ? path.resolve(projectRoot ?? process.cwd(), absSrc)
            : path.resolve(homeRoot ?? os.homedir(), absSrc);
      }
      absSrc = path.resolve(absSrc);

      if (resolvedTarget === absSrc) {
        matchedSource = src;
        break;
      }

      // Check if source folder contains resolvedTarget
      const relToTarget = path.relative(absSrc, resolvedTarget);
      if (!relToTarget.startsWith('..') && !path.isAbsolute(relToTarget)) {
        matchedSource = src;
        targetSubfolder = resolvedTarget;
        break;
      }

      // Check if resolvedTarget contains source folder
      const relToSrc = path.relative(resolvedTarget, absSrc);
      if (!relToSrc.startsWith('..') && !path.isAbsolute(relToSrc)) {
        matchedSource = src;
        break;
      }
    }
  }

  if (!matchedSource) {
    // Check if target matches any non-local-folder source
    const nonLocalMatch = allSources.find((s) => s.url === target || s.id === target);
    if (nonLocalMatch) {
      throw new CliError(
        'NOT_A_LOCAL_FOLDER_SOURCE',
        `Target "${target}" matched source "${nonLocalMatch.id}" of type "${nonLocalMatch.type}", which is not a local-folder source`
      );
    }
    throw new CliError(
      'NOT_A_LOCAL_FOLDER_SOURCE',
      `No registered local-folder source found matching "${target}"`
    );
  }

  // 2. Resolve the local folder source to inspect available packages & artifacts
  const resolution = await localFolderResolver.resolve(matchedSource);
  const allSourceArtifacts: { pkg: Package; artifact: Artifact }[] = [];
  for (const pkg of resolution.packages) {
    for (const art of pkg.artifacts) {
      allSourceArtifacts.push({ pkg, artifact: art });
    }
  }

  // 3. Determine active artifact filters
  let filteredArtifacts = allSourceArtifacts;
  if (items && items.length > 0) {
    filteredArtifacts = allSourceArtifacts.filter((entry) => items.includes(entry.artifact.name));
  } else if (targetItemName) {
    filteredArtifacts = allSourceArtifacts.filter((entry) => entry.artifact.name === targetItemName);
  } else if (targetSubfolder) {
    filteredArtifacts = allSourceArtifacts.filter((entry) => {
      const artPath = entry.artifact.path ? path.resolve(entry.artifact.path) : '';
      return (
        artPath === targetSubfolder ||
        artPath.startsWith(targetSubfolder + path.sep) ||
        entry.artifact.name === path.basename(targetSubfolder)
      );
    });
  }

  const targetItemNames = new Set<string>();
  if (items && items.length > 0) {
    for (const it of items) targetItemNames.add(it);
  } else if (targetItemName) {
    targetItemNames.add(targetItemName);
  } else if (targetSubfolder && filteredArtifacts.length > 0) {
    for (const entry of filteredArtifacts) targetItemNames.add(entry.artifact.name);
  }

  const targets: RedistributeTarget[] = [];
  const seenTargets = new Set<string>();

  // 4. Classify managed installations matching this source
  const relevantInstallations = installations.filter((inst) => {
    if (inst.sourceId !== matchedSource!.id) return false;
    if (assistants && assistants.length > 0 && !assistants.includes(inst.assistant)) return false;
    if (scopes && scopes.length > 0 && !scopes.includes(inst.scope)) return false;
    if (targetItemNames.size > 0 && !targetItemNames.has(inst.name)) return false;
    return true;
  });

  for (const inst of relevantInstallations) {
    const targetKey = `${inst.assistant}:${inst.scope}:${inst.kind}:${inst.name}`;
    if (seenTargets.has(targetKey)) continue;
    seenTargets.add(targetKey);

    // Find matching artifact in the source
    const foundEntry = allSourceArtifacts.find(
      (entry) =>
        (inst.artifactId && entry.artifact.id === inst.artifactId) ||
        (entry.artifact.kind === inst.kind && entry.artifact.name === inst.name) ||
        entry.artifact.name === inst.name
    );

    if (!foundEntry) {
      // Artifact was removed from folder: orphan
      targets.push({
        item: inst.name,
        kind: inst.kind,
        assistant: inst.assistant,
        scope: inst.scope,
        path: inst.path,
        classification: 'orphan',
        action: 'skip',
        oldHash: inst.contentHash,
        newHash: undefined,
        changedFiles: { added: [], changed: [], removed: [] },
        installation: inst,
      });
      continue;
    }

    const { pkg, artifact } = foundEntry;

    // Check drift of the installed copy on disk
    const localReport = await analyzeLocalDrift(inst, homeRoot);
    if (localReport.status === 'missing-on-disk') {
      targets.push({
        item: inst.name,
        kind: inst.kind,
        assistant: inst.assistant,
        scope: inst.scope,
        path: inst.path,
        classification: 'missing-on-disk',
        action: 'skip',
        oldHash: inst.contentHash,
        newHash: undefined,
        changedFiles: { added: [], changed: [], removed: [] },
        installation: inst,
      });
      continue;
    }

    // Translate source artifact and calculate sourceHash
    let sourceHash = '';
    let prepared: PreparedInstall | undefined;
    try {
      const translatedResult = await resolveAndTranslate(
        matchedSource,
        pkg,
        artifact,
        inst.assistant
      );
      sourceHash = computeSourceHash(artifact.kind, translatedResult.translated);
      prepared = await planUpdate(inst, matchedSource, {
        resolution,
        homeRoot,
        projectRoot: inst.scope === 'project' ? (inst.projectPath ?? projectRoot) : undefined,
        resolverOpts,
      });
    } catch {
      // ignore resolution/translate error for now
    }

    const plannedChangedFiles = prepared
      ? computePlanChangedFiles(prepared)
      : { added: [], changed: [], removed: [] };

    const isModifiedLocally = localReport.status === 'modified-locally';

    if (isModifiedLocally) {
      targets.push({
        item: inst.name,
        kind: inst.kind,
        assistant: inst.assistant,
        scope: inst.scope,
        path: inst.path,
        classification: 'modified-locally',
        action: force ? 'update' : 'skip',
        oldHash: localReport.diskHash ?? inst.contentHash,
        newHash: sourceHash,
        changedFiles: force ? plannedChangedFiles : { added: [], changed: [], removed: [] },
        installation: inst,
        prepared,
      });
      continue;
    }

    // Copy was unmodified locally
    if (sourceHash && inst.contentHash && sourceHash === inst.contentHash) {
      targets.push({
        item: inst.name,
        kind: inst.kind,
        assistant: inst.assistant,
        scope: inst.scope,
        path: inst.path,
        classification: 'identical',
        action: 'skip',
        oldHash: inst.contentHash,
        newHash: sourceHash,
        changedFiles: { added: [], changed: [], removed: [] },
        installation: inst,
        prepared,
      });
    } else {
      targets.push({
        item: inst.name,
        kind: inst.kind,
        assistant: inst.assistant,
        scope: inst.scope,
        path: inst.path,
        classification: 'stale',
        action: 'update',
        oldHash: inst.contentHash,
        newHash: sourceHash,
        changedFiles: plannedChangedFiles,
        installation: inst,
        prepared,
      });
    }
  }

  // 5. With installMissing: check (assistant x scope) combinations without a copy
  if (installMissing) {
    const targetAssistants =
      assistants && assistants.length > 0
        ? assistants
        : ALL_ADAPTERS.map((a) => a.assistant);

    const targetScopes =
      scopes && scopes.length > 0
        ? scopes
        : projectRoot
        ? (['global', 'project'] as Scope[])
        : (['global'] as Scope[]);

    for (const entry of filteredArtifacts) {
      for (const assistant of targetAssistants) {
        for (const scope of targetScopes) {
          const targetKey = `${assistant}:${scope}:${entry.artifact.kind}:${entry.artifact.name}`;
          if (seenTargets.has(targetKey)) continue;

          const alreadyManaged = installations.some(
            (i) =>
              i.assistant === assistant &&
              i.scope === scope &&
              (i.name === entry.artifact.name ||
                (i.artifactId && i.artifactId === entry.artifact.id))
          );

          if (!alreadyManaged) {
            try {
              const matrixResult = await planInstallMatrix({
                items: [{ source: matchedSource, pkg: entry.pkg, artifact: entry.artifact }],
                assistants: [assistant],
                scopes: [scope],
                projectRoot: scope === 'project' ? projectRoot : undefined,
                homeRoot,
                resolverOpts,
              });

              const matrixTarget = matrixResult.targets[0];
              if (matrixTarget && matrixTarget.prepared.supported) {
                seenTargets.add(targetKey);
                const translatedResult = await resolveAndTranslate(
                  matchedSource,
                  entry.pkg,
                  entry.artifact,
                  assistant
                );
                const sHash = computeSourceHash(entry.artifact.kind, translatedResult.translated);
                const plannedFiles = computePlanChangedFiles(matrixTarget.prepared);

                targets.push({
                  item: entry.artifact.name,
                  kind: entry.artifact.kind,
                  assistant,
                  scope,
                  path: matrixTarget.prepared.plan.targetDir,
                  classification: 'missing',
                  action: 'install',
                  oldHash: undefined,
                  newHash: sHash,
                  changedFiles: plannedFiles,
                  prepared: matrixTarget.prepared,
                });
              }
            } catch {
              // ignore installMatrix failure
            }
          }
        }
      }
    }
  }

  return {
    mode: 'plan',
    source: matchedSource,
    targets,
  };
}

/**
 * Applies planned updates and missing installs sequentially.
 * One failure never stops the rest.
 */
export async function applyRedistribute(
  plan: RedistributePlan,
  options?: ApplyRedistributeOptions
): Promise<RedistributeResult> {
  const appliedTargets: RedistributeTarget[] = [];

  for (let i = 0; i < plan.targets.length; i++) {
    const target = plan.targets[i];
    options?.onProgress?.(target, i, plan.targets.length);

    if (target.action === 'skip') {
      appliedTargets.push({
        ...sanitizeTarget(target),
        action: 'skipped',
        changedFiles: { added: [], changed: [], removed: [] },
      });
      continue;
    }

    if (target.action === 'update' || target.action === 'install') {
      if (!target.prepared) {
        appliedTargets.push({
          ...sanitizeTarget(target),
          action: 'failed',
          reason: 'No prepared install plan available',
        });
        continue;
      }

      let backupPath: string | undefined;
      const beforeTree = snapshotTree(target.path);

      try {
        const isUpdate = target.classification !== 'missing';
        let beforeCount = 0;
        const projectPath =
          target.scope === 'project'
            ? (target.installation?.projectPath ?? options?.projectRoot)
            : undefined;

        if (isUpdate) {
          try {
            const beforeState = await readState(target.scope, projectPath, options?.homeRoot);
            beforeCount = beforeState.installations.length;
          } catch {
            // ignore
          }
        }

        if (target.classification === 'modified-locally' && target.installation) {
          backupPath = await backupItemToTrash(target.installation, options?.homeRoot);
        }

        const outcome = await applyInstall(target.prepared, options?.homeRoot);
        if (outcome.status === 'applied') {
          // Guard: record count must not grow on updates
          if (isUpdate && beforeCount > 0) {
            try {
              const afterState = await readState(target.scope, projectPath, options?.homeRoot);
              if (afterState.installations.length > beforeCount) {
                throw new Error(
                  `Installation record count increased from ${beforeCount} to ${afterState.installations.length} during update of "${target.item}"`
                );
              }
            } catch (guardErr: unknown) {
              if (
                guardErr instanceof Error &&
                guardErr.message.includes('Installation record count increased')
              ) {
                throw guardErr;
              }
            }
          }

          const afterTree = snapshotTree(target.path);
          const changedFiles = diffSnapshots(beforeTree, afterTree);

          appliedTargets.push({
            ...sanitizeTarget(target),
            action: target.classification === 'missing' ? 'installed' : 'updated',
            changedFiles,
            ...(backupPath ? { backupPath } : {}),
          });
        } else {
          appliedTargets.push({
            ...sanitizeTarget(target),
            action: 'failed',
            reason: outcome.reason,
            ...(backupPath ? { backupPath } : {}),
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        appliedTargets.push({
          ...sanitizeTarget(target),
          action: 'failed',
          reason: msg,
          ...(backupPath ? { backupPath } : {}),
        });
      }
    }
  }

  return {
    mode: 'applied',
    targets: appliedTargets,
  };
}
