import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type {
  CanonicalSkill,
  CanonicalAgent,
  CanonicalCommand,
  CanonicalMcpServer,
  CanonicalHook,
  CanonicalRule,
} from '../adapters/types';
import type { ResolvedArtifact, Source, Package, Artifact, AssistantId } from '../domain/types';
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
  canonicalMcpServerHash,
  canonicalHookHash,
  canonicalRuleHash,
} from '../adapters/codec';
import { resolveArtifactContent as resolveLocalFolderContent } from '../sources/localFolder';
import { resolveArtifactContent as resolveGitCustomContent } from '../sources/gitCustom';
import { resolveArtifactContent as resolveGitMarketplaceContent } from '../sources/gitMarketplace';
import { resolveArtifactContent as resolveGitSingleItemContent } from '../sources/gitSingleItem';
import { resolveArtifactContent as resolveRemoteUrlContent } from '../sources/remoteUrl';
import { translateSkill } from '../translator/skill';
import { translateAgent } from '../translator/agent';
import { translateCommand } from '../translator/command';
import { translateMcpServer } from '../translator/mcp';
import { translateHook } from '../translator/hook';
import { translateRule } from '../translator/rule';
import type {
  PreparedInstall,
  PlanInstallParams,
  ExistingFile,
  ProposedFile,
} from './types';

