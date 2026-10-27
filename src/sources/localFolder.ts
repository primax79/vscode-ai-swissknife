import * as fs from 'fs';
import * as path from 'path';
import type { Source, Package, Artifact, ResolvedArtifact } from '../domain/types';
import type {
  CanonicalSkill,
  CanonicalSkillFile,
  CanonicalAgent,
  CanonicalCommand,
  CanonicalMcpServer,
  CanonicalHook,
  CanonicalRule,
} from '../adapters/types';
import type { SourceResolution, SourceResolver } from './types';
import { readSkill } from '../adapters/codec';
import {
  parseSkillMarkdown,
  parseClaudeAgentMarkdown,
  parseClaudeCommandMarkdown,
} from '../adapters/claude';
import {
  extractSkillFrontmatter,
  findSkillDirs,
  findAgentFiles,
  findCommandFiles,
  findMcpDefinitions,
  findHookFiles,
  findRuleFiles,
} from './detect';
import { runGit } from './gitProcess';

export class UntrackedArtifactError extends Error {
  readonly code = 'UNTRACKED_ARTIFACT';
  readonly hint: string;
  readonly folder: string;

  constructor(artifactName: string, folder: string) {
    const hint = `not committed in ${folder}; commit it or set readWorkingTree`;
    super(`Artifact "${artifactName}" is ${hint}`);
    this.name = 'UntrackedArtifactError';
    this.folder = folder;
    this.hint = hint;
  }
}

export function isUntrackedArtifactError(err: unknown): err is UntrackedArtifactError {
  return (
    err instanceof UntrackedArtifactError ||
    (typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === 'UNTRACKED_ARTIFACT' &&
      typeof (err as { hint?: string }).hint === 'string')
  );
}

interface LocalGitContext {
  headCommit: string;
  repoPrefix: string;
}

async function detectGitContext(localPath: string): Promise<LocalGitContext | null> {
  try {
    const { stdout: headOut } = await runGit(['rev-parse', 'HEAD'], localPath);
    const headCommit = headOut.trim();
    if (!/^[0-9a-f]{40}$/i.test(headCommit)) {
      return null;
    }
    const { stdout: prefixOut } = await runGit(['rev-parse', '--show-prefix'], localPath);
    const repoPrefix = prefixOut.replace(/\r?\n$/, '');
    return { headCommit, repoPrefix };
  } catch {
    return null;
  }
}

function toRelativeFromSourcePosix(localPath: string, targetPath: string): string {
  return path.relative(path.resolve(localPath), path.resolve(targetPath)).split(path.sep).join('/');
}

function toRepoRelativePath(gitCtx: LocalGitContext, localPath: string, targetPath: string): string {
  const relFromLocal = toRelativeFromSourcePosix(localPath, targetPath);
  if (relFromLocal === '') {
    return gitCtx.repoPrefix.replace(/\/$/, '');
  }
  return `${gitCtx.repoPrefix}${relFromLocal}`;
}

async function isArtifactDirty(localPath: string, artifactPath: string): Promise<boolean> {
  const relFromLocal = toRelativeFromSourcePosix(localPath, artifactPath);
  const pathSpec = relFromLocal === '' ? '.' : relFromLocal;
  const { stdout } = await runGit(['status', '--porcelain', '--', pathSpec], localPath);
  return stdout.trim().length > 0;
}

function isIgnoredSkillSegment(name: string): boolean {
  return (
    name === '.git' ||
    name === 'node_modules' ||
    name === 'index.json' ||
    name === 'local.patch' ||
    name.endsWith('.patch') ||
    name === '.DS_Store' ||
    name === 'Thumbs.db'
  );
}

function isValidSkillRelativePath(p: string): boolean {
  if (!p || p === '.' || p === 'SKILL.md') return false;
  if (path.isAbsolute(p)) return false;
  if (p.includes('\0')) return false;

  const segments = p.split('/');
  for (const seg of segments) {
    if (seg === '..') return false;
  }

  const resolved = path.posix.resolve('/root', p);
  if (!resolved.startsWith('/root/') || resolved === '/root/SKILL.md' || resolved === '/root') {
    return false;
  }

  return true;
}

