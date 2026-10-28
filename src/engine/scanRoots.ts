import * as fs from 'fs';
import * as path from 'path';
import type {
  AssistantId,
  InstallationSourceIdentity,
  InstalledFlag,
  ItemKind,
  Scope,
} from '../domain/types';
import { scanInstalledInventory } from './discovery';
import { attachFlagsToItems } from './installedFlags';

export const DEFAULT_IGNORE: readonly string[] = [
  'node_modules',
  '.git',
  '.kilo/worktrees',
  'worktrees',
  'cache',
  '.cache',
  'dist',
  'out',
  'build',
  'target',
  '_attic',
  '_deprecated',
  'old',
  'very_old',
  '.tmp',
  '__pycache__',
  'venv',
  '.venv',
];

export interface ScanRootsOptions {
  maxDepth?: number;
  ignore?: string[];
  extraIgnore?: string[];
}

export interface SkippedDirectory {
  path: string;
  reason: string;
}

export interface FindWorkspacesResult {
  workspaces: string[];
  skipped: SkippedDirectory[];
}

export interface ScanInventoryAcrossRootsOptions {
  assistants?: AssistantId[];
  scopes?: Scope[];
  homeRoot?: string;
  options?: ScanRootsOptions;
}

export interface ScannedInstalledItem {
  key: string;
  kind: ItemKind;
  name: string;
  assistant: AssistantId;
  scope: Scope;
  membership: 'managed' | 'observed';
  path: string;
  source?: InstallationSourceIdentity;
  sourceId?: string;
  packageId?: string;
  artifactId?: string;
  contentHash?: string;
  provenance?: 'unknown';
  provenanceReason?: string;
  provenanceHint?: string;
  match?: 'identical' | 'different';
  workspace: string | null;
  flags: InstalledFlag[];
  linkTarget?: string;
  duplicateOf?: string[];
}

export interface ScanInventoryAcrossRootsResult {
  items: ScannedInstalledItem[];
  workspaces: string[];
  skipped: SkippedDirectory[];
}

