import * as fs from 'fs';
import * as path from 'path';
import type { Source, Package, Artifact, ResolvedArtifact } from '../domain/types';
import type { CanonicalSkill } from '../adapters/types';
import type { SourceResolution, SkillDetectionResult } from './types';
import { readSkill } from '../adapters/codec';
import { findSkillDirs } from './detect';

/**
 * Resolves a `Source` of type `local-folder` by detecting all skill directories within `source.localPath`.
 *
 * Returns a `SourceResolution` containing detected `Package` items and structured `DetectionDiagnostic`s.
 * Each detected skill directory is mapped to a degenerate `Package` containing exactly one `Artifact` of kind `skill`.
 * Package and Artifact IDs are deterministically derived from `source.id` and the relative path / skill name.
 */
export async function resolveLocalFolder(source: Source): Promise<SourceResolution> {
  if (!source.localPath) {
    return { packages: [], diagnostics: [] };
  }

  let detectionResult: SkillDetectionResult;
  try {
    detectionResult = await findSkillDirs(source.localPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { packages: [], diagnostics: [] };
    }
    throw err;
  }

  const packages: Package[] = detectionResult.skills.map((skillDir) => {
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

  return {
    packages,
    diagnostics: detectionResult.diagnostics,
  };
}

/**
 * Resolves content for a skill artifact from a local-folder source.
 */
export async function resolveArtifactContent(
  source: Source,
  pkg: Package,
  artifact: Artifact
): Promise<ResolvedArtifact<CanonicalSkill>> {
  if (source.type !== 'local-folder') {
    throw new Error(`Expected source.type === "local-folder", got "${source.type}"`);
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
  if (!source.localPath) {
    throw new Error('Source localPath is required for local-folder content resolution');
  }

  const prefix = `${source.id}:`;
  const pathId = pkg.id.startsWith(prefix) ? pkg.id.slice(prefix.length) : '';
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
