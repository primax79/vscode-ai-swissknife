import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Source, Package, Artifact, ResolvedRevision, ResolvedArtifact } from '../domain/types';
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
import {
  findSkillDirs,
  findAgentFiles,
  findCommandFiles,
  findMcpDefinitions,
  findHookFiles,
  findRuleFiles,
} from './detect';
import {
  runGit,
  validateGitUrl,
  validateGitRef,
  resolveAndValidateCacheDir,
} from './gitProcess';

export interface GitCustomResolveOptions {
  cacheDir?: string;
  /** Home root for the default cache dir (tests); ignored when cacheDir is set. */
  homeRoot?: string;
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
 * Resolves a `Source` of type `git-custom` detecting all artifact kinds.
 */
export async function resolveGitCustom(
  source: Source,
  opts?: GitCustomResolveOptions
): Promise<SourceResolution> {
  validateGitUrl(source.type, source.url, source.id);
  if (source.commit) validateGitRef('commit', source.commit);
  if (source.tag) validateGitRef('tag', source.tag);
  if (source.branch) validateGitRef('branch', source.branch);

  const baseCacheDir = opts?.cacheDir ?? path.join(opts?.homeRoot ?? os.homedir(), '.ai-swissknife', 'cache', 'sources');
  const { targetDir } = resolveAndValidateCacheDir(baseCacheDir, source.id);

  return gitCustomMutex.runExclusive(targetDir, async () => {
    if (fs.existsSync(targetDir) && !fs.existsSync(path.join(targetDir, '.git'))) {
      const resolvedTarget = path.resolve(targetDir);
      const resolvedBase = path.resolve(baseCacheDir);
      if (!resolvedTarget.startsWith(resolvedBase + path.sep)) {
        throw new Error(`Refusing to remove directory outside cache base: "${resolvedTarget}"`);
      }
      await fs.promises.rm(targetDir, { recursive: true, force: true });
    }

    const isExistingRepo = fs.existsSync(path.join(targetDir, '.git'));

    if (isExistingRepo) {
      await runGit(['fetch', '--all', '--tags', '--prune'], targetDir);
    } else {
      await fs.promises.mkdir(path.dirname(targetDir), { recursive: true });
      await runGit(['clone', '--', source.url!, targetDir]);
    }

    let requestedRef: string | undefined;
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

    const { stdout: commitSha } = await runGit(['rev-parse', 'HEAD'], targetDir);
    const commit = commitSha.trim();
    const version: ResolvedRevision = {
      commit,
      ...(requestedRef ? { requestedRef } : {}),
    };

    const skillDetection = await findSkillDirs(targetDir);
    const agentDetection = await findAgentFiles(targetDir);
    const commandDetection = await findCommandFiles(targetDir);
    const mcpDetection = await findMcpDefinitions(targetDir);
    const hookDetection = await findHookFiles(targetDir);
    const ruleDetection = await findRuleFiles(targetDir);

    const skillPackages: Package[] = skillDetection.skills.map((skillDir) => {
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
        path: skillDir.path,
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

    const agentPackages: Package[] = agentDetection.agents.map((agentFile) => {
      const relPath = path.relative(targetDir, agentFile.path);
      const packageId = `${source.id}:${relPath}`;
      const artifactId = `${packageId}:${agentFile.name}`;

      const artifact: Artifact = {
        id: artifactId,
        packageId,
        kind: 'agent',
        name: agentFile.name,
        description: agentFile.description,
        nativeFormat: 'claude-agent',
        path: agentFile.path,
      };

      const pkg: Package = {
        id: packageId,
        sourceId: source.id,
        version,
        nativeFormat: 'claude-agent',
        artifacts: [artifact],
      };

      return pkg;
    });

    const commandPackages: Package[] = commandDetection.commands.map((cmdFile) => {
      const relPath = path.relative(targetDir, cmdFile.path);
      const packageId = `${source.id}:${relPath}`;
      const artifactId = `${packageId}:${cmdFile.name}`;

      const artifact: Artifact = {
        id: artifactId,
        packageId,
        kind: 'command',
        name: cmdFile.name,
        description: cmdFile.description,
        nativeFormat: 'claude-command',
        path: cmdFile.path,
      };

      const pkg: Package = {
        id: packageId,
        sourceId: source.id,
        version,
        nativeFormat: 'claude-command',
        artifacts: [artifact],
      };

      return pkg;
    });

    const mcpPackages: Package[] = mcpDetection.mcpServers.map((mcpServer) => {
      const relPath = path.relative(targetDir, mcpServer.path);
      const packageId = `${source.id}:${relPath}:${mcpServer.id}`;
      const artifactId = `${packageId}:${mcpServer.id}`;

      const artifact: Artifact = {
        id: artifactId,
        packageId,
        kind: 'mcp-server',
        name: mcpServer.id,
        description: mcpServer.description ?? `MCP Server (${mcpServer.type})`,
        nativeFormat: 'mcp-config',
        path: mcpServer.path,
      };

      const pkg: Package = {
        id: packageId,
        sourceId: source.id,
        version,
        nativeFormat: 'mcp-config',
        artifacts: [artifact],
      };

      return pkg;
    });

    const hookPackages: Package[] = hookDetection.hooks.map((h) => {
      const relPath = path.relative(targetDir, h.path);
      const packageId = `${source.id}:${relPath}`;
      const artifactId = `${packageId}:${h.name}`;

      const artifact: Artifact = {
        id: artifactId,
        packageId,
        kind: 'hook',
        name: h.name,
        description: `Hook on ${h.event}: ${h.command}`,
        nativeFormat: 'claude-hook',
        path: h.path,
      };

      const pkg: Package = {
        id: packageId,
        sourceId: source.id,
        version,
        nativeFormat: 'claude-hook',
        artifacts: [artifact],
      };

      return pkg;
    });

    const rulePackages: Package[] = ruleDetection.rules.map((r) => {
      const relPath = path.relative(targetDir, r.path);
      const packageId = `${source.id}:${relPath}`;
      const artifactId = `${packageId}:${r.name}`;

      const artifact: Artifact = {
        id: artifactId,
        packageId,
        kind: 'rule',
        name: r.name,
        description: 'Project rule instructions',
        nativeFormat: 'plain-rule',
        path: r.path,
      };

      const pkg: Package = {
        id: packageId,
        sourceId: source.id,
        version,
        nativeFormat: 'plain-rule',
        artifacts: [artifact],
      };

      return pkg;
    });

    return {
      packages: [
        ...skillPackages,
        ...agentPackages,
        ...commandPackages,
        ...mcpPackages,
        ...hookPackages,
        ...rulePackages,
      ],
      diagnostics: [
        ...skillDetection.diagnostics,
        ...agentDetection.diagnostics,
        ...commandDetection.diagnostics,
        ...mcpDetection.diagnostics,
        ...hookDetection.diagnostics,
        ...ruleDetection.diagnostics,
      ],
    };
  });
}

/**
 * Resolves content for any artifact kind from a git-custom source.
 */
export async function resolveArtifactContent(
  source: Source,
  pkg: Package,
  artifact: Artifact,
  opts?: GitCustomResolveOptions
): Promise<ResolvedArtifact<CanonicalSkill | CanonicalAgent | CanonicalCommand | CanonicalMcpServer | CanonicalHook | CanonicalRule>> {
  if (source.type !== 'git-custom') {
    throw new Error(`Expected source.type === "git-custom", got "${source.type}"`);
  }
  if (pkg.sourceId !== source.id) {
    throw new Error(`Package sourceId mismatch: expected "${source.id}", got "${pkg.sourceId}"`);
  }
  if (artifact.packageId !== pkg.id) {
    throw new Error(`Artifact packageId mismatch: expected "${pkg.id}", got "${artifact.packageId}"`);
  }
  if (!pkg.version?.commit) {
    throw new Error('Package version commit is required for git-custom content resolution');
  }
  validateGitRef('commit', pkg.version.commit);

  const baseCacheDir = opts?.cacheDir ?? path.join(opts?.homeRoot ?? os.homedir(), '.ai-swissknife', 'cache', 'sources');
  const { targetDir } = resolveAndValidateCacheDir(baseCacheDir, source.id);

  return gitCustomMutex.runExclusive(targetDir, async () => {
    if (!fs.existsSync(path.join(targetDir, '.git'))) {
      throw new Error(`Git cache directory not found or invalid: "${targetDir}"`);
    }

    await runGit(['checkout', pkg.version!.commit, '--'], targetDir);

    const prefix = `${source.id}:`;
    const pathId = pkg.id.startsWith(prefix) ? pkg.id.slice(prefix.length) : '';

    if (artifact.kind === 'skill') {
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
    }

    if (artifact.kind === 'agent') {
      const candidate1 = path.join(targetDir, pathId);
      const candidate2 = path.join(targetDir, `${artifact.name}.md`);
      const candidate3 = path.join(targetDir, 'agents', `${artifact.name}.md`);

      let agentFile = '';
      for (const cand of [candidate1, candidate2, candidate3]) {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
          agentFile = cand;
          break;
        }
      }
      if (!agentFile) {
        throw new Error(`Cannot locate agent file for "${artifact.name}" in "${targetDir}"`);
      }

      const raw = await fs.promises.readFile(agentFile, 'utf-8');
      const content = parseClaudeAgentMarkdown(raw);
      return { artifact, content };
    }

    if (artifact.kind === 'command') {
      const candidate1 = path.join(targetDir, pathId);
      const candidate2 = path.join(targetDir, `${artifact.name}.md`);
      const candidate3 = path.join(targetDir, 'commands', `${artifact.name}.md`);
      const candidate4 = path.join(targetDir, 'command', `${artifact.name}.md`);

      let cmdFile = '';
      for (const cand of [candidate1, candidate2, candidate3, candidate4]) {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
          cmdFile = cand;
          break;
        }
      }
      if (!cmdFile) {
        throw new Error(`Cannot locate command file for "${artifact.name}" in "${targetDir}"`);
      }

      const raw = await fs.promises.readFile(cmdFile, 'utf-8');
      const content = parseClaudeCommandMarkdown(raw, artifact.name);
      return { artifact, content };
    }

    if (artifact.kind === 'mcp-server') {
      const candidate1 = path.join(targetDir, 'mcp.json');
      const candidate2 = path.join(targetDir, '.mcp.json');
      const candidate3 = path.join(targetDir, 'mcps', `${artifact.name}.json`);
      const candidate4 = path.join(targetDir, pathId.split(':')[0]);

      let raw = '';
      for (const cand of [candidate1, candidate2, candidate3, candidate4]) {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
          raw = await fs.promises.readFile(cand, 'utf-8');
          break;
        }
      }
      if (!raw) {
        throw new Error(`Cannot locate MCP server definition for "${artifact.name}" in "${targetDir}"`);
      }

      const parsed = JSON.parse(raw);
      const serverConfig = (parsed.mcpServers?.[artifact.name] ?? parsed.mcp?.[artifact.name] ?? (parsed.command || parsed.url ? parsed : {})) as Record<string, unknown>;
      const extraFields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(serverConfig)) {
        if (!['id', 'type', 'command', 'args', 'url', 'env', 'headers'].includes(k)) {
          extraFields[k] = v;
        }
      }

      const content: CanonicalMcpServer = {
        id: artifact.name,
        type: (serverConfig.type as 'stdio' | 'http' | 'sse') ?? (serverConfig.command ? 'stdio' : 'sse'),
        ...(serverConfig.command ? { command: String(serverConfig.command) } : {}),
        ...(Array.isArray(serverConfig.args) ? { args: serverConfig.args.map(String) } : {}),
        ...(serverConfig.url ? { url: String(serverConfig.url) } : {}),
        ...(serverConfig.env ? { env: serverConfig.env as Record<string, string> } : {}),
        ...(serverConfig.headers ? { headers: serverConfig.headers as Record<string, string> } : {}),
        extraFields,
      };
      return { artifact, content };
    }

    if (artifact.kind === 'hook') {
      const candidate1 = path.join(targetDir, pathId);
      const candidate2 = path.join(targetDir, 'hooks', `${artifact.name}.json`);
      const candidate3 = path.join(targetDir, `${artifact.name}.json`);

      let hookFile = '';
      for (const cand of [candidate1, candidate2, candidate3]) {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
          hookFile = cand;
          break;
        }
      }
      if (!hookFile) {
        throw new Error(`Cannot locate hook file for "${artifact.name}" in "${targetDir}"`);
      }

      const raw = await fs.promises.readFile(hookFile, 'utf-8');
      const parsed = JSON.parse(raw);
      const content: CanonicalHook = {
        name: artifact.name,
        event: parsed.event ?? 'PreToolUse',
        command: parsed.command ?? '',
        timeout: parsed.timeout,
        extraFields: { ...parsed },
      };
      return { artifact, content };
    }

    if (artifact.kind === 'rule') {
      const candidate1 = path.join(targetDir, pathId);
      const candidate2 = path.join(targetDir, 'rules', `${artifact.name}.md`);
      const candidate3 = path.join(targetDir, `${artifact.name}.md`);

      let ruleFile = '';
      for (const cand of [candidate1, candidate2, candidate3]) {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
          ruleFile = cand;
          break;
        }
      }
      if (!ruleFile) {
        throw new Error(`Cannot locate rule file for "${artifact.name}" in "${targetDir}"`);
      }

      const raw = await fs.promises.readFile(ruleFile, 'utf-8');
      const content: CanonicalRule = {
        name: artifact.name,
        content: raw,
      };
      return { artifact, content };
    }

    throw new Error(`Unsupported artifact kind: "${artifact.kind}"`);
  });
}

export const gitCustomResolver: SourceResolver = {
  type: 'git-custom',
  displayName: 'Git (custom)',
  iconThemeId: 'repo',
  resolve: resolveGitCustom,
  resolveArtifactContent,
};