export function matchesIgnore(dirPath: string, rule: string): boolean {
  const normalizedRule = rule.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const ruleSegments = normalizedRule.split('/').filter(Boolean);
  if (ruleSegments.length === 0) return false;

  const normalizedPath = dirPath.replace(/\\/g, '/');
  const pathSegments = normalizedPath.split('/').filter(Boolean);

  if (ruleSegments.length === 1) {
    return pathSegments[pathSegments.length - 1] === ruleSegments[0];
  }

  const rLen = ruleSegments.length;
  for (let i = 0; i <= pathSegments.length - rLen; i++) {
    let match = true;
    for (let j = 0; j < rLen; j++) {
      if (pathSegments[i + j] !== ruleSegments[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

export function isIgnored(dirPath: string, ignoreList: readonly string[]): boolean {
  for (const rule of ignoreList) {
    if (matchesIgnore(dirPath, rule)) {
      return true;
    }
  }
  return false;
}

export async function isWorkspace(dir: string): Promise<boolean> {
  // 1. .claude/
  try {
    const st = await fs.promises.lstat(path.join(dir, '.claude'));
    if (st.isDirectory()) return true;
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }

  // 2. .kilocode/
  try {
    const st = await fs.promises.lstat(path.join(dir, '.kilocode'));
    if (st.isDirectory()) return true;
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }

  // 3. .vscode/ai-swissknife/
  try {
    const st = await fs.promises.lstat(path.join(dir, '.vscode', 'ai-swissknife'));
    if (st.isDirectory()) return true;
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }

  // 4. .ai-swissknife/
  try {
    const st = await fs.promises.lstat(path.join(dir, '.ai-swissknife'));
    if (st.isDirectory()) return true;
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }

  // 5. .kilo/
  try {
    const kiloDir = path.join(dir, '.kilo');
    const st = await fs.promises.lstat(kiloDir);
    if (st.isDirectory()) {
      const entries = await fs.promises.readdir(kiloDir);
      const isOnlyWorktrees = entries.length === 1 && entries[0] === 'worktrees';
      if (!isOnlyWorktrees) {
        return true;
      }
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }

  return false;
}

export async function findWorkspaces(
  roots: string[],
  options?: ScanRootsOptions
): Promise<FindWorkspacesResult> {
  const maxDepth = options?.maxDepth ?? 4;
  const baseIgnore = options?.ignore ? options.ignore : DEFAULT_IGNORE;
  const effectiveIgnore = options?.extraIgnore
    ? [...baseIgnore, ...options.extraIgnore]
    : baseIgnore;

  const workspaces: string[] = [];
  const skippedMap = new Map<string, string>();

  const addSkipped = (p: string, reason: string) => {
    if (!skippedMap.has(p)) {
      skippedMap.set(p, reason);
    }
  };

  const visited = new Set<string>();
  const queue: Array<{ dir: string; root: string; depth: number }> = [];

  for (const rawRoot of roots) {
    const root = path.resolve(rawRoot);
    if (visited.has(root)) continue;
    visited.add(root);

    try {
      const st = await fs.promises.lstat(root);
      if (st.isSymbolicLink()) {
        continue;
      }
      if (!st.isDirectory()) {
        continue;
      }
    } catch (err: any) {
      addSkipped(root, err.message);
      continue;
    }

    try {
      if (await isWorkspace(root)) {
        workspaces.push(root);
        continue;
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        addSkipped(root, err.message);
        continue;
      }
    }

    queue.push({ dir: root, root, depth: 0 });
  }

  while (queue.length > 0) {
    const { dir, root, depth } = queue.shift()!;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (err: any) {
      addSkipped(dir, err.message);
      continue;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (!entry.isDirectory()) {
        continue;
      }

      const childPath = path.join(dir, entry.name);
      if (visited.has(childPath)) continue;
      visited.add(childPath);

      const relPath = path.relative(root, childPath);
      if (isIgnored(relPath, effectiveIgnore)) {
        continue;
      }

      const childDepth = depth + 1;

      try {
        if (await isWorkspace(childPath)) {
          workspaces.push(childPath);
          continue;
        }
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          addSkipped(childPath, err.message);
          continue;
        }
      }

      if (childDepth < maxDepth) {
        queue.push({ dir: childPath, root, depth: childDepth });
      }
    }
  }

  const sortedWorkspaces = Array.from(new Set(workspaces)).sort((a, b) =>
    a.localeCompare(b)
  );
  const sortedSkipped = Array.from(skippedMap.entries())
    .map(([p, reason]) => ({ path: p, reason }))
    .sort((a, b) => a.path.localeCompare(b.path));

  return {
    workspaces: sortedWorkspaces,
    skipped: sortedSkipped,
  };
}

export async function scanInventoryAcrossRoots(
  roots: string[],
  options?: ScanInventoryAcrossRootsOptions
): Promise<ScanInventoryAcrossRootsResult> {
  const { workspaces, skipped } = await findWorkspaces(roots, options?.options);

  const filterAssistants = options?.assistants;
  const filterScopes = options?.scopes;
  const homeRoot = options?.homeRoot;

  const scanGlobal = !filterScopes || filterScopes.includes('global');
  const scanProject = !filterScopes || filterScopes.includes('project');

  const items: ScannedInstalledItem[] = [];

  if (scanGlobal) {
    try {
      const inventory = await scanInstalledInventory('global', undefined, homeRoot);

      for (const m of inventory.managed) {
        if (filterAssistants && !filterAssistants.includes(m.assistant)) continue;
        items.push({
          key: `${m.assistant}:${m.scope}:${m.kind}:${m.name}`,
          kind: m.kind,
          name: m.name,
          assistant: m.assistant,
          scope: m.scope,
          membership: 'managed',
          path: m.path,
          ...(m.source ? { source: m.source } : {}),
          ...(m.sourceId ? { sourceId: m.sourceId } : {}),
          ...(m.packageId ? { packageId: m.packageId } : {}),
          ...(m.artifactId ? { artifactId: m.artifactId } : {}),
          ...(m.contentHash ? { contentHash: m.contentHash } : {}),
          ...(m.provenance ? { provenance: m.provenance } : {}),
          ...(m.provenanceReason ? { provenanceReason: m.provenanceReason } : {}),
          ...(m.provenanceHint ? { provenanceHint: m.provenanceHint } : {}),
          workspace: null,
          flags: [],
        });
      }

      for (const o of inventory.observed) {
        if (filterAssistants && !filterAssistants.includes(o.assistant)) continue;
        const matchedStatus =
          o.match?.status === 'identical'
            ? 'identical'
            : o.match?.status === 'different'
            ? 'different'
            : undefined;

        items.push({
          key: `${o.assistant}:${o.scope}:${o.kind}:${o.name}`,
          kind: o.kind as ItemKind,
          name: o.name,
          assistant: o.assistant,
          scope: o.scope,
          membership: 'observed',
          path: o.path,
          ...(o.match?.sourceId ? { sourceId: o.match.sourceId } : {}),
          ...(o.match?.artifactId ? { artifactId: o.match.artifactId } : {}),
          ...(o.contentHash ? { contentHash: o.contentHash } : {}),
          ...(matchedStatus ? { match: matchedStatus } : {}),
          workspace: null,
          flags: [],
        });
      }
    } catch {
      // ignore global scan errors
    }
  }

  if (scanProject) {
    const multiWorkspace = workspaces.length > 1;

    for (const ws of workspaces) {
      const suffix = multiWorkspace ? `@${path.basename(ws)}` : '';
      try {
        const inventory = await scanInstalledInventory('project', ws, homeRoot);

        for (const m of inventory.managed) {
          if (filterAssistants && !filterAssistants.includes(m.assistant)) continue;
          items.push({
            key: `${m.assistant}:${m.scope}:${m.kind}:${m.name}${suffix}`,
            kind: m.kind,
            name: m.name,
            assistant: m.assistant,
            scope: m.scope,
            membership: 'managed',
            path: m.path,
            ...(m.source ? { source: m.source } : {}),
            ...(m.sourceId ? { sourceId: m.sourceId } : {}),
            ...(m.packageId ? { packageId: m.packageId } : {}),
            ...(m.artifactId ? { artifactId: m.artifactId } : {}),
            ...(m.contentHash ? { contentHash: m.contentHash } : {}),
            ...(m.provenance ? { provenance: m.provenance } : {}),
            ...(m.provenanceReason ? { provenanceReason: m.provenanceReason } : {}),
            ...(m.provenanceHint ? { provenanceHint: m.provenanceHint } : {}),
            workspace: ws,
            flags: [],
          });
        }

        for (const o of inventory.observed) {
          if (filterAssistants && !filterAssistants.includes(o.assistant)) continue;
          const matchedStatus =
            o.match?.status === 'identical'
              ? 'identical'
              : o.match?.status === 'different'
              ? 'different'
              : undefined;

          items.push({
            key: `${o.assistant}:${o.scope}:${o.kind}:${o.name}${suffix}`,
            kind: o.kind as ItemKind,
            name: o.name,
            assistant: o.assistant,
            scope: o.scope,
            membership: 'observed',
            path: o.path,
            ...(o.match?.sourceId ? { sourceId: o.match.sourceId } : {}),
            ...(o.match?.artifactId ? { artifactId: o.match.artifactId } : {}),
            ...(o.contentHash ? { contentHash: o.contentHash } : {}),
            ...(matchedStatus ? { match: matchedStatus } : {}),
            workspace: ws,
            flags: [],
          });
        }
      } catch {
        // ignore workspace scan errors
      }
    }
  }

  await attachFlagsToItems(items, { homeRoot });

  return { items, workspaces, skipped };
}
