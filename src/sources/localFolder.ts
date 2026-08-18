import * as path from 'path';
import type { Source, Package, Artifact } from '../domain/types';
import { findSkillDirs } from './detect';

/**
 * Resolves a `Source` of type `local-folder` by detecting all skill directories within `source.localPath`.
 *
 * Each detected skill directory is mapped to a degenerate `Package` containing exactly one `Artifact` of kind `skill`.
 * Package and Artifact IDs are deterministically derived from `source.id` and the relative path / skill name.
 */
export async function resolveLocalFolder(source: Source): Promise<Package[]> {
  if (!source.localPath) {
    return [];
  }

  const skillDirs = await findSkillDirs(source.localPath);

  return skillDirs.map((skillDir) => {
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
}
