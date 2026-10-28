import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Source, Package, Artifact, ResolvedRevision, ResolvedArtifact, ItemKind } from '../domain/types';
import type {
  CanonicalSkill,
  CanonicalAgent,
  CanonicalCommand,
  CanonicalMcpServer,
  CanonicalHook,
  CanonicalRule,
} from '../adapters/types';
import type { SourceResolution, SourceResolver } from './types';
import { readSkill } from '../adapters/codec';
import { parseClaudeAgentMarkdown, parseClaudeCommandMarkdown } from '../adapters/claude';
import { extractSkillFrontmatter } from './detect';
import { KeyedMutex } from './gitCustom';
import {
  runGit,
  validateGitUrl,
  validateGitRef,
  resolveAndValidateCacheDir,
} from './gitProcess';

export const gitSingleItemMutex = new KeyedMutex();

async function getDefaultBranch(cwd: string): Promise<string> {
  try {
    const { stdout } = await runGit(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], cwd);
    return stdout.trim().replace(/^origin\//, '');
  } catch {
    return 'main';
  }
}

/**
 * Resolves a `Source` of type `git-single-item` where the repository root itself represents a single artifact.
 */
export async function resolveGitSingleItem(
  source: Source,
  opts?: { cacheDir?: string; homeRoot?: string; offline?: boolean }
): Promise<SourceResolution> {
  validateGitUrl(source.type, source.url, source.id);
  if (source.commit) validateGitRef('commit', source.commit);
  if (source.tag) validateGitRef('tag', source.tag);
  if (source.branch) validateGitRef('branch', source.branch);

  const baseCacheDir = opts?.cacheDir ?? path.join(opts?.homeRoot ?? os.homedir(), '.ai-swissknife', 'cache', 'sources');
  const { targetDir } = resolveAndValidateCacheDir(baseCacheDir, source.id, source.url);

  return gitSingleItemMutex.runExclusive(targetDir, async () => {
    if (fs.existsSync(targetDir) && !fs.existsSync(path.join(targetDir, '.git'))) {
      const resolvedTarget = path.resolve(targetDir);
      const resolvedBase = path.resolve(baseCacheDir);
      if (!resolvedTarget.startsWith(resolvedBase + path.sep)) {
        throw new Error(`Refusing to remove directory outside cache base: "${resolvedTarget}"`);
      }
      await fs.promises.rm(targetDir, { recursive: true, force: true });
    }

    const isExistingRepo = fs.existsSync(path.join(targetDir, '.git'));

    let requestedRef: string | undefined;
    if (opts?.offline) {
      if (!isExistingRepo) {
        const err = new Error(
          `Git cache clone not found for offline resolution of source "${source.id}"`
        ) as Error & { code?: string };
        err.code = 'OFFLINE_CACHE_MISS';
        throw err;
      }
      if (source.commit) {
        requestedRef = source.commit;
        const { stdout: currentHead } = await runGit(['rev-parse', 'HEAD'], targetDir);
        if (currentHead.trim() !== source.commit) {
          await runGit(['checkout', source.commit, '--'], targetDir);
        }
      } else if (source.tag) {
        requestedRef = source.tag;
      } else if (source.branch) {
        requestedRef = source.branch;
      }
    } else {
      if (isExistingRepo) {
        await runGit(['fetch', '--all', '--tags', '--prune'], targetDir);
      } else {
        await fs.promises.mkdir(path.dirname(targetDir), { recursive: true });
        await runGit(['clone', '--', source.url!, targetDir]);
      }

      if (source.commit) {
        requestedRef = source.commit;
        await runGit(['checkout', source.commit, '--'], targetDir);
      } else if (source.tag) {
        requestedRef = source.tag;
        await runGit(['checkout', source.tag, '--'], targetDir);
      } else if (source.branch) {
        requestedRef = source.branch;
        await runGit(['checkout', source.branch, '--'], targetDir);
        try {
          await runGit(['reset', '--hard', `origin/${source.branch}`], targetDir);
        } catch {
          // ignore
        }
      } else {
        const defaultBranch = await getDefaultBranch(targetDir);
        await runGit(['checkout', defaultBranch, '--'], targetDir);
        try {
          await runGit(['reset', '--hard', `origin/${defaultBranch}`], targetDir);
        } catch {
          // ignore
        }
      }
    }

    const { stdout: commitSha } = await runGit(['rev-parse', 'HEAD'], targetDir);
    const commit = commitSha.trim();
    const version: ResolvedRevision = {
      commit,
      ...(requestedRef ? { requestedRef } : {}),
    };

    let kind: ItemKind = 'skill';
    let name = source.name ?? source.id;
    let description = '';

    if (fs.existsSync(path.join(targetDir, 'SKILL.md'))) {
      kind = 'skill';
      try {
        const raw = await fs.promises.readFile(path.join(targetDir, 'SKILL.md'), 'utf-8');
        const fm = extractSkillFrontmatter(raw);
        if (fm.name) name = fm.name;
        if (fm.description) description = fm.description;
      } catch {
        // ignore
      }
    } else if (fs.existsSync(path.join(targetDir, 'mcp.json')) || fs.existsSync(path.join(targetDir, '.mcp.json'))) {
      kind = 'mcp-server';
    } else if (fs.existsSync(path.join(targetDir, 'CLAUDE.md')) || fs.existsSync(path.join(targetDir, 'AGENTS.md'))) {
      kind = 'rule';
    }

    const packageId = `${source.id}:${name}`;
    const artifactId = `${packageId}:${name}`;

    const artifact: Artifact = {
      id: artifactId,
      packageId,
      kind,
      name,
      description,
      nativeFormat: `claude-${kind}`,
      path: targetDir,
    };

    const pkg: Package = {
      id: packageId,
      sourceId: source.id,
      version,
      nativeFormat: `claude-${kind}`,
      artifacts: [artifact],
    };

    return {
      packages: [pkg],
      diagnostics: [],
    };
  });
}

