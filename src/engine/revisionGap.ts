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
  currentCommit?: string;
  getCloneDir?: (source: Source) => string | undefined;
  getLatestRef?: (cloneDir: string) => Promise<string | undefined> | string | undefined;
  runGit?: typeof runGit;
}

const REMOTE_GIT_SOURCE_TYPES = new Set(['git-custom', 'git-marketplace', 'git-single-item']);

async function isGitWorkingTree(dirPath: string, gitFn: typeof runGit): Promise<boolean> {
  if (!fs.existsSync(dirPath)) {
    return false;
  }
  if (fs.existsSync(path.join(dirPath, '.git'))) {
    return true;
  }
  try {
    await gitFn(['rev-parse', '--git-dir'], dirPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Computes how far behind an installed item is relative to its upstream git clone cache
 * or git local-folder repository.
 * Uses the source's existing clone cache or local folder (never clones or fetches by itself).
 */
export async function describeRevisionGap(
  installation: ManagedInstallation,
  source?: Source,
  opts?: DescribeRevisionGapOptions
): Promise<RevisionGap> {
  const installedCommit = installation.sourceRevision?.commit;
  if (installedCommit && installedCommit.trim() !== '') {
    // Validate the recorded commit ref before any git execution (rejects malicious refs)
    validateGitRef('commit', installedCommit);
  }

  if (
    !source ||
    (!REMOTE_GIT_SOURCE_TYPES.has(source.type) && source.type !== 'local-folder')
  ) {
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

  const gitFn = opts?.runGit ?? runGit;

  let cloneDir: string | undefined;
  if (opts?.cloneDir) {
    cloneDir = opts.cloneDir;
  } else if (opts?.getCloneDir) {
    cloneDir = opts.getCloneDir(source);
  } else if (source.type === 'local-folder') {
    const rawLocalPath = source.localPath ?? installation.source?.location ?? '';
    const localPath = rawLocalPath
      ? path.isAbsolute(rawLocalPath)
        ? rawLocalPath
        : path.resolve(source.projectPath ?? installation.projectPath ?? process.cwd(), rawLocalPath)
      : undefined;

    if (!localPath || !fs.existsSync(localPath)) {
      if (!installedCommit || installedCommit.trim() === '') {
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

    const isGit = await isGitWorkingTree(localPath, gitFn);
    if (!isGit) {
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
    cloneDir = localPath;
  } else {
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
    const baseCacheDir =
      opts?.cacheDir ?? path.join(opts?.homeRoot ?? os.homedir(), '.ai-swissknife', 'cache', 'sources');
    const location = source.url ?? installation.source?.location;
    const { targetDir } = resolveAndValidateCacheDir(baseCacheDir, source.id, location);
    cloneDir = targetDir;
  }

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

  if (
    !cloneDir ||
    !fs.existsSync(cloneDir) ||
    (source.type !== 'local-folder' && !fs.existsSync(path.join(cloneDir, '.git')))
  ) {
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

  // Determine latest revision in clone/repo
  let latestRevision: string | undefined = opts?.currentCommit;
  if (!latestRevision && opts?.getLatestRef) {
    latestRevision = await opts.getLatestRef(cloneDir);
  }
  if (!latestRevision) {
    try {
      const { stdout: headSha } = await gitFn(['rev-parse', 'HEAD'], cloneDir);
      latestRevision = headSha.trim();
    } catch {
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
  }
  validateGitRef('commit', latestRevision);

  // Latest commit date
  let latestDate: string | null = null;
  try {
    const { stdout: latestDateRaw } = await gitFn(
      ['log', '-1', '--format=%cI', latestRevision, '--'],
      cloneDir
    );
    latestDate = new Date(latestDateRaw.trim()).toISOString();
  } catch {
    latestDate = null;
  }

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
  if (installedCommit === latestRevision) {
    commitsBehind = 0;
  } else {
    try {
      const { stdout: countRaw } = await gitFn(
        ['rev-list', '--count', `${installedCommit}..${latestRevision}`, '--'],
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
