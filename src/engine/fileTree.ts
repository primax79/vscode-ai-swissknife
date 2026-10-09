import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { PreparedInstall } from './types';

export interface ChangedFilesMap {
  added: string[];
  changed: string[];
  removed: string[];
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

/**
 * Computes the added, changed, and removed files for a prepared install plan.
 */
export function computePlanChangedFiles(prepared: PreparedInstall): ChangedFilesMap {
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