function sha256(data: Uint8Array | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

async function resolveContentFromSource(
  source: Source,
  pkg: Package,
  artifact: Artifact,
  resolverOpts?: { cacheDir?: string; homeRoot?: string }
): Promise<ResolvedArtifact<CanonicalSkill | CanonicalAgent | CanonicalCommand | CanonicalMcpServer | CanonicalHook | CanonicalRule>> {
  if (source.type === 'local-folder') {
    return await resolveLocalFolderContent(source, pkg, artifact);
  }
  if (source.type === 'git-custom') {
    return await resolveGitCustomContent(source, pkg, artifact, resolverOpts);
  }
  if (source.type === 'git-marketplace') {
    return await resolveGitMarketplaceContent(source, pkg, artifact, resolverOpts);
  }
  if (source.type === 'git-single-item') {
    return await resolveGitSingleItemContent(source, pkg, artifact, resolverOpts);
  }
  if (source.type === 'remote-url') {
    return await resolveRemoteUrlContent(source, pkg, artifact, resolverOpts);
  }
  throw new Error(`Unsupported source type: ${source.type}`);
}


export async function resolveAndTranslate(
  source: Source,
  pkg: Package,
  artifact: Artifact,
  targetAssistant: AssistantId,
  resolverOpts?: { cacheDir?: string; homeRoot?: string }
) {
  if (artifact.kind === 'rule') {
    const resolved = (await resolveContentFromSource(source, pkg, artifact, resolverOpts)) as ResolvedArtifact<CanonicalRule>;
    const translation = translateRule(resolved.content, targetAssistant);
    return { translated: translation.value, diagnostic: translation.overall, diagnostics: translation.diagnostics };
  }
  if (artifact.kind === 'hook') {
    const resolved = (await resolveContentFromSource(source, pkg, artifact, resolverOpts)) as ResolvedArtifact<CanonicalHook>;
    const translation = translateHook(resolved.content, targetAssistant);
    return { translated: translation.value, diagnostic: translation.overall, diagnostics: translation.diagnostics };
  }
  if (artifact.kind === 'mcp-server') {
    const resolved = (await resolveContentFromSource(source, pkg, artifact, resolverOpts)) as ResolvedArtifact<CanonicalMcpServer>;
    const translation = translateMcpServer(resolved.content, targetAssistant);
    return { translated: translation.value, diagnostic: translation.overall, diagnostics: translation.diagnostics };
  }
  if (artifact.kind === 'command') {
    const resolved = (await resolveContentFromSource(source, pkg, artifact, resolverOpts)) as ResolvedArtifact<CanonicalCommand>;
    const translation = translateCommand(resolved.content, targetAssistant);
    return { translated: translation.value, diagnostic: translation.overall, diagnostics: translation.diagnostics };
  }
  if (artifact.kind === 'agent') {
    const resolved = (await resolveContentFromSource(source, pkg, artifact, resolverOpts)) as ResolvedArtifact<CanonicalAgent>;
    const translation = translateAgent(resolved.content, targetAssistant);
    return { translated: translation.value, diagnostic: translation.overall, diagnostics: translation.diagnostics };
  }
  if (artifact.kind === 'skill') {
    const resolved = (await resolveContentFromSource(source, pkg, artifact, resolverOpts)) as ResolvedArtifact<CanonicalSkill>;
    const translation = translateSkill(resolved.content, targetAssistant);
    return { translated: translation.value, diagnostic: translation.overall, diagnostics: translation.diagnostics };
  }
  throw new Error(`Unsupported artifact kind: ${artifact.kind}`);
}

export async function planInstall(params: PlanInstallParams): Promise<PreparedInstall> {
  const { source, pkg, artifact, targetAdapter, targetScope } = params;
  const resolverOpts = { ...params.resolverOpts, homeRoot: params.homeRoot ?? params.resolverOpts?.homeRoot };
  const projectRoot = targetScope === 'project' ? params.projectRoot : undefined;

  if (
    artifact.kind !== 'skill' &&
    artifact.kind !== 'agent' &&
    artifact.kind !== 'command' &&
    artifact.kind !== 'mcp-server' &&
    artifact.kind !== 'hook' &&
    artifact.kind !== 'rule'
  ) {
    return {
      supported: false,
      plan: {
        supported: false,
        sourceId: source.id,
        packageId: pkg.id,
        artifactId: artifact.id,
        reason: `Artifact kind "${artifact.kind}" is not supported`,
      },
    };
  }

  // --- RULE KIND ---
  if (artifact.kind === 'rule') {
    let contentResult;
    try {
      contentResult = await resolveAndTranslate(source, pkg, artifact, targetAdapter.assistant, resolverOpts);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Rule content resolution failed: ${msg}`,
        },
      };
    }

    if (contentResult.diagnostic === 'unsupported') {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Target assistant "${targetAdapter.assistant}" is not supported for rules`,
          diagnostics: contentResult.diagnostics,
        },
      };
    }

    const translatedRule = contentResult.translated as CanonicalRule;
    if (!targetAdapter.rulePath) {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Target adapter for "${targetAdapter.assistant}" does not support rule installation`,
          diagnostics: contentResult.diagnostics,
        },
      };
    }

    const targetFilePath = targetAdapter.rulePath({
      scope: targetScope,
      projectRoot,
    });

    const existingFiles: ExistingFile[] = [];
    try {
      const data = await fs.promises.readFile(targetFilePath);
      existingFiles.push({
        path: path.basename(targetFilePath),
        contentHash: sha256(data),
      });
    } catch {
      // ignore
    }

    const contentHash = canonicalRuleHash(translatedRule);
    const proposedFiles: ProposedFile[] = [
      {
        path: path.basename(targetFilePath),
        contentHash,
      },
    ];

    return {
      supported: true,
      kind: 'rule',
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
        conflict: existingFiles.length > 0,
        existingFiles,
        proposedFiles,
        diagnostics: contentResult.diagnostics,
      },
      content: translatedRule,
      contentHash,
    };
  }

  // --- HOOK KIND ---
  if (artifact.kind === 'hook') {
    let contentResult;
    try {
      contentResult = await resolveAndTranslate(source, pkg, artifact, targetAdapter.assistant, resolverOpts);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Hook content resolution failed: ${msg}`,
        },
      };
    }

    if (contentResult.diagnostic === 'unsupported') {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Target assistant "${targetAdapter.assistant}" is not supported for hooks`,
          diagnostics: contentResult.diagnostics,
        },
      };
    }

    const translatedHook = contentResult.translated as CanonicalHook;
    if (!targetAdapter.hookPath) {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Target adapter for "${targetAdapter.assistant}" does not support hook installation`,
          diagnostics: contentResult.diagnostics,
        },
      };
    }

    const targetFilePath = targetAdapter.hookPath(translatedHook.name, {
      scope: targetScope,
      projectRoot,
    });

    const existingFiles: ExistingFile[] = [];
    try {
      const data = await fs.promises.readFile(targetFilePath);
      existingFiles.push({
        path: path.basename(targetFilePath),
        contentHash: sha256(data),
      });
    } catch {
      // ignore
    }

    const contentHash = canonicalHookHash(translatedHook);
    const proposedFiles: ProposedFile[] = [
      {
        path: path.basename(targetFilePath),
        contentHash,
      },
    ];

    return {
      supported: true,
      kind: 'hook',
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
        conflict: existingFiles.length > 0,
        existingFiles,
        proposedFiles,
        diagnostics: contentResult.diagnostics,
      },
      content: translatedHook,
      contentHash,
    };
  }

  // --- MCP-SERVER KIND ---
  if (artifact.kind === 'mcp-server') {
    let contentResult;
    try {
      contentResult = await resolveAndTranslate(source, pkg, artifact, targetAdapter.assistant, resolverOpts);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `MCP content resolution failed: ${msg}`,
        },
      };
    }

    if (contentResult.diagnostic === 'unsupported') {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Target assistant "${targetAdapter.assistant}" is not supported for MCP servers`,
          diagnostics: contentResult.diagnostics,
        },
      };
    }

    const translatedMcp = contentResult.translated as CanonicalMcpServer;
    if (!targetAdapter.mcpConfigPath) {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Target adapter for "${targetAdapter.assistant}" does not support MCP installation`,
          diagnostics: contentResult.diagnostics,
        },
      };
    }

    const targetFilePath = targetAdapter.mcpConfigPath({
      scope: targetScope,
      projectRoot,
    });

    let conflict = false;
    const existingFiles: ExistingFile[] = [];

    if (targetAdapter.readMcpServer) {
      try {
        const existing = await targetAdapter.readMcpServer(translatedMcp.id, {
          scope: targetScope,
          projectRoot,
        });
        if (existing) {
          conflict = true;
          existingFiles.push({
            path: path.basename(targetFilePath),
            contentHash: canonicalMcpServerHash(existing),
          });
        }
      } catch {
        // ignore
      }
    }

    const contentHash = canonicalMcpServerHash(translatedMcp);
    const proposedFiles: ProposedFile[] = [
      {
        path: path.basename(targetFilePath),
        contentHash,
      },
    ];

    return {
      supported: true,
      kind: 'mcp-server',
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
        diagnostics: contentResult.diagnostics,
      },
      content: translatedMcp,
      contentHash,
    };
  }

  // --- COMMAND KIND ---
  if (artifact.kind === 'command') {
    let contentResult;
    try {
      contentResult = await resolveAndTranslate(source, pkg, artifact, targetAdapter.assistant, resolverOpts);
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

    if (contentResult.diagnostic === 'unsupported') {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Target assistant "${targetAdapter.assistant}" is not supported for commands`,
          diagnostics: contentResult.diagnostics,
        },
      };
    }

    const translatedCmd = contentResult.translated as CanonicalCommand;
    if (!targetAdapter.commandPath) {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Target adapter for "${targetAdapter.assistant}" does not support command installation`,
          diagnostics: contentResult.diagnostics,
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
            diagnostics: contentResult.diagnostics,
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
            diagnostics: contentResult.diagnostics,
          },
        };
      }
    }

    const serialized =
      targetAdapter.assistant === 'kilo-code'
        ? serializeKiloCommandMarkdown(translatedCmd)
        : serializeClaudeCommandMarkdown(translatedCmd);

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
        diagnostics: contentResult.diagnostics,
      },
      content: translatedCmd,
      contentHash,
    };
  }

  // --- AGENT KIND ---
  if (artifact.kind === 'agent') {
    let contentResult;
    try {
      contentResult = await resolveAndTranslate(source, pkg, artifact, targetAdapter.assistant, resolverOpts);
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

    if (contentResult.diagnostic === 'unsupported') {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Target assistant "${targetAdapter.assistant}" is not supported for agents`,
          diagnostics: contentResult.diagnostics,
        },
      };
    }

    const translatedAgent = contentResult.translated as CanonicalAgent;
    if (!targetAdapter.agentPath) {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Target adapter for "${targetAdapter.assistant}" does not support agent installation`,
          diagnostics: contentResult.diagnostics,
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
            diagnostics: contentResult.diagnostics,
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
            diagnostics: contentResult.diagnostics,
          },
        };
      }
    }

    const serialized =
      targetAdapter.assistant === 'kilo-code'
        ? serializeKiloAgentMarkdown(translatedAgent)
        : serializeClaudeAgentMarkdown(translatedAgent);

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
        diagnostics: contentResult.diagnostics,
      },
      content: translatedAgent,
      contentHash,
    };
  }

  // --- SKILL KIND ---
  let contentResult;
  try {
    contentResult = await resolveAndTranslate(source, pkg, artifact, targetAdapter.assistant, resolverOpts);
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

  if (contentResult.diagnostic === 'unsupported') {
    return {
      supported: false,
      plan: {
        supported: false,
        sourceId: source.id,
        packageId: pkg.id,
        artifactId: artifact.id,
        reason: `Target assistant "${targetAdapter.assistant}" is not supported in Phase 1`,
        diagnostics: contentResult.diagnostics,
      },
    };
  }

  const translatedSkill = contentResult.translated as CanonicalSkill;

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
        diagnostics: contentResult.diagnostics,
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
          diagnostics: contentResult.diagnostics,
        },
      };
    }

    const walk = async (currentDir: string, relativeRoot: string): Promise<boolean> => {
      const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.name === '.git' ||
          entry.name === 'node_modules' ||
          entry.name === 'index.json' ||
          entry.name === 'local.patch' ||
          entry.name.endsWith('.patch') ||
          entry.name === '.DS_Store' ||
          entry.name === 'Thumbs.db'
        ) {
          continue;
        }
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
          diagnostics: contentResult.diagnostics,
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
          diagnostics: contentResult.diagnostics,
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
      targetDir: targetDir,
      projectRoot,
      sourceRevision: pkg.version,
      conflict,
      existingFiles,
      proposedFiles,
      diagnostics: contentResult.diagnostics,
    },
    content: translatedSkill,
    contentHash,
  };
}
