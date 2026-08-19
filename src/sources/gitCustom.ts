import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import type { Source, Package, Artifact, ResolvedRevision, ResolvedArtifact } from '../domain/types';
import type { CanonicalSkill } from '../adapters/types';
import { readSkill } from '../adapters/codec';
import { findSkillDirs } from './detect';

const execFileAsync = promisify(child_process.execFile);

export interface GitCustomResolveOptions {
  cacheDir?: string;
}

export class KeyedMutex {
  private queues = new Map<string, Promise<unknown>>();

  async runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const canonicalKey = path.resolve(key);
    const prev = this.queues.get(canonicalKey) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.queues.set(canonicalKey, prev.then(() => next, () => next));
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.queues.get(canonicalKey) === next) {
        this.queues.delete(canonicalKey);
      }
    }
  }
}

export const gitCustomMutex = new KeyedMutex();

async function runGit(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync('git', args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
      },
    });
  } catch (err: unknown) {
    const error = err as Error & { stdout?: string; stderr?: string; code?: number };
    const stderr = error.stderr ? `: ${error.stderr.trim()}` : (error.message ? `: ${error.message}` : '');
    throw new Error(`Git command failed [git ${args.join(' ')}]${stderr}`);
  }
}

async function getDefaultBranch(cwd: string): Promise<string> {
  try {
    const { stdout } = await runGit(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], cwd);
    return stdout.trim().replace(/^origin\//, '');
  } catch {
    // fallback
  }

  try {
    const { stdout } = await runGit(['branch', '--show-current'], cwd);
    const current = stdout.trim();
    if (current) {
      return current;
    }
  } catch {
    // fallback
  }

  return 'main';
}

/**
 * Resolves a `Source` of type `git-custom` by cloning or fetching the git repository into a local cache directory,
 * checking out the requested ref (commit > tag > branch > default branch), and scanning for skills.
 */
export async function resolveGitCustom(
  source: Source,
  opts?: GitCustomResolveOptions
): Promise<Package[]> {
  if (!source.url || source.url.trim() === '') {
    throw new Error(`source.url is required for git-custom source "${source.id}"`);
  }

  const baseCacheDir = opts?.cacheDir ?? path.join(os.homedir(), '.ai-swissknife', 'cache', 'sources');
  const sanitizedId = source.id.replace(/[^a-zA-Z0-9._-]/g, '_');
  const targetDir = path.join(baseCacheDir, sanitizedId);

  return gitCustomMutex.runExclusive(targetDir, async () => {
    // If target directory exists but is not a valid git repo, clear it before cloning
    if (fs.existsSync(targetDir) && !fs.existsSync(path.join(targetDir, '.git'))) {
      await fs.promises.rm(targetDir, { recursive: true, force: true });
    }

    const isExistingRepo = fs.existsSync(path.join(targetDir, '.git'));

    if (isExistingRepo) {
      // Fetch latest remote changes, tags, and prune deleted branches
      await runGit(['fetch', '--all', '--tags', '--prune'], targetDir);
    } else {
      // Fresh clone
      await fs.promises.mkdir(path.dirname(targetDir), { recursive: true });
      await runGit(['clone', source.url!, targetDir]);
    }

    // Ref precedence: commit > tag > branch > default branch
    let requestedRef: string | undefined;
    if (source.commit) {
      requestedRef = source.commit;
      await runGit(['checkout', source.commit], targetDir);
    } else if (source.tag) {
      requestedRef = source.tag;
      await runGit(['checkout', source.tag], targetDir);
    } else if (source.branch) {
      requestedRef = source.branch;
      await runGit(['checkout', source.branch], targetDir);
      try {
        await runGit(['reset', '--hard', `origin/${source.branch}`], targetDir);
      } catch {
        // Remote branch may not exist if working locally or detached
      }
    } else {
      const defaultBranch = await getDefaultBranch(targetDir);
      await runGit(['checkout', defaultBranch], targetDir);
      try {
        await runGit(['reset', '--hard', `origin/${defaultBranch}`], targetDir);
      } catch {
        // Remote branch may not exist if working locally or detached
      }
    }

    const { stdout: commitSha } = await runGit(['rev-parse', 'HEAD'], targetDir);
    const commit = commitSha.trim();
    const version: ResolvedRevision = {
      commit,
      ...(requestedRef ? { requestedRef } : {}),
    };

    const { skills } = await findSkillDirs(targetDir);

    return skills.map((skillDir) => {
      const relPath = path.relative(targetDir, skillDir.path);
      const pathId = relPath === '' ? skillDir.name : relPath;
      const packageId = `${source.id}:${pathId}`;
      const artifactId = `${packageId}:${skillDir.name}`;

      const artifact: Artifact = {
        id: artifactId,
        packageId,
        kind: 'skill',
        name: skillDir.name,
        description: skillDir.description,
        nativeFormat: 'claude-skill',
      };

      const pkg: Package = {
        id: packageId,
        sourceId: source.id,
        version,
        nativeFormat: 'claude-skill',
        artifacts: [artifact],
      };

      return pkg;
    });
  });
}

/**
 * Resolves content for a skill artifact from a git-custom source.
 * Locks the cache directory across checking out the commit and reading the full canonical skill.
 */
export async function resolveArtifactContent(
  source: Source,
  pkg: Package,
  artifact: Artifact,
  opts?: GitCustomResolveOptions
): Promise<ResolvedArtifact<CanonicalSkill>> {
  if (source.type !== 'git-custom') {
    throw new Error(`Expected source.type === "git-custom", got "${source.type}"`);
  }
  if (pkg.sourceId !== source.id) {
    throw new Error(`Package sourceId mismatch: expected "${source.id}", got "${pkg.sourceId}"`);
  }
  if (artifact.packageId !== pkg.id) {
    throw new Error(`Artifact packageId mismatch: expected "${pkg.id}", got "${artifact.packageId}"`);
  }
  if (artifact.kind !== 'skill') {
    throw new Error(`Unsupported artifact kind: "${artifact.kind}" (only skill is supported in Phase 1)`);
  }
  if (!pkg.version?.commit) {
    throw new Error('Package version commit is required for git-custom content resolution');
  }

  const baseCacheDir = opts?.cacheDir ?? path.join(os.homedir(), '.ai-swissknife', 'cache', 'sources');
  const sanitizedId = source.id.replace(/[^a-zA-Z0-9._-]/g, '_');
  const targetDir = path.join(baseCacheDir, sanitizedId);

  return gitCustomMutex.runExclusive(targetDir, async () => {
    if (!fs.existsSync(path.join(targetDir, '.git'))) {
      throw new Error(`Git cache directory not found or invalid: "${targetDir}"`);
    }

    await runGit(['checkout', pkg.version!.commit], targetDir);

    const prefix = `${source.id}:`;
    const pathId = pkg.id.startsWith(prefix) ? pkg.id.slice(prefix.length) : '';
    const candidate1 = path.join(targetDir, pathId);
    let skillDir: string;

    if (fs.existsSync(path.join(candidate1, 'SKILL.md'))) {
      skillDir = candidate1;
    } else if (fs.existsSync(path.join(targetDir, 'SKILL.md'))) {
      skillDir = targetDir;
    } else {
      throw new Error(`Cannot locate skill directory for artifact "${artifact.name}" in "${targetDir}"`);
    }

    const content = await readSkill(skillDir);
    return { artifact, content };
  });
}