async function readSkillFromGitHead(
  localPath: string,
  repoRelDir: string,
  artifactName: string,
  existsInWorkingTree: boolean
): Promise<CanonicalSkill> {
  const treeSpec = repoRelDir ? `HEAD:${repoRelDir}` : 'HEAD';
  let lsOut: string;
  try {
    const res = await runGit(['ls-tree', '--full-tree', '-r', '-z', treeSpec], localPath);
    lsOut = res.stdout;
  } catch {
    if (existsInWorkingTree) {
      throw new UntrackedArtifactError(artifactName, localPath);
    }
    throw new Error(`Cannot locate skill directory for artifact "${artifactName}" in "${localPath}"`);
  }

  const entries = lsOut.split('\0').filter((e) => e.length > 0);
  let skillMdBlobSha: string | undefined;
  const fileEntries: Array<{ relPath: string; blobSha: string; mode: number }> = [];

  for (const entry of entries) {
    const match = entry.match(/^([0-7]+) (\w+) ([0-9a-f]{40})\t([\s\S]+)$/);
    if (!match) continue;
    const [, modeStr, objType, blobSha, relPath] = match;

    const segments = relPath.split('/');
    if (segments.some(isIgnoredSkillSegment)) {
      continue;
    }

    if (modeStr === '120000' || objType !== 'blob') {
      throw new Error(`Unsupported file type at ${relPath}`);
    }

    if (relPath === 'SKILL.md') {
      skillMdBlobSha = blobSha;
      continue;
    }

    if (!isValidSkillRelativePath(relPath)) {
      throw new Error(`Invalid path: ${relPath}`);
    }

    fileEntries.push({
      relPath,
      blobSha,
      mode: parseInt(modeStr, 8),
    });
  }

  if (!skillMdBlobSha) {
    if (existsInWorkingTree) {
      throw new UntrackedArtifactError(artifactName, localPath);
    }
    throw new Error(`Cannot locate skill directory for artifact "${artifactName}" in "${localPath}"`);
  }

  const { stdout: skillMdContent } = await runGit(['cat-file', 'blob', skillMdBlobSha], localPath);
  const doc = parseSkillMarkdown(skillMdContent);

  const files: CanonicalSkillFile[] = [];
  const seenPaths = new Set<string>();

  for (const f of fileEntries) {
    const norm = path.posix.normalize(f.relPath);
    if (seenPaths.has(norm)) {
      throw new Error(`Duplicate normalized path: ${norm}`);
    }
    seenPaths.add(norm);

    const { stdout: blobContent } = await runGit(['cat-file', 'blob', f.blobSha], localPath);
    files.push({
      path: f.relPath,
      content: Buffer.from(blobContent, 'utf-8'),
      mode: f.mode,
    });
  }

  return {
    ...doc,
    files,
  };
}

async function readSingleFileForArtifact(
  source: Source,
  pkg: Package,
  artifact: Artifact,
  targetFile: string,
  gitCtx: LocalGitContext | null
): Promise<string> {
  const localPath = source.localPath!;
  if (!gitCtx) {
    return await fs.promises.readFile(targetFile, 'utf-8');
  }

  const dirty = await isArtifactDirty(localPath, targetFile);
  pkg.version = {
    commit: gitCtx.headCommit,
    requestedRef: 'HEAD',
    dirty,
  };

  if (source.readWorkingTree) {
    return await fs.promises.readFile(targetFile, 'utf-8');
  }

  const repoRelFile = toRepoRelativePath(gitCtx, localPath, targetFile);
  try {
    const { stdout } = await runGit(['show', `HEAD:${repoRelFile}`], localPath);
    return stdout;
  } catch {
    throw new UntrackedArtifactError(artifact.name, localPath);
  }
}

/**
 * Resolves a `Source` of type `local-folder` detecting skills, agents, commands, mcp servers, hooks, and rules.
 */
