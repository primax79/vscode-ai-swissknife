import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { CanonicalSkill, CanonicalAgent, CanonicalCommand } from '../adapters/types';
import type { ResolvedArtifact } from '../domain/types';
import {
  serializeSkillMarkdown,
  serializeClaudeAgentMarkdown,
  serializeClaudeCommandMarkdown,
} from '../adapters/claude';
import {
  serializeKiloAgentMarkdown,
  serializeKiloCommandMarkdown,
} from '../adapters/kilo';
import {
  canonicalSkillHash,
  canonicalAgentHash,
  canonicalCommandHash,
} from '../adapters/codec';
import { resolveArtifactContent as resolveLocalFolderContent } from '../sources/localFolder';
import { resolveArtifactContent as resolveGitCustomContent } from '../sources/gitCustom';
import { translateSkill } from '../translator/skill';
import { translateAgent } from '../translator/agent';
import { translateCommand } from '../translator/command';
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

  if (artifact.kind !== 'skill' && artifact.kind !== 'agent' && artifact.kind !== 'command') {
    return {
      supported: false,
      plan: {
        supported: false,
        sourceId: source.id,
        packageId: pkg.id,
        artifactId: artifact.id,
        reason: `Artifact kind "${artifact.kind}" is not supported (supported kinds: skill, agent, command)`,
      },
    };
  }

  // --- COMMAND KIND ---
  if (artifact.kind === 'command') {
    let resolvedCmd: ResolvedArtifact<CanonicalCommand>;
    try {
      if (source.type === 'local-folder') {
        resolvedCmd = (await resolveLocalFolderContent(source, pkg, artifact)) as ResolvedArtifact<CanonicalCommand>;
      } else if (source.type === 'git-custom') {
        resolvedCmd = (await resolveGitCustomContent(source, pkg, artifact, resolverOpts)) as ResolvedArtifact<CanonicalCommand>;
      } else {
        throw new Error(`Source type "${source.type}" is not yet supported for command resolution`);
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
          reason: `Command content resolution failed: ${msg}`,
        },
      };
    }

    const translation = translateCommand(resolvedCmd.content, targetAdapter.assistant);

    if (translation.overall === 'unsupported') {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Target assistant "${targetAdapter.assistant}" is not supported for commands`,
          diagnostics: translation.diagnostics,
        },
      };
    }

    const translatedCmd = translation.value;
    if (!targetAdapter.commandPath) {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Target adapter for "${targetAdapter.assistant}" does not support command installation`,
          diagnostics: translation.diagnostics,
        },
      };
    }

    const targetFilePath = targetAdapter.commandPath(translatedCmd.name, {
      scope: targetScope,
      projectRoot,
    });

    const existingFiles: ExistingFile[] = [];
    try {
      const stat = await fs.promises.lstat(targetFilePath);
      if (stat.isSymbolicLink() || stat.isDirectory()) {
        return {
          supported: false,
          plan: {
            supported: false,
            sourceId: source.id,
            packageId: pkg.id,
            artifactId: artifact.id,
            reason: `Target command path "${targetFilePath}" is a directory or symlink and will not be overwritten`,
            diagnostics: translation.diagnostics,
          },
        };
      }
      const data = await fs.promises.readFile(targetFilePath);
      existingFiles.push({
        path: path.basename(targetFilePath),
        contentHash: sha256(data),
      });
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
            reason: `Error inspecting target command file: ${msg}`,
            diagnostics: translation.diagnostics,
          },
        };
      }
    }

    const serialized =
      targetAdapter.assistant === 'claude-code'
        ? serializeClaudeCommandMarkdown(translatedCmd)
        : serializeKiloCommandMarkdown(translatedCmd);

    const proposedFiles: ProposedFile[] = [
      {
        path: path.basename(targetFilePath),
        contentHash: sha256(Buffer.from(serialized, 'utf-8')),
      },
    ];

    const conflict = existingFiles.length > 0;
    const contentHash = canonicalCommandHash(translatedCmd);

    return {
      supported: true,
      kind: 'command',
      plan: {
        supported: true,
        sourceId: source.id,
        packageId: pkg.id,
        artifactId: artifact.id,
        targetAssistant: targetAdapter.assistant,
        targetScope,
        targetDir: targetFilePath,
        projectRoot,
        sourceRevision: pkg.version,
        conflict,
        existingFiles,
        proposedFiles,
        diagnostics: translation.diagnostics,
      },
      content: translatedCmd,
      contentHash,
    };
  }

  // --- AGENT KIND ---
  if (artifact.kind === 'agent') {
    let resolvedAgent: ResolvedArtifact<CanonicalAgent>;
    try {
      if (source.type === 'local-folder') {
        resolvedAgent = (await resolveLocalFolderContent(source, pkg, artifact)) as ResolvedArtifact<CanonicalAgent>;
      } else if (source.type === 'git-custom') {
        resolvedAgent = (await resolveGitCustomContent(source, pkg, artifact, resolverOpts)) as ResolvedArtifact<CanonicalAgent>;
      } else {
        throw new Error(`Source type "${source.type}" is not yet supported for agent resolution`);
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
          reason: `Agent content resolution failed: ${msg}`,
        },
      };
    }

    const translation = translateAgent(resolvedAgent.content, targetAdapter.assistant);

    if (translation.overall === 'unsupported') {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Target assistant "${targetAdapter.assistant}" is not supported for agents`,
          diagnostics: translation.diagnostics,
        },
      };
    }

    const translatedAgent = translation.value;
    if (!targetAdapter.agentPath) {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Target adapter for "${targetAdapter.assistant}" does not support agent installation`,
          diagnostics: translation.diagnostics,
        },
      };
    }

    const targetFilePath = targetAdapter.agentPath(translatedAgent.name, {
      scope: targetScope,
      projectRoot,
    });

    const existingFiles: ExistingFile[] = [];
    try {
      const stat = await fs.promises.lstat(targetFilePath);
      if (stat.isSymbolicLink() || stat.isDirectory()) {
        return {
          supported: false,
          plan: {
            supported: false,
            sourceId: source.id,
            packageId: pkg.id,
            artifactId: artifact.id,
            reason: `Target agent path "${targetFilePath}" is a directory or symlink and will not be overwritten`,
            diagnostics: translation.diagnostics,
          },
        };
      }
      const data = await fs.promises.readFile(targetFilePath);
      existingFiles.push({
        path: path.basename(targetFilePath),
        contentHash: sha256(data),
      });
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
            reason: `Error inspecting target agent file: ${msg}`,
            diagnostics: translation.diagnostics,
          },
        };
      }
    }

    const serialized =
      targetAdapter.assistant === 'claude-code'
        ? serializeClaudeAgentMarkdown(translatedAgent)
        : serializeKiloAgentMarkdown(translatedAgent);

    const proposedFiles: ProposedFile[] = [
      {
        path: path.basename(targetFilePath),
        contentHash: sha256(Buffer.from(serialized, 'utf-8')),
      },
    ];

    const conflict = existingFiles.length > 0;
    const contentHash = canonicalAgentHash(translatedAgent);

    return {
      supported: true,
      kind: 'agent',
      plan: {
        supported: true,
        sourceId: source.id,
        packageId: pkg.id,
        artifactId: artifact.id,
        targetAssistant: targetAdapter.assistant,
        targetScope,
        targetDir: targetFilePath,
        projectRoot,
        sourceRevision: pkg.version,
        conflict,
        existingFiles,
        proposedFiles,
        diagnostics: translation.diagnostics,
      },
      content: translatedAgent,
      contentHash,
    };
  }

  // --- SKILL KIND ---
  let resolvedContent: ResolvedArtifact<CanonicalSkill>;
  try {
    if (source.type === 'local-folder') {
      resolvedContent = (await resolveLocalFolderContent(source, pkg, artifact)) as ResolvedArtifact<CanonicalSkill>;
    } else if (source.type === 'git-custom') {
      resolvedContent = (await resolveGitCustomContent(source, pkg, artifact, resolverOpts)) as ResolvedArtifact<CanonicalSkill>;
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

    const walk = async (currentDir: string, relativeRoot: string): Promise<boolean> => {
      const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relPath = relativeRoot === '' ? entry.name : path.posix.join(relativeRoot, entry.name);

        const stat = await fs.promises.lstat(fullPath);
        if (stat.isSymbolicLink() || stat.isSocket() || stat.isFIFO() || stat.isBlockDevice() || stat.isCharacterDevice()) {
          return false;
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
  }

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
    kind: 'skill',
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
