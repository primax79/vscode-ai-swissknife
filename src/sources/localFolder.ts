import * as fs from 'fs';
import * as path from 'path';
import type { Source, Package, Artifact, ResolvedArtifact } from '../domain/types';
import type { CanonicalSkill, CanonicalAgent, CanonicalCommand } from '../adapters/types';
import type { SourceResolution } from './types';
import { readSkill } from '../adapters/codec';
import { parseClaudeAgentMarkdown, parseClaudeCommandMarkdown } from '../adapters/claude';
import { findSkillDirs, findAgentFiles, findCommandFiles } from './detect';

/**
 * Resolves a `Source` of type `local-folder` detecting skills, agents, and commands.
 */
export async function resolveLocalFolder(source: Source): Promise<SourceResolution> {
  if (!source.localPath) {
    return { packages: [], diagnostics: [] };
  }

  let skillDetection;
  let agentDetection;
  let commandDetection;

  try {
    skillDetection = await findSkillDirs(source.localPath);
    agentDetection = await findAgentFiles(source.localPath);
    commandDetection = await findCommandFiles(source.localPath);
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
    };

    const pkg: Package = {
      id: packageId,
      sourceId: source.id,
      nativeFormat: 'claude-command',
      artifacts: [artifact],
    };

    return pkg;
  });

  return {
    packages: [...skillPackages, ...agentPackages, ...commandPackages],
    diagnostics: [
      ...skillDetection.diagnostics,
      ...agentDetection.diagnostics,
      ...commandDetection.diagnostics,
    ],
  };
}

/**
 * Resolves content for a skill, agent, or command artifact from a local-folder source.
 */
export async function resolveArtifactContent(
  source: Source,
  pkg: Package,
  artifact: Artifact
): Promise<ResolvedArtifact<CanonicalSkill | CanonicalAgent | CanonicalCommand>> {
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

  throw new Error(`Unsupported artifact kind: "${artifact.kind}"`);
}
