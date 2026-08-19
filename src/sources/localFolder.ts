import * as fs from 'fs';
import * as path from 'path';
import type { Source, Package, Artifact, ResolvedArtifact } from '../domain/types';
import type { CanonicalSkill, CanonicalAgent } from '../adapters/types';
import type { SourceResolution, SkillDetectionResult } from './types';
import { readSkill } from '../adapters/codec';
import { parseClaudeAgentMarkdown } from '../adapters/claude';
import { findSkillDirs, findAgentFiles } from './detect';

/**
 * Resolves a `Source` of type `local-folder` detecting both skills and agents.
 */
export async function resolveLocalFolder(source: Source): Promise<SourceResolution> {
  if (!source.localPath) {
    return { packages: [], diagnostics: [] };
  }

  let skillDetection: SkillDetectionResult;
  let agentDetection: { agents: Array<{ path: string; name: string; description?: string }>; diagnostics: Array<{ severity: 'error' | 'warning'; path: string; message: string; code: 'invalid-frontmatter' | 'unsafe-path' | 'unreadable-skill' }> };

  try {
    skillDetection = await findSkillDirs(source.localPath);
    agentDetection = await findAgentFiles(source.localPath);
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

  return {
    packages: [...skillPackages, ...agentPackages],
    diagnostics: [...skillDetection.diagnostics, ...agentDetection.diagnostics],
  };
}

/**
 * Resolves content for a skill or agent artifact from a local-folder source.
 */
export async function resolveArtifactContent(
  source: Source,
  pkg: Package,
  artifact: Artifact
): Promise<ResolvedArtifact<CanonicalSkill | CanonicalAgent>> {
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
    if (fs.existsSync(candidate1) && fs.statSync(candidate1).isFile()) {
      agentFile = candidate1;
    } else if (fs.existsSync(candidate2)) {
      agentFile = candidate2;
    } else if (fs.existsSync(candidate3)) {
      agentFile = candidate3;
    } else {
      throw new Error(`Cannot locate agent file for "${artifact.name}" in "${source.localPath}"`);
    }

    const raw = await fs.promises.readFile(agentFile, 'utf-8');
    const content = parseClaudeAgentMarkdown(raw);
    return { artifact, content };
  }

  throw new Error(`Unsupported artifact kind: "${artifact.kind}"`);
}