/**
 * Resolves content for a git-single-item source.
 */
export async function resolveArtifactContent(
  source: Source,
  pkg: Package,
  artifact: Artifact,
  opts?: { cacheDir?: string; homeRoot?: string }
): Promise<ResolvedArtifact<CanonicalSkill | CanonicalAgent | CanonicalCommand | CanonicalMcpServer | CanonicalHook | CanonicalRule>> {
  const baseCacheDir = opts?.cacheDir ?? path.join(opts?.homeRoot ?? os.homedir(), '.ai-swissknife', 'cache', 'sources');
  const { targetDir } = resolveAndValidateCacheDir(baseCacheDir, source.id, source.url);

  return gitSingleItemMutex.runExclusive(targetDir, async () => {
    if (artifact.kind === 'skill') {
      const content = await readSkill(targetDir);
      return { artifact, content };
    }

    if (artifact.kind === 'rule') {
      const ruleFile = fs.existsSync(path.join(targetDir, 'CLAUDE.md'))
        ? path.join(targetDir, 'CLAUDE.md')
        : path.join(targetDir, 'AGENTS.md');
      const content: CanonicalRule = {
        name: artifact.name,
        content: await fs.promises.readFile(ruleFile, 'utf-8'),
      };
      return { artifact, content };
    }

    if (artifact.kind === 'agent') {
      const raw = await fs.promises.readFile(path.join(targetDir, `${artifact.name}.md`), 'utf-8');
      const content = parseClaudeAgentMarkdown(raw);
      return { artifact, content };
    }

    if (artifact.kind === 'command') {
      const raw = await fs.promises.readFile(path.join(targetDir, `${artifact.name}.md`), 'utf-8');
      const content = parseClaudeCommandMarkdown(raw, artifact.name);
      return { artifact, content };
    }

    if (artifact.kind === 'mcp-server') {
      const mcpFile = fs.existsSync(path.join(targetDir, 'mcp.json'))
        ? path.join(targetDir, 'mcp.json')
        : path.join(targetDir, '.mcp.json');
      const raw = await fs.promises.readFile(mcpFile, 'utf-8');
      const parsed = JSON.parse(raw);
      const serverConfig = parsed.mcpServers?.[artifact.name] ?? parsed;
      const content: CanonicalMcpServer = {
        id: artifact.name,
        type: serverConfig.type ?? (serverConfig.command ? 'stdio' : 'sse'),
        command: serverConfig.command,
        args: serverConfig.args,
        url: serverConfig.url,
        env: serverConfig.env,
        headers: serverConfig.headers,
        extraFields: { ...serverConfig },
      };
      return { artifact, content };
    }

    throw new Error(`Unsupported artifact kind: ${artifact.kind}`);
  });
}

export const gitSingleItemResolver: SourceResolver = {
  type: 'git-single-item',
  displayName: 'Git (single item)',
  iconThemeId: 'git-commit',
  resolve: resolveGitSingleItem,
  resolveArtifactContent,
};

