import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { CanonicalSkill } from '../adapters/types';
import type { ResolvedArtifact } from '../domain/types';
import { serializeSkillMarkdown } from '../adapters/claude';
import { canonicalSkillHash } from '../adapters/codec';
import { resolveArtifactContent as resolveLocalFolderContent } from '../sources/localFolder';
import { resolveArtifactContent as resolveGitCustomContent } from '../sources/gitCustom';
import { translateSkill } from '../translator/skill';
import type {
  PreparedInstall,
  PlanInstallParams,
  ExistingFile,
  ProposedFile,
} from './types';

function sha256(data: Uint8Array | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export async function planInstall(params: PlanInstallParams): Promise<PreparedInstall> {
  const { source, pkg, artifact, targetAdapter, targetScope, projectRoot, resolverOpts } = params;

  // 1. Reject unsupported kinds in Phase 1
  if (artifact.kind !== 'skill') {
    return {
      supported: false,
      plan: {
        supported: false,
        sourceId: source.id,
        packageId: pkg.id,
        artifactId: artifact.id,
        reason: `Artifact kind "${artifact.kind}" is not supported in Phase 1 (only "skill" is supported)`,
      },
    };
  }

  // 2. Dispatch content resolution
  let resolvedContent: ResolvedArtifact<CanonicalSkill>;
  try {
    if (source.type === 'local-folder') {
      resolvedContent = await resolveLocalFolderContent(source, pkg, artifact);
    } else if (source.type === 'git-custom') {
      resolvedContent = await resolveGitCustomContent(source, pkg, artifact, resolverOpts);
    } else {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Source type "${source.type}" is not supported in Phase 1`,
        },
      };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      supported: false,
      plan: {
        supported: false,
        sourceId: source.id,
        packageId: pkg.id,
        artifactId: artifact.id,
        reason: `Content resolution failed: ${msg}`,
      },
    };
  }

  // 3. Translate skill content
  const translation = translateSkill(resolvedContent.content, targetAdapter.assistant);
  if (translation.overall === 'unsupported') {
    return {
      supported: false,
      plan: {
        supported: false,
        sourceId: source.id,
        packageId: pkg.id,
        artifactId: artifact.id,
        reason: `Target assistant "${targetAdapter.assistant}" is not supported in Phase 1`,
        diagnostics: translation.diagnostics,
      },
    };
  }

  const translatedSkill = translation.value;

  // 4. Resolve target directory
  let targetDir: string;
  try {
    targetDir = targetAdapter.skillDir(translatedSkill.name, {
      scope: targetScope,
      projectRoot,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      supported: false,
      plan: {
        supported: false,
        sourceId: source.id,
        packageId: pkg.id,
        artifactId: artifact.id,
        reason: `Failed to resolve target directory: ${msg}`,
        diagnostics: translation.diagnostics,
      },
    };
  }

  // 5. Inspect targetDir with lstat and walk if present
  const existingFiles: ExistingFile[] = [];
  try {
    const targetStat = await fs.promises.lstat(targetDir);

    if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Target path "${targetDir}" is a ${targetStat.isSymbolicLink() ? 'symlink' : 'non-directory file'} and will not be followed or overwritten`,
          diagnostics: translation.diagnostics,
        },
      };
    }

    // Walk existing directory
    const walk = async (currentDir: string, relativeRoot: string): Promise<boolean> => {
      const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relPath = relativeRoot === '' ? entry.name : path.posix.join(relativeRoot, entry.name);

        const stat = await fs.promises.lstat(fullPath);
        if (stat.isSymbolicLink() || stat.isSocket() || stat.isFIFO() || stat.isBlockDevice() || stat.isCharacterDevice()) {
          return false; // unsupported file type
        }

        if (stat.isDirectory()) {
          const ok = await walk(fullPath, relPath);
          if (!ok) return false;
        } else if (stat.isFile()) {
          try {
            const data = await fs.promises.readFile(fullPath);
            existingFiles.push({
              path: path.posix.normalize(relPath),
              contentHash: sha256(data),
            });
          } catch {
            return false;
          }
        }
      }
      return true;
    };

    const walkOk = await walk(targetDir, '');
    if (!walkOk) {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Target directory "${targetDir}" contains symlinks, special files, or unreadable entries`,
          diagnostics: translation.diagnostics,
        },
      };
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Error inspecting target directory: ${msg}`,
          diagnostics: translation.diagnostics,
        },
      };
    }
    // ENOENT: target does not exist yet, existingFiles remains empty
  }

  // 6. Build proposed files
  const proposedFiles: ProposedFile[] = [];
  const skillMdContent = serializeSkillMarkdown(translatedSkill);
  proposedFiles.push({
    path: 'SKILL.md',
    contentHash: sha256(Buffer.from(skillMdContent, 'utf-8')),
  });

  for (const f of translatedSkill.files) {
    proposedFiles.push({
      path: path.posix.normalize(f.path.split(path.sep).join('/')),
      contentHash: sha256(f.content),
      ...(f.mode !== undefined ? { mode: f.mode } : {}),
    });
  }

  const conflict = existingFiles.length > 0;
  const contentHash = canonicalSkillHash(translatedSkill);

  return {
    supported: true,
    plan: {
      supported: true,
      sourceId: source.id,
      packageId: pkg.id,
      artifactId: artifact.id,
      targetAssistant: targetAdapter.assistant,
      targetScope,
      targetDir,
      projectRoot,
      sourceRevision: pkg.version,
      conflict,
      existingFiles,
      proposedFiles,
      diagnostics: translation.diagnostics,
    },
    content: translatedSkill,
    contentHash,
  };
}
