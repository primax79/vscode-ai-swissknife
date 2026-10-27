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
import type { SourceResolution, SourceResolver, DetectionDiagnostic } from './types';
import { readSkill } from '../adapters/codec';
import { parseClaudeAgentMarkdown, parseClaudeCommandMarkdown } from '../adapters/claude';
import {
  findSkillDirs,
  findAgentFiles,
  findCommandFiles,
  findMcpDefinitions,
} from './detect';
import { KeyedMutex } from './gitCustom';
import {
  runGit,
  validateGitUrl,
  validateGitRef,
  resolveAndValidateCacheDir,
} from './gitProcess';

export interface GitMarketplaceResolveOptions {
  cacheDir?: string;
  /** Home root for the default cache dir (tests); ignored when cacheDir is set. */
  homeRoot?: string;
  offline?: boolean;
}

export const gitMarketplaceMutex = new KeyedMutex();

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

export interface ClaudePluginManifestItem {
  name: string;
  description?: string;
  source?: string | { type?: string; url?: string; path?: string };
  version?: string;
}

export interface ClaudeMarketplaceManifest {
  plugins?: ClaudePluginManifestItem[];
}

/**
 * Resolves a `Source` of type `git-marketplace` by cloning/fetching the repository,
 * reading `.claude-plugin/marketplace.json` or `marketplace-skills.json`, and discovering all plugin packages.
 */
