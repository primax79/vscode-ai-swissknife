import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type {
  AssistantId,
  Scope,
  ManagedInstallation,
  ObservedArtifact,
} from '../domain/types';
import {
  canonicalSkillHash,
  canonicalAgentHash,
  canonicalCommandHash,
  canonicalMcpServerHash,
  readSkill,
} from '../adapters/codec';
import { serializeSkillMarkdown, serializeClaudeAgentMarkdown, serializeClaudeCommandMarkdown, ClaudeAdapter, claudeAdapter } from '../adapters/claude';
import { serializeKiloAgentMarkdown, serializeKiloCommandMarkdown, KiloAdapter, kiloAdapter } from '../adapters/kilo';
import { CopilotAdapter, copilotAdapter } from '../adapters/copilot';
import { CodexAdapter, codexAdapter } from '../adapters/codex';
import { GeminiAdapter, geminiAdapter } from '../adapters/gemini';
import { translateSkill } from '../translator/skill';
import { translateAgent } from '../translator/agent';
import { translateCommand } from '../translator/command';
import { translateMcpServer } from '../translator/mcp';
import type {
  PreparedInstall,
  ExistingFile,
  ProposedFile,
} from './types';

function sha256(data: Uint8Array | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function getAdapter(assistant: AssistantId, homeRoot?: string) {
  if (homeRoot) {
    if (assistant === 'claude-code') return new ClaudeAdapter(() => homeRoot);
    if (assistant === 'kilo-code') return new KiloAdapter(() => homeRoot);
    if (assistant === 'github-copilot') return new CopilotAdapter(() => homeRoot);
    if (assistant === 'codex-cli') return new CodexAdapter(() => homeRoot);
    if (assistant === 'gemini-cli') return new GeminiAdapter(() => homeRoot);
  }
  if (assistant === 'claude-code') return claudeAdapter;
  if (assistant === 'kilo-code') return kiloAdapter;
  if (assistant === 'github-copilot') return copilotAdapter;
  if (assistant === 'codex-cli') return codexAdapter;
  if (assistant === 'gemini-cli') return geminiAdapter;
  throw new Error(`Unsupported assistant: ${assistant}`);
}

export interface PlanSyncParams {
  sourceItem: ManagedInstallation | ObservedArtifact;
  targetAssistant: AssistantId;
  targetScope: Scope;
  targetProjectRoot?: string;
  homeRoot?: string;
}

/**
 * Plans the synchronization of an already installed item (or promoted ObservedArtifact)
 * from its current assistant/scope to a new target assistant/scope.
 */
export async function planSync(params: PlanSyncParams): Promise<PreparedInstall> {
  const { sourceItem, targetAssistant, targetScope, targetProjectRoot, homeRoot } = params;
  const srcAdapter = getAdapter(sourceItem.assistant, homeRoot);
  const targetAdapter = getAdapter(targetAssistant, homeRoot);

  const srcLoc = {
    scope: sourceItem.scope,
    projectRoot: sourceItem.projectPath,
  };

  const sourceId = ('sourceId' in sourceItem ? sourceItem.sourceId : undefined) ?? 'cross-assistant-sync';
  const packageId = 'packageId' in sourceItem ? sourceItem.packageId : undefined;
  const artifactId = 'artifactId' in sourceItem ? sourceItem.artifactId : undefined;
  const sourceRevision = 'sourceRevision' in sourceItem ? sourceItem.sourceRevision : undefined;

  // --- SKILL SYNC ---
  if (sourceItem.kind === 'skill') {
    if (!fs.existsSync(sourceItem.path)) {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId,
          packageId: packageId ?? `${sourceId}:${sourceItem.name}`,
          artifactId: artifactId ?? `${sourceId}:${sourceItem.name}`,
          reason: `Source skill directory not found at ${sourceItem.path}`,
        },
      };
    }

    const srcSkill = await readSkill(sourceItem.path);
    const translation = translateSkill(srcSkill, targetAssistant);

    if (translation.overall === 'unsupported') {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId,
          packageId: packageId ?? `${sourceId}:${sourceItem.name}`,
          artifactId: artifactId ?? `${sourceId}:${sourceItem.name}`,
          reason: `Target assistant "${targetAssistant}" is not supported for skills`,
          diagnostics: translation.diagnostics,
        },
      };
    }

    const translatedSkill = translation.value;
    const targetDir = targetAdapter.skillDir(translatedSkill.name, {
      scope: targetScope,
      projectRoot: targetProjectRoot,
    });

    const existingFiles: ExistingFile[] = [];
    try {
      const targetStat = await fs.promises.lstat(targetDir);
      if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
        return {
          supported: false,
          plan: {
            supported: false,
            sourceId,
            packageId: packageId ?? `${sourceId}:${sourceItem.name}`,
            artifactId: artifactId ?? `${sourceId}:${sourceItem.name}`,
            reason: `Target path "${targetDir}" is a ${targetStat.isSymbolicLink() ? 'symlink' : 'non-directory file'}`,
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
          if (stat.isDirectory()) {
            await walk(fullPath, relPath);
          } else if (stat.isFile()) {
            const data = await fs.promises.readFile(fullPath);
            existingFiles.push({
              path: path.posix.normalize(relPath),
              contentHash: sha256(data),
            });
          }
        }
        return true;
      };
      await walk(targetDir, '');
    } catch {
      // ignore missing target
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
        sourceId,
        packageId: packageId ?? `${sourceId}:${sourceItem.name}`,
        artifactId: artifactId ?? `${sourceId}:${sourceItem.name}`,
        targetAssistant,
        targetScope,
        targetDir,
        projectRoot: targetProjectRoot,
        sourceRevision,
        conflict,
        existingFiles,
        proposedFiles,
        diagnostics: translation.diagnostics,
      },
      content: translatedSkill,
      contentHash,
    };
  }

  // --- AGENT SYNC ---
  if (sourceItem.kind === 'agent') {
    const srcAgent = await srcAdapter.readAgent(sourceItem.name, srcLoc);
    if (!srcAgent) {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId,
          packageId: packageId ?? `${sourceId}:${sourceItem.name}`,
          artifactId: artifactId ?? `${sourceId}:${sourceItem.name}`,
          reason: `Source agent not found for ${sourceItem.name}`,
        },
      };
    }

    const translation = translateAgent(srcAgent, targetAssistant);
    if (translation.overall === 'unsupported') {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId,
          packageId: packageId ?? `${sourceId}:${sourceItem.name}`,
          artifactId: artifactId ?? `${sourceId}:${sourceItem.name}`,
          reason: `Target assistant "${targetAssistant}" is not supported for agents`,
          diagnostics: translation.diagnostics,
        },
      };
    }

    const translatedAgent = translation.value;
    const targetFilePath = targetAdapter.agentPath(translatedAgent.name, {
      scope: targetScope,
      projectRoot: targetProjectRoot,
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

    const serialized =
      targetAssistant === 'kilo-code'
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
        sourceId,
        packageId: packageId ?? `${sourceId}:${sourceItem.name}`,
        artifactId: artifactId ?? `${sourceId}:${sourceItem.name}`,
        targetAssistant,
        targetScope,
        targetDir: targetFilePath,
        projectRoot: targetProjectRoot,
        sourceRevision,
        conflict,
        existingFiles,
        proposedFiles,
        diagnostics: translation.diagnostics,
      },
      content: translatedAgent,
      contentHash,
    };
  }

  // --- COMMAND SYNC ---
  if (sourceItem.kind === 'command') {
    const srcCmd = await srcAdapter.readCommand(sourceItem.name, srcLoc);
    if (!srcCmd) {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId,
          packageId: packageId ?? `${sourceId}:${sourceItem.name}`,
          artifactId: artifactId ?? `${sourceId}:${sourceItem.name}`,
          reason: `Source command not found for ${sourceItem.name}`,
        },
      };
    }

    const translation = translateCommand(srcCmd, targetAssistant);
    if (translation.overall === 'unsupported') {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId,
          packageId: packageId ?? `${sourceId}:${sourceItem.name}`,
          artifactId: artifactId ?? `${sourceId}:${sourceItem.name}`,
          reason: `Target assistant "${targetAssistant}" is not supported for commands`,
          diagnostics: translation.diagnostics,
        },
      };
    }

    const translatedCmd = translation.value;
    const targetFilePath = targetAdapter.commandPath(translatedCmd.name, {
      scope: targetScope,
      projectRoot: targetProjectRoot,
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

    const serialized =
      targetAssistant === 'kilo-code'
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
        sourceId,
        packageId: packageId ?? `${sourceId}:${sourceItem.name}`,
        artifactId: artifactId ?? `${sourceId}:${sourceItem.name}`,
        targetAssistant,
        targetScope,
        targetDir: targetFilePath,
        projectRoot: targetProjectRoot,
        sourceRevision,
        conflict,
        existingFiles,
        proposedFiles,
        diagnostics: translation.diagnostics,
      },
      content: translatedCmd,
      contentHash,
    };
  }

  // --- MCP-SERVER SYNC ---
  if (sourceItem.kind === 'mcp-server') {
    const srcMcp = await srcAdapter.readMcpServer(sourceItem.name, srcLoc);
    if (!srcMcp) {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId,
          packageId: packageId ?? `${sourceId}:${sourceItem.name}`,
          artifactId: artifactId ?? `${sourceId}:${sourceItem.name}`,
          reason: `Source MCP server not found for ${sourceItem.name}`,
        },
      };
    }

    const translation = translateMcpServer(srcMcp, targetAssistant);
    if (translation.overall === 'unsupported') {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId,
          packageId: packageId ?? `${sourceId}:${sourceItem.name}`,
          artifactId: artifactId ?? `${sourceId}:${sourceItem.name}`,
          reason: `Target assistant "${targetAssistant}" is not supported for MCP servers`,
          diagnostics: translation.diagnostics,
        },
      };
    }

    const translatedMcp = translation.value;
    const targetFilePath = targetAdapter.mcpConfigPath({
      scope: targetScope,
      projectRoot: targetProjectRoot,
    });

    let conflict = false;
    const existingFiles: ExistingFile[] = [];

    try {
      const existing = await targetAdapter.readMcpServer(translatedMcp.id, {
        scope: targetScope,
        projectRoot: targetProjectRoot,
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
        sourceId,
        packageId: packageId ?? `${sourceId}:${sourceItem.name}`,
        artifactId: artifactId ?? `${sourceId}:${sourceItem.name}`,
        targetAssistant,
        targetScope,
        targetDir: targetFilePath,
        projectRoot: targetProjectRoot,
        sourceRevision,
        conflict,
        existingFiles,
        proposedFiles,
        diagnostics: translation.diagnostics,
      },
      content: translatedMcp,
      contentHash,
    };
  }

  return {
    supported: false,
    plan: {
      supported: false,
      sourceId,
      packageId: packageId ?? `${sourceId}:${sourceItem.name}`,
      artifactId: artifactId ?? `${sourceId}:${sourceItem.name}`,
      reason: `Unsupported kind for sync: ${sourceItem.kind}`,
    },
  };
}
