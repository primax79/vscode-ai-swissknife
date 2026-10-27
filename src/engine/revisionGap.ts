import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ManagedInstallation, Source } from '../domain/types';
import { runGit, validateGitRef, resolveAndValidateCacheDir } from '../sources/gitProcess';

export type RevisionGapReason =
  | 'not-git'
  | 'no-recorded-commit'
  | 'clone-not-found'
  | 'installed-commit-not-found';

export interface RevisionGap {
  installedRevision: string | null;
  latestRevision: string | null;
  commitsBehind: number | null;
  installedDate: string | null;
  latestDate: string | null;
  behindDays: number | null;
  reason?: RevisionGapReason;
}

export interface DescribeRevisionGapOptions {
  cacheDir?: string;
  homeRoot?: string;
  cloneDir?: string;
  getCloneDir?: (source: Source) => string | undefined;
  getLatestRef?: (cloneDir: string) => Promise<string | undefined> | string | undefined;
  runGit?: typeof runGit;
}

const GIT_SOURCE_TYPES = new Set(['git-custom', 'git-marketplace', 'git-single-item']);

/**
 * Computes how far behind an installed item is relative to its upstream git clone cache.
 * Uses the source's existing clone cache (never clones or fetches by itself).
 */
export async function describeRevisionGap(
  installation: ManagedInstallation,
  source?: Source,
  opts?: DescribeRevisionGapOptions
): Promise<RevisionGap> {
  if (!source || !GIT_SOURCE_TYPES.has(source.type)) {
    return {
      installedRevision: null,
      latestRevision: null,
      commitsBehind: null,
      installedDate: null,
      latestDate: null,
      behindDays: null,
      reason: 'not-git',
    };
  }

  const installedCommit = installation.sourceRevision?.commit;
  if (!installedCommit || installedCommit.trim() === '') {
    return {
      installedRevision: null,
      latestRevision: null,
      commitsBehind: null,
      installedDate: null,
      latestDate: null,
      behindDays: null,
      reason: 'no-recorded-commit',
    };
  }

  // Validate the recorded commit ref before any git execution (rejects malicious refs)
  validateGitRef('commit', installedCommit);

  const gitFn = opts?.runGit ?? runGit;

  let cloneDir: string | undefined;
  if (opts?.cloneDir) {
    cloneDir = opts.cloneDir;
  } else if (opts?.getCloneDir) {
    cloneDir = opts.getCloneDir(source);
  } else {
    const baseCacheDir =
      opts?.cacheDir ?? path.join(opts?.homeRoot ?? os.homedir(), '.ai-swissknife', 'cache', 'sources');
    const { targetDir } = resolveAndValidateCacheDir(baseCacheDir, source.id);
    cloneDir = targetDir;
  }

  if (!cloneDir || !fs.existsSync(cloneDir) || !fs.existsSync(path.join(cloneDir, '.git'))) {
    return {
      installedRevision: installedCommit,
      latestRevision: null,
      commitsBehind: null,
      installedDate: null,
      latestDate: null,
      behindDays: null,
      reason: 'clone-not-found',
    };
  }

  // Determine latest revision in clone
  let latestRevision: string | undefined;
  if (opts?.getLatestRef) {
    latestRevision = await opts.getLatestRef(cloneDir);
  }
  if (!latestRevision) {
    const { stdout: headSha } = await gitFn(['rev-parse', 'HEAD'], cloneDir);
    latestRevision = headSha.trim();
  }
  validateGitRef('commit', latestRevision);

  // Latest commit date
  const { stdout: latestDateRaw } = await gitFn(['log', '-1', '--format=%cI', 'HEAD', '--'], cloneDir);
  const latestDate = new Date(latestDateRaw.trim()).toISOString();

  // Check if installed commit exists in the clone and get its date
  let installedDate: string | null = null;
  try {
    const { stdout: instDateRaw } = await gitFn(
      ['log', '-1', '--format=%cI', installedCommit, '--'],
      cloneDir
    );
    installedDate = new Date(instDateRaw.trim()).toISOString();
  } catch {
    return {
      installedRevision: installedCommit,
      latestRevision,
      commitsBehind: null,
      installedDate: null,
      latestDate,
      behindDays: null,
      reason: 'installed-commit-not-found',
    };
  }

  // Count commits behind
  let commitsBehind: number | null = null;
  try {
    const { stdout: countRaw } = await gitFn(
      ['rev-list', '--count', `${installedCommit}..HEAD`, '--'],
      cloneDir
    );
    const parsed = parseInt(countRaw.trim(), 10);
    commitsBehind = Number.isFinite(parsed) ? parsed : null;
  } catch {
    return {
      installedRevision: installedCommit,
      latestRevision,
      commitsBehind: null,
      installedDate: null,
      latestDate,
      behindDays: null,
      reason: 'installed-commit-not-found',
    };
  }

  // Compute behindDays
  let behindDays: number | null = null;
  if (commitsBehind !== null && installedDate && latestDate) {
    if (commitsBehind === 0) {
      behindDays = 0;
    } else {
      const diffMs = new Date(latestDate).getTime() - new Date(installedDate).getTime();
      behindDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
    }
  }

  return {
    installedRevision: installedCommit,
    latestRevision,
    commitsBehind,
    installedDate,
    latestDate,
    behindDays,
  };
}