export async function resolveGitMarketplace(
  source: Source,
  opts?: GitMarketplaceResolveOptions
): Promise<SourceResolution> {
  validateGitUrl(source.type, source.url, source.id);
  if (source.commit) validateGitRef('commit', source.commit);
  if (source.tag) validateGitRef('tag', source.tag);
  if (source.branch) validateGitRef('branch', source.branch);

  const baseCacheDir = opts?.cacheDir ?? path.join(opts?.homeRoot ?? os.homedir(), '.ai-swissknife', 'cache', 'sources');
  const { targetDir } = resolveAndValidateCacheDir(baseCacheDir, source.id, source.url);

  return gitMarketplaceMutex.runExclusive(targetDir, async () => {
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

    const packages: Package[] = [];
    const diagnostics: DetectionDiagnostic[] = [];

    // Check for Claude plugin marketplace manifest
    const claudeManifestPaths = [
      path.join(targetDir, '.claude-plugin', 'marketplace.json'),
      path.join(targetDir, 'marketplace.json'),
    ];

    let claudeManifest: ClaudeMarketplaceManifest | null = null;
    for (const mPath of claudeManifestPaths) {
      if (fs.existsSync(mPath) && fs.statSync(mPath).isFile()) {
        try {
          const raw = await fs.promises.readFile(mPath, 'utf-8');
          claudeManifest = JSON.parse(raw);
          break;
        } catch {
          // ignore
        }
      }
    }

    if (claudeManifest && Array.isArray(claudeManifest.plugins)) {
      for (const plugin of claudeManifest.plugins) {
        const pluginRelPath =
          typeof plugin.source === 'string'
            ? plugin.source
            : typeof plugin.source === 'object' && plugin.source?.path
            ? plugin.source.path
            : plugin.name;

        const pluginDir = path.join(targetDir, pluginRelPath);
        if (!fs.existsSync(pluginDir) || !fs.statSync(pluginDir).isDirectory()) {
          diagnostics.push({
            severity: 'warning',
            path: pluginDir,
            message: `Plugin directory not found for "${plugin.name}" in marketplace`,
            code: 'invalid-frontmatter',
          });
          continue;
        }

        const skillRes = await findSkillDirs(pluginDir);
        const agentRes = await findAgentFiles(pluginDir);
        const cmdRes = await findCommandFiles(pluginDir);
        const mcpRes = await findMcpDefinitions(pluginDir);

        diagnostics.push(...skillRes.diagnostics, ...agentRes.diagnostics, ...cmdRes.diagnostics, ...mcpRes.diagnostics);

        const artifacts: Artifact[] = [];
        const packageId = `${source.id}:${plugin.name}`;

        for (const s of skillRes.skills) {
          artifacts.push({
            id: `${packageId}:skill:${s.name}`,
            packageId,
            kind: 'skill',
            name: s.name,
            description: s.description,
            nativeFormat: 'claude-skill',
            path: s.path,
          });
        }

        for (const a of agentRes.agents) {
          artifacts.push({
            id: `${packageId}:agent:${a.name}`,
            packageId,
            kind: 'agent',
            name: a.name,
            description: a.description,
            nativeFormat: 'claude-agent',
            path: a.path,
          });
        }

        for (const c of cmdRes.commands) {
          artifacts.push({
            id: `${packageId}:command:${c.name}`,
            packageId,
            kind: 'command',
            name: c.name,
            description: c.description,
            nativeFormat: 'claude-command',
            path: c.path,
          });
        }

        for (const m of mcpRes.mcpServers) {
          artifacts.push({
            id: `${packageId}:mcp:${m.id}`,
            packageId,
            kind: 'mcp-server',
            name: m.id,
            description: m.description,
            nativeFormat: 'mcp-config',
            path: m.path,
          });
        }

        packages.push({
          id: packageId,
          sourceId: source.id,
          version,
          nativeFormat: 'claude-plugin',
          artifacts,
        });
      }

      return { packages, diagnostics };
    }

    // Fallback: scan whole directory if no formal marketplace manifest
    const skillRes = await findSkillDirs(targetDir);
    const agentRes = await findAgentFiles(targetDir);
    const cmdRes = await findCommandFiles(targetDir);
    const mcpRes = await findMcpDefinitions(targetDir);

    for (const s of skillRes.skills) {
      const relPath = path.relative(targetDir, s.path);
      const pathId = relPath === '' ? s.name : relPath;
      const packageId = `${source.id}:${pathId}`;
      packages.push({
        id: packageId,
        sourceId: source.id,
        version,
        nativeFormat: 'claude-skill',
        artifacts: [
          {
            id: `${packageId}:${s.name}`,
            packageId,
            kind: 'skill',
            name: s.name,
            description: s.description,
            nativeFormat: 'claude-skill',
            path: s.path,
          },
        ],
      });
    }

    for (const a of agentRes.agents) {
      const relPath = path.relative(targetDir, a.path);
      const packageId = `${source.id}:${relPath}`;
      packages.push({
        id: packageId,
        sourceId: source.id,
        version,
        nativeFormat: 'claude-agent',
        artifacts: [
          {
            id: `${packageId}:${a.name}`,
            packageId,
            kind: 'agent',
            name: a.name,
            description: a.description,
            nativeFormat: 'claude-agent',
            path: a.path,
          },
        ],
      });
    }

    for (const c of cmdRes.commands) {
      const relPath = path.relative(targetDir, c.path);
      const packageId = `${source.id}:${relPath}`;
      packages.push({
        id: packageId,
        sourceId: source.id,
        version,
        nativeFormat: 'claude-command',
        artifacts: [
          {
            id: `${packageId}:${c.name}`,
            packageId,
            kind: 'command',
            name: c.name,
            description: c.description,
            nativeFormat: 'claude-command',
            path: c.path,
          },
        ],
      });
    }

    for (const m of mcpRes.mcpServers) {
      const relPath = path.relative(targetDir, m.path);
      const packageId = `${source.id}:${relPath}:${m.id}`;
      packages.push({
        id: packageId,
        sourceId: source.id,
        version,
        nativeFormat: 'mcp-config',
        artifacts: [
          {
            id: `${packageId}:${m.id}`,
            packageId,
            kind: 'mcp-server',
            name: m.id,
            description: m.description,
            nativeFormat: 'mcp-config',
            path: m.path,
          },
        ],
      });
    }

    return {
      packages,
      diagnostics: [
        ...skillRes.diagnostics,
        ...agentRes.diagnostics,
        ...cmdRes.diagnostics,
        ...mcpRes.diagnostics,
      ],
    };
  });
}

/**
 * Resolves content for any artifact kind from a git-marketplace source.
 */