export async function resolveLocalFolder(source: Source): Promise<SourceResolution> {
  if (!source.localPath) {
    return { packages: [], diagnostics: [] };
  }

  let skillDetection;
  let agentDetection;
  let commandDetection;
  let mcpDetection;
  let hookDetection;
  let ruleDetection;

  try {
    skillDetection = await findSkillDirs(source.localPath);
    agentDetection = await findAgentFiles(source.localPath);
    commandDetection = await findCommandFiles(source.localPath);
    mcpDetection = await findMcpDefinitions(source.localPath);
    hookDetection = await findHookFiles(source.localPath);
    ruleDetection = await findRuleFiles(source.localPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { packages: [], diagnostics: [] };
    }
    throw err;
  }

  const skillPackages: Package[] = skillDetection.skills.map((skillDir) => {
    const relPath = path.relative(source.localPath!, skillDir.path);
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
      nativeFormat: 'claude-skill',
      artifacts: [artifact],
    };

    return pkg;
  });

  const agentPackages: Package[] = agentDetection.agents.map((agentFile) => {
    const relPath = path.relative(source.localPath!, agentFile.path);
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
      nativeFormat: 'claude-agent',
      artifacts: [artifact],
    };

    return pkg;
  });

  const commandPackages: Package[] = commandDetection.commands.map((cmdFile) => {
    const relPath = path.relative(source.localPath!, cmdFile.path);
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
      nativeFormat: 'claude-command',
      artifacts: [artifact],
    };

    return pkg;
  });

  const mcpPackages: Package[] = mcpDetection.mcpServers.map((mcpServer) => {
    const relPath = path.relative(source.localPath!, mcpServer.path);
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
      nativeFormat: 'mcp-config',
      artifacts: [artifact],
    };

    return pkg;
  });

  const hookPackages: Package[] = hookDetection.hooks.map((h) => {
    const relPath = path.relative(source.localPath!, h.path);
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
      nativeFormat: 'claude-hook',
      artifacts: [artifact],
    };

    return pkg;
  });

  const rulePackages: Package[] = ruleDetection.rules.map((r) => {
    const relPath = path.relative(source.localPath!, r.path);
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
      nativeFormat: 'plain-rule',
      artifacts: [artifact],
    };

    return pkg;
  });

  const allPackages = [
    ...skillPackages,
    ...agentPackages,
    ...commandPackages,
    ...mcpPackages,
    ...hookPackages,
    ...rulePackages,
  ];

  const gitCtx = await detectGitContext(source.localPath);
  if (gitCtx) {
    for (const pkg of allPackages) {
      const art = pkg.artifacts[0];
      if (!art?.path) continue;
      const dirty = await isArtifactDirty(source.localPath, art.path);
      pkg.version = {
        commit: gitCtx.headCommit,
        requestedRef: 'HEAD',
        dirty,
      };
      if (dirty && !source.readWorkingTree && (art.kind === 'skill' || art.kind === 'agent' || art.kind === 'command')) {
        const mdFile = art.kind === 'skill' ? path.join(art.path, 'SKILL.md') : art.path;
        const repoRelMd = toRepoRelativePath(gitCtx, source.localPath, mdFile);
        try {
          const { stdout } = await runGit(['show', `HEAD:${repoRelMd}`], source.localPath);
          const fm = extractSkillFrontmatter(stdout);
          if (fm.description !== undefined) {
            art.description = fm.description;
          }
        } catch {
          // Untracked in HEAD: keep working-tree metadata so item remains discoverable and surfaces UntrackedArtifactError on content resolution
        }
      }
    }
  }

  return {
    packages: allPackages,
    diagnostics: [
      ...skillDetection.diagnostics,
      ...agentDetection.diagnostics,
      ...commandDetection.diagnostics,
      ...mcpDetection.diagnostics,
      ...hookDetection.diagnostics,
      ...ruleDetection.diagnostics,
    ],
  };
}

/**
 * Resolves content for any artifact kind from a local-folder source.
 */
