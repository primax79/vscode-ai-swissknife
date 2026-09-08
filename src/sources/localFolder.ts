import * as fs from 'fs';
import * as path from 'path';
import type { Source, Package, Artifact, ResolvedArtifact } from '../domain/types';
import type {
  CanonicalSkill,
  CanonicalAgent,
  CanonicalCommand,
  CanonicalMcpServer,
  CanonicalHook,
  CanonicalRule,
} from '../adapters/types';
import type { SourceResolution } from './types';
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

  if (artifact.kind === 'skill') {
    const candidate1 = path.join(source.localPath, pathId);
    let skillDir: string;

    if (fs.existsSync(path.join(candidate1, 'SKILL.md'))) {
      skillDir = candidate1;
    } else if (fs.existsSync(path.join(source.localPath, 'SKILL.md'))) {
      skillDir = source.localPath;
    } else {
      throw new Error(`Cannot locate skill directory for artifact "${artifact.name}" in "${source.localPath}"`);
    }

    const content = await readSkill(skillDir);
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

    const raw = await fs.promises.readFile(agentFile, 'utf-8');
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

    const raw = await fs.promises.readFile(cmdFile, 'utf-8');
    const content = parseClaudeCommandMarkdown(raw, artifact.name);
    return { artifact, content };
  }

  if (artifact.kind === 'mcp-server') {
    const candidate1 = path.join(source.localPath, 'mcp.json');
    const candidate2 = path.join(source.localPath, '.mcp.json');
    const candidate3 = path.join(source.localPath, 'mcps', `${artifact.name}.json`);
    const candidate4 = path.join(source.localPath, pathId.split(':')[0]);

    let raw = '';
    for (const cand of [candidate1, candidate2, candidate3, candidate4]) {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
        raw = await fs.promises.readFile(cand, 'utf-8');
        break;
      }
    }
    if (!raw) {
      throw new Error(`Cannot locate MCP server definition for "${artifact.name}" in "${source.localPath}"`);
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

    const raw = await fs.promises.readFile(ruleFile, 'utf-8');
    const content: CanonicalRule = {
      name: artifact.name,
      content: raw,
    };
    return { artifact, content };
  }

  throw new Error(`Unsupported artifact kind: "${artifact.kind}"`);
}