export async function resolveArtifactContent(
  source: Source,
  pkg: Package,
  artifact: Artifact,
  opts?: GitMarketplaceResolveOptions
): Promise<ResolvedArtifact<CanonicalSkill | CanonicalAgent | CanonicalCommand | CanonicalMcpServer | CanonicalHook | CanonicalRule>> {
  if (source.type !== 'git-marketplace') {
    throw new Error(`Expected source.type === "git-marketplace", got "${source.type}"`);
  }
  if (pkg.sourceId !== source.id) {
    throw new Error(`Package sourceId mismatch: expected "${source.id}", got "${pkg.sourceId}"`);
  }
  if (artifact.packageId !== pkg.id) {
    throw new Error(`Artifact packageId mismatch: expected "${pkg.id}", got "${artifact.packageId}"`);
  }
  if (!pkg.version?.commit) {
    throw new Error('Package version commit is required for git-marketplace content resolution');
  }
  validateGitRef('commit', pkg.version.commit);

  const baseCacheDir = opts?.cacheDir ?? path.join(opts?.homeRoot ?? os.homedir(), '.ai-swissknife', 'cache', 'sources');
  const { targetDir } = resolveAndValidateCacheDir(baseCacheDir, source.id, source.url);

  return gitMarketplaceMutex.runExclusive(targetDir, async () => {
    if (!fs.existsSync(path.join(targetDir, '.git'))) {
      throw new Error(`Git cache directory not found or invalid: "${targetDir}"`);
    }

    const { stdout: currentHead } = await runGit(['rev-parse', 'HEAD'], targetDir);
    if (currentHead.trim() !== pkg.version!.commit) {
      await runGit(['checkout', pkg.version!.commit, '--'], targetDir);
    }

    const prefix = `${source.id}:`;
    const pathId = pkg.id.startsWith(prefix) ? pkg.id.slice(prefix.length) : '';

    // Resolve the plugin's own root directory inside `targetDir` when `pathId` identifies a plugin
    // so that fallback walks never cross into a sibling plugin directory.
    let pluginSearchRoot = targetDir;
    if (pathId) {
      let resolvedPluginRel: string | undefined;
      for (const mPath of [
        path.join(targetDir, '.claude-plugin', 'marketplace.json'),
        path.join(targetDir, 'marketplace.json'),
      ]) {
        if (fs.existsSync(mPath) && fs.statSync(mPath).isFile()) {
          try {
            const parsedManifest = JSON.parse(fs.readFileSync(mPath, 'utf-8')) as ClaudeMarketplaceManifest;
            const matchedPlugin = parsedManifest.plugins?.find((p) => p.name === pathId);
            if (matchedPlugin) {
              resolvedPluginRel =
                typeof matchedPlugin.source === 'string'
                  ? matchedPlugin.source
                  : typeof matchedPlugin.source === 'object' && matchedPlugin.source?.path
                  ? matchedPlugin.source.path
                  : matchedPlugin.name;
            }
            break;
          } catch {
            // ignore
          }
        }
      }

      const pluginRootCandidates = [
        ...(resolvedPluginRel ? [path.join(targetDir, resolvedPluginRel)] : []),
        path.join(targetDir, pathId),
        path.join(targetDir, 'plugins', pathId),
      ];
      for (const pCand of pluginRootCandidates) {
        if (fs.existsSync(pCand) && fs.statSync(pCand).isDirectory()) {
          pluginSearchRoot = pCand;
          break;
        }
      }
    }

    const resolveRecordedPath = (recordedPath?: string): string | undefined => {
      if (!recordedPath) return undefined;
      if (path.isAbsolute(recordedPath)) {
        const resolvedRec = path.resolve(recordedPath);
        const resolvedTarget = path.resolve(targetDir);
        if (resolvedRec === resolvedTarget || resolvedRec.startsWith(resolvedTarget + path.sep)) {
          return resolvedRec;
        }
        return undefined;
      }
      return path.join(targetDir, recordedPath);
    };

    const recordedTarget = resolveRecordedPath(artifact.path);

    if (artifact.kind === 'skill') {
      let skillDir = '';
      if (recordedTarget && fs.existsSync(path.join(recordedTarget, 'SKILL.md'))) {
        skillDir = recordedTarget;
      }

      if (!skillDir) {
        const candidates = [
          path.join(pluginSearchRoot, 'skills', artifact.name),
          path.join(pluginSearchRoot, artifact.name),
          path.join(targetDir, pathId, 'skills', artifact.name),
          path.join(targetDir, pathId, artifact.name),
          path.join(targetDir, 'plugins', pathId, 'skills', artifact.name),
          path.join(targetDir, 'plugins', pathId, artifact.name),
          ...(pathId ? [] : [path.join(targetDir, 'skills', artifact.name)]),
          path.join(targetDir, pathId),
        ];

        for (const cand of candidates) {
          if (fs.existsSync(path.join(cand, 'SKILL.md'))) {
            skillDir = cand;
            break;
          }
        }
      }

      if (!skillDir) {
        const walkSkill = (dir: string): string | null => {
          try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            if (entries.some((e) => e.isFile() && e.name === 'SKILL.md') && path.basename(dir) === artifact.name) {
              return dir;
            }
            for (const e of entries) {
              if (e.isDirectory() && e.name !== '.git') {
                const found = walkSkill(path.join(dir, e.name));
                if (found) return found;
              }
            }
          } catch {
            // ignore
          }
          return null;
        };
        skillDir = walkSkill(pluginSearchRoot) ?? '';
      }

      if (!skillDir) {
        throw new Error(`Cannot locate skill directory for "${artifact.name}" in marketplace "${targetDir}"`);
      }

      const content = await readSkill(skillDir);
      return { artifact, content };
    }

    if (artifact.kind === 'agent') {
      let agentFile = '';
      if (recordedTarget && fs.existsSync(recordedTarget) && fs.statSync(recordedTarget).isFile()) {
        agentFile = recordedTarget;
      }

      if (!agentFile) {
        const candidates = [
          path.join(pluginSearchRoot, 'agents', `${artifact.name}.md`),
          path.join(pluginSearchRoot, `${artifact.name}.md`),
          path.join(targetDir, pathId, 'agents', `${artifact.name}.md`),
          path.join(targetDir, pathId, `${artifact.name}.md`),
          path.join(targetDir, 'plugins', pathId, 'agents', `${artifact.name}.md`),
          path.join(targetDir, 'plugins', pathId, `${artifact.name}.md`),
          ...(pathId
            ? []
            : [
                path.join(targetDir, 'agents', `${artifact.name}.md`),
                path.join(targetDir, `${artifact.name}.md`),
              ]),
        ];

        for (const cand of candidates) {
          if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
            agentFile = cand;
            break;
          }
        }
      }

      if (!agentFile) {
        const walkAgent = (dir: string): string | null => {
          try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const e of entries) {
              if (e.isFile() && (e.name === `${artifact.name}.md` || e.name === `${artifact.name}.agent.md`)) {
                return path.join(dir, e.name);
              }
              if (e.isDirectory() && e.name !== '.git') {
                const found = walkAgent(path.join(dir, e.name));
                if (found) return found;
              }
            }
          } catch {
            // ignore
          }
          return null;
        };
        agentFile = walkAgent(pluginSearchRoot) ?? '';
      }

      if (!agentFile) {
        throw new Error(`Cannot locate agent file for "${artifact.name}" in marketplace "${targetDir}"`);
      }

      const raw = await fs.promises.readFile(agentFile, 'utf-8');
      const content = parseClaudeAgentMarkdown(raw);
      return { artifact, content };
    }

    if (artifact.kind === 'command') {
      let cmdFile = '';
      if (recordedTarget && fs.existsSync(recordedTarget) && fs.statSync(recordedTarget).isFile()) {
        cmdFile = recordedTarget;
      }

      if (!cmdFile) {
        const candidates = [
          path.join(pluginSearchRoot, 'commands', `${artifact.name}.md`),
          path.join(pluginSearchRoot, `${artifact.name}.md`),
          path.join(targetDir, pathId, 'commands', `${artifact.name}.md`),
          path.join(targetDir, pathId, `${artifact.name}.md`),
          path.join(targetDir, 'plugins', pathId, 'commands', `${artifact.name}.md`),
          path.join(targetDir, 'plugins', pathId, `${artifact.name}.md`),
          ...(pathId
            ? []
            : [
                path.join(targetDir, 'commands', `${artifact.name}.md`),
                path.join(targetDir, `${artifact.name}.md`),
              ]),
        ];

        for (const cand of candidates) {
          if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
            cmdFile = cand;
            break;
          }
        }
      }

      if (!cmdFile) {
        const walkCmd = (dir: string): string | null => {
          try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const e of entries) {
              if (e.isFile() && (e.name === `${artifact.name}.md` || e.name === `${artifact.name}.command.md`)) {
                return path.join(dir, e.name);
              }
              if (e.isDirectory() && e.name !== '.git') {
                const found = walkCmd(path.join(dir, e.name));
                if (found) return found;
              }
            }
          } catch {
            // ignore
          }
          return null;
        };
        cmdFile = walkCmd(pluginSearchRoot) ?? '';
      }

      if (!cmdFile) {
        throw new Error(`Cannot locate command file for "${artifact.name}" in marketplace "${targetDir}"`);
      }

      const raw = await fs.promises.readFile(cmdFile, 'utf-8');
      const content = parseClaudeCommandMarkdown(raw, artifact.name);
      return { artifact, content };
    }

    if (artifact.kind === 'mcp-server') {
      let raw = '';
      if (recordedTarget && fs.existsSync(recordedTarget) && fs.statSync(recordedTarget).isFile()) {
        raw = await fs.promises.readFile(recordedTarget, 'utf-8');
      }

      if (!raw) {
        const candidates = [
          path.join(pluginSearchRoot, '.mcp.json'),
          path.join(pluginSearchRoot, 'mcp.json'),
          path.join(targetDir, pathId, '.mcp.json'),
          path.join(targetDir, pathId, 'mcp.json'),
          path.join(targetDir, 'plugins', pathId, '.mcp.json'),
          path.join(targetDir, 'plugins', pathId, 'mcp.json'),
          ...(pathId
            ? []
            : [
                path.join(targetDir, '.mcp.json'),
                path.join(targetDir, 'mcp.json'),
              ]),
        ];

        for (const cand of candidates) {
          if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
            raw = await fs.promises.readFile(cand, 'utf-8');
            break;
          }
        }
      }

      if (!raw) {
        const walkMcp = (dir: string): string | null => {
          try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const e of entries) {
              if (e.isFile() && (e.name === 'mcp.json' || e.name === '.mcp.json' || e.name.endsWith('.json'))) {
                try {
                  const content = fs.readFileSync(path.join(dir, e.name), 'utf-8');
                  const p = JSON.parse(content);
                  if (p.mcpServers?.[artifact.name] || p.mcp?.[artifact.name]) {
                    return content;
                  }
                } catch {
                  // ignore
                }
              }
              if (e.isDirectory() && e.name !== '.git') {
                const found = walkMcp(path.join(dir, e.name));
                if (found) return found;
              }
            }
          } catch {
            // ignore
          }
          return null;
        };
        raw = walkMcp(pluginSearchRoot) ?? '';
      }

      if (!raw) {
        throw new Error(`Cannot locate MCP definition for "${artifact.name}" in marketplace "${targetDir}"`);
      }

      const parsed = JSON.parse(raw);
      const serverConfig = (parsed.mcpServers?.[artifact.name] ?? parsed.mcp?.[artifact.name] ?? parsed) as Record<string, unknown>;
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

    throw new Error(`Unsupported artifact kind: "${artifact.kind}"`);
  });
}

export const gitMarketplaceResolver: SourceResolver = {
  type: 'git-marketplace',
  displayName: 'Git marketplace',
  iconThemeId: 'extensions',
  resolve: resolveGitMarketplace,
  resolveArtifactContent,
};

