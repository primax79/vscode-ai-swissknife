import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import type { Source, Package, Artifact } from '../domain/types';
import { findSkillDirs } from './detect';

const execFileAsync = promisify(child_process.execFile);

export interface GitCustomResolveOptions {
  cacheDir?: string;
}

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

  const baseCacheDir = opts?.cacheDir ?? path.join(os.homedir(), '.ai-toolkit', 'cache', 'sources');
  const sanitizedId = source.id.replace(/[^a-zA-Z0-9._-]/g, '_');
  const targetDir = path.join(baseCacheDir, sanitizedId);

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
    await runGit(['clone', source.url, targetDir]);
  }

  // Ref precedence: commit > tag > branch > default branch
  let resolvedVersion: string | undefined;
  if (source.commit) {
    resolvedVersion = source.commit;
    await runGit(['checkout', source.commit], targetDir);
  } else if (source.tag) {
    resolvedVersion = source.tag;
    await runGit(['checkout', source.tag], targetDir);
  } else if (source.branch) {
    resolvedVersion = source.branch;
    await runGit(['checkout', source.branch], targetDir);
    try {
      await runGit(['reset', '--hard', `origin/${source.branch}`], targetDir);
    } catch {
      // Remote branch may not exist if working locally or detached
    }
  } else {
    const defaultBranch = await getDefaultBranch(targetDir);
    resolvedVersion = defaultBranch;
    await runGit(['checkout', defaultBranch], targetDir);
    try {
      await runGit(['reset', '--hard', `origin/${defaultBranch}`], targetDir);
    } catch {
      // Remote branch may not exist if working locally or detached
    }
  }

  const skillDirs = await findSkillDirs(targetDir);

  return skillDirs.map((skillDir) => {
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
      version: resolvedVersion,
      nativeFormat: 'claude-skill',
      artifacts: [artifact],
    };

    return pkg;
  });
}