export async function resolveArtifactContent(
  source: Source,
  pkg: Package,
  artifact: Artifact
): Promise<ResolvedArtifact<CanonicalSkill | CanonicalAgent | CanonicalCommand | CanonicalMcpServer | CanonicalHook | CanonicalRule>> {
  if (source.type !== 'local-folder') {
    throw new Error(`Expected source.type === "local-folder", got "${source.type}"`);
  }
  if (pkg.sourceId !== source.id) {
    throw new Error(`Package sourceId mismatch: expected "${source.id}", got "${pkg.sourceId}"`);
  }
  if (artifact.packageId !== pkg.id) {
    throw new Error(`Artifact packageId mismatch: expected "${pkg.id}", got "${artifact.packageId}"`);
  }
  if (!source.localPath) {
    throw new Error('Source localPath is required for local-folder content resolution');
  }

  const prefix = `${source.id}:`;
  const pathId = pkg.id.startsWith(prefix) ? pkg.id.slice(prefix.length) : '';
  const gitCtx = await detectGitContext(source.localPath);

  if (artifact.kind === 'skill') {
    const candidate1 = path.join(source.localPath, pathId);
    let skillDir: string;
    let existsInWorkingTree = false;

    if (fs.existsSync(path.join(candidate1, 'SKILL.md'))) {
      skillDir = candidate1;
      existsInWorkingTree = true;
    } else if (fs.existsSync(path.join(source.localPath, 'SKILL.md'))) {
      skillDir = source.localPath;
      existsInWorkingTree = true;
    } else if (gitCtx && !source.readWorkingTree && pathId) {
      skillDir = candidate1;
      existsInWorkingTree = false;
    } else {
      throw new Error(`Cannot locate skill directory for artifact "${artifact.name}" in "${source.localPath}"`);
    }

    if (gitCtx) {
      const dirty = await isArtifactDirty(source.localPath, skillDir);
      pkg.version = {
        commit: gitCtx.headCommit,
        requestedRef: 'HEAD',
        dirty,
      };
    }

    if (!gitCtx || source.readWorkingTree) {
      const content = await readSkill(skillDir);
      return { artifact, content };
    }

    const repoRelDir = toRepoRelativePath(gitCtx, source.localPath, skillDir);
    const content = await readSkillFromGitHead(
      source.localPath,
      repoRelDir,
      artifact.name,
      existsInWorkingTree
    );
    return { artifact, content };
  }

  if (artifact.kind === 'agent') {
    const candidate1 = path.join(source.localPath, pathId);
    const candidate2 = path.join(source.localPath, `${artifact.name}.md`);
    const candidate3 = path.join(source.localPath, 'agents', `${artifact.name}.md`);

    let agentFile = '';
    for (const cand of [candidate1, candidate2, candidate3]) {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
        agentFile = cand;
        break;
      }
    }
    if (!agentFile) {
      throw new Error(`Cannot locate agent file for "${artifact.name}" in "${source.localPath}"`);
    }

    const raw = await readSingleFileForArtifact(source, pkg, artifact, agentFile, gitCtx);
    const content = parseClaudeAgentMarkdown(raw);
    return { artifact, content };
  }

  if (artifact.kind === 'command') {
    const candidate1 = path.join(source.localPath, pathId);
    const candidate2 = path.join(source.localPath, `${artifact.name}.md`);
    const candidate3 = path.join(source.localPath, 'commands', `${artifact.name}.md`);
    const candidate4 = path.join(source.localPath, 'command', `${artifact.name}.md`);

    let cmdFile = '';
    for (const cand of [candidate1, candidate2, candidate3, candidate4]) {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
        cmdFile = cand;
        break;
      }
    }
    if (!cmdFile) {
      throw new Error(`Cannot locate command file for "${artifact.name}" in "${source.localPath}"`);
    }

    const raw = await readSingleFileForArtifact(source, pkg, artifact, cmdFile, gitCtx);
    const content = parseClaudeCommandMarkdown(raw, artifact.name);
    return { artifact, content };
  }

  if (artifact.kind === 'mcp-server') {
    const candidate1 = path.join(source.localPath, 'mcp.json');
    const candidate2 = path.join(source.localPath, '.mcp.json');
    const candidate3 = path.join(source.localPath, 'mcps', `${artifact.name}.json`);
    const candidate4 = path.join(source.localPath, pathId.split(':')[0]);

    let mcpFile = '';
    for (const cand of [candidate1, candidate2, candidate3, candidate4]) {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
        mcpFile = cand;
        break;
      }
    }
    if (!mcpFile) {
      throw new Error(`Cannot locate MCP server definition for "${artifact.name}" in "${source.localPath}"`);
    }

    const raw = await readSingleFileForArtifact(source, pkg, artifact, mcpFile, gitCtx);
    const parsed = JSON.parse(raw);
    const hasNamedServer =
      parsed.mcpServers?.[artifact.name] !== undefined || parsed.mcp?.[artifact.name] !== undefined;
    const isDirectServer = Boolean(parsed.command || parsed.url);
    if (gitCtx && !source.readWorkingTree && !hasNamedServer && !isDirectServer) {
      throw new UntrackedArtifactError(artifact.name, source.localPath);
    }

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
    const candidate1 = path.join(source.localPath, pathId);
    const candidate2 = path.join(source.localPath, 'hooks', `${artifact.name}.json`);
    const candidate3 = path.join(source.localPath, `${artifact.name}.json`);

    let hookFile = '';
    for (const cand of [candidate1, candidate2, candidate3]) {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
        hookFile = cand;
        break;
      }
    }
    if (!hookFile) {
      throw new Error(`Cannot locate hook file for "${artifact.name}" in "${source.localPath}"`);
    }

    const raw = await readSingleFileForArtifact(source, pkg, artifact, hookFile, gitCtx);
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
    const candidate1 = path.join(source.localPath, pathId);
    const candidate2 = path.join(source.localPath, 'rules', `${artifact.name}.md`);
    const candidate3 = path.join(source.localPath, `${artifact.name}.md`);

    let ruleFile = '';
    for (const cand of [candidate1, candidate2, candidate3]) {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
        ruleFile = cand;
        break;
      }
    }
    if (!ruleFile) {
      throw new Error(`Cannot locate rule file for "${artifact.name}" in "${source.localPath}"`);
    }

    const raw = await readSingleFileForArtifact(source, pkg, artifact, ruleFile, gitCtx);
    const content: CanonicalRule = {
      name: artifact.name,
      content: raw,
    };
    return { artifact, content };
  }

  throw new Error(`Unsupported artifact kind: "${artifact.kind}"`);
}

export const localFolderResolver: SourceResolver = {
  type: 'local-folder',
  displayName: 'Local folder',
  iconThemeId: 'folder',
  resolve: resolveLocalFolder,
  resolveArtifactContent,
};

