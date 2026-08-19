import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { ManagedInstallation } from '../domain/types';
import {
  canonicalSkillHash,
  canonicalAgentHash,
  canonicalCommandHash,
  canonicalMcpServerHash,
  canonicalHookHash,
  canonicalRuleHash,
  readSkill,
  writeSkill,
} from '../adapters/codec';
import {
  serializeClaudeAgentMarkdown,
  parseClaudeAgentMarkdown,
  serializeClaudeCommandMarkdown,
  parseClaudeCommandMarkdown,
  claudeAdapter,
} from '../adapters/claude';
import {
  serializeKiloAgentMarkdown,
  parseKiloAgentMarkdown,
  serializeKiloCommandMarkdown,
  parseKiloCommandMarkdown,
  kiloAdapter,
} from '../adapters/kilo';
import { copilotAdapter } from '../adapters/copilot';
import { readState, writeState } from '../domain/registry';
import type { PreparedInstall, ApplyOutcome } from './types';

function sha256(data: Uint8Array | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export async function applyInstall(
  prepared: PreparedInstall,
  homeRoot?: string
): Promise<ApplyOutcome> {
  // 1. Pre-flight checks before any mutation
  if (!prepared.supported) {
    return {
      status: 'refused',
      reason: prepared.plan.reason,
    };
  }

  const plan = prepared.plan;

  // --- RULE KIND APPLY (Demarcated Merge) ---
  if (prepared.kind === 'rule') {
    const rule = prepared.content;
    const recomputedHash = canonicalRuleHash(rule);
    if (recomputedHash !== prepared.contentHash) {
      return {
        status: 'refused',
        reason: 'Rule content was mutated after preview (hash mismatch)',
      };
    }

    const targetFilePath = plan.targetDir;
    let targetExists = false;
    let existingContent = '';

    try {
      existingContent = await fs.promises.readFile(targetFilePath, 'utf-8');
      targetExists = true;
    } catch {
      // ignore
    }

    const markerStart = `<!-- ai-swissknife:managed:${plan.sourceId} -->`;
    const markerEnd = '<!-- /ai-swissknife:managed -->';
    const managedBlock = `${markerStart}\n${rule.content.trim()}\n${markerEnd}`;

    let mergedContent: string;
    const markerRegex = new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`);

    if (targetExists) {
      if (markerRegex.test(existingContent)) {
        mergedContent = existingContent.replace(markerRegex, managedBlock);
      } else {
        mergedContent = `${existingContent.trimEnd()}\n\n${managedBlock}\n`;
      }
    } else {
      mergedContent = `${managedBlock}\n`;
    }

    const randomId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const stagingPath = `${targetFilePath}.staging-${randomId}`;
    const backupPath = `${targetFilePath}.backup-${randomId}`;

    try {
      await fs.promises.mkdir(path.dirname(stagingPath), { recursive: true });
      await fs.promises.writeFile(stagingPath, mergedContent, 'utf-8');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { status: 'refused', reason: `Rule staging failed: ${msg}` };
    }

    let backupCreated = false;
    try {
      if (targetExists) {
        await fs.promises.copyFile(targetFilePath, backupPath);
        backupCreated = true;
      }
      await fs.promises.rename(stagingPath, targetFilePath);
    } catch (swapErr: unknown) {
      const msg = swapErr instanceof Error ? swapErr.message : String(swapErr);
      if (backupCreated) {
        try {
          await fs.promises.copyFile(backupPath, targetFilePath);
          await fs.promises.unlink(backupPath);
          return { status: 'rolled-back', reason: `Rule swap failed and restored: ${msg}` };
        } catch {
          return { status: 'manual-recovery-required', reason: `Rule swap failed: ${msg}`, paths: [targetFilePath, backupPath] };
        }
      }
      return { status: 'refused', reason: `Rule swap failed: ${msg}` };
    }

    // Final verification
    try {
      const finalContent = await fs.promises.readFile(targetFilePath, 'utf-8');
      if (!finalContent.includes(rule.content.trim())) {
        throw new Error('Final rule verification failed');
      }
    } catch (verifyErr: unknown) {
      const msg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
      if (backupCreated) {
        try {
          await fs.promises.copyFile(backupPath, targetFilePath);
          await fs.promises.unlink(backupPath);
        } catch {
          // ignore
        }
      }
      return { status: 'rolled-back', reason: `Final rule verification failed: ${msg}` };
    }

    // State persistence
    const installation: ManagedInstallation = {
      assistant: plan.targetAssistant,
      scope: plan.targetScope,
      projectPath: plan.projectRoot,
      kind: 'rule',
      name: `rule:${plan.sourceId}`,
      path: targetFilePath,
      sourceId: plan.sourceId,
      packageId: plan.packageId,
      artifactId: plan.artifactId,
      sourceRevision: plan.sourceRevision,
      installedAt: new Date().toISOString(),
      contentHash: prepared.contentHash,
    };

    try {
      const state = await readState(plan.targetScope, plan.projectRoot, homeRoot);
      const filtered = state.installations.filter(
        (inst) =>
          !(
            inst.assistant === plan.targetAssistant &&
            inst.scope === plan.targetScope &&
            inst.projectPath === plan.projectRoot &&
            inst.path === targetFilePath &&
            inst.name === installation.name
          )
      );
      filtered.push(installation);

      await writeState(
        plan.targetScope,
        {
          schemaVersion: state.schemaVersion,
          installations: filtered,
        },
        plan.projectRoot,
        homeRoot
      );
    } catch (stateErr: unknown) {
      const msg = stateErr instanceof Error ? stateErr.message : String(stateErr);
      if (backupCreated) {
        try {
          await fs.promises.copyFile(backupPath, targetFilePath);
          await fs.promises.unlink(backupPath);
        } catch {
          // ignore
        }
      }
      return { status: 'rolled-back', reason: `State persistence failed: ${msg}` };
    }

    if (backupCreated) {
      try {
        await fs.promises.unlink(backupPath);
      } catch {
        // ignore
      }
    }

    return { status: 'applied', installation };
  }

  // --- HOOK KIND APPLY ---
  if (prepared.kind === 'hook') {
    const hook = prepared.content;
    const recomputedHash = canonicalHookHash(hook);
    if (recomputedHash !== prepared.contentHash) {
      return {
        status: 'refused',
        reason: 'Hook content was mutated after preview (hash mismatch)',
      };
    }

    const targetFilePath = plan.targetDir;
    let targetExists = false;
    try {
      await fs.promises.lstat(targetFilePath);
      targetExists = true;
    } catch {
      // ignore
    }

    const randomId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const stagingPath = `${targetFilePath}.staging-${randomId}`;
    const backupPath = `${targetFilePath}.backup-${randomId}`;

    const payload = {
      event: hook.event,
      command: hook.command,
      ...(hook.timeout ? { timeout: hook.timeout } : {}),
      ...hook.extraFields,
    };

    try {
      await fs.promises.mkdir(path.dirname(stagingPath), { recursive: true });
      await fs.promises.writeFile(stagingPath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { status: 'refused', reason: `Hook staging failed: ${msg}` };
    }

    let backupCreated = false;
    try {
      if (targetExists) {
        await fs.promises.rename(targetFilePath, backupPath);
        backupCreated = true;
      }
      await fs.promises.rename(stagingPath, targetFilePath);
    } catch (swapErr: unknown) {
      const msg = swapErr instanceof Error ? swapErr.message : String(swapErr);
      if (backupCreated) {
        try {
          await fs.promises.rename(backupPath, targetFilePath);
          return { status: 'rolled-back', reason: `Hook swap failed and restored: ${msg}` };
        } catch {
          return { status: 'manual-recovery-required', reason: `Hook restore failed: ${msg}`, paths: [targetFilePath, backupPath] };
        }
      }
      return { status: 'refused', reason: `Hook swap failed: ${msg}` };
    }

    // State persistence
    const installation: ManagedInstallation = {
      assistant: plan.targetAssistant,
      scope: plan.targetScope,
      projectPath: plan.projectRoot,
      kind: 'hook',
      name: hook.name,
      path: targetFilePath,
      sourceId: plan.sourceId,
      packageId: plan.packageId,
      artifactId: plan.artifactId,
      sourceRevision: plan.sourceRevision,
      installedAt: new Date().toISOString(),
      contentHash: prepared.contentHash,
    };

    try {
      const state = await readState(plan.targetScope, plan.projectRoot, homeRoot);
      const filtered = state.installations.filter(
        (inst) =>
          !(
            inst.assistant === plan.targetAssistant &&
            inst.scope === plan.targetScope &&
            inst.projectPath === plan.projectRoot &&
            inst.path === targetFilePath &&
            inst.name === hook.name
          )
      );
      filtered.push(installation);

      await writeState(
        plan.targetScope,
        {
          schemaVersion: state.schemaVersion,
          installations: filtered,
        },
        plan.projectRoot,
        homeRoot
      );
    } catch (stateErr: unknown) {
      const msg = stateErr instanceof Error ? stateErr.message : String(stateErr);
      if (backupCreated) {
        try {
          await fs.promises.rename(backupPath, targetFilePath);
        } catch {
          // ignore
        }
      }
      return { status: 'rolled-back', reason: `State persistence failed: ${msg}` };
    }

    if (backupCreated) {
      try {
        await fs.promises.unlink(backupPath);
      } catch {
        // ignore
      }
    }

    return { status: 'applied', installation };
  }

  // --- MCP-SERVER KIND APPLY ---
  if (prepared.kind === 'mcp-server') {
    const mcp = prepared.content;
    const recomputedHash = canonicalMcpServerHash(mcp);
    if (recomputedHash !== prepared.contentHash) {
      return {
        status: 'refused',
        reason: 'MCP server content was mutated after preview (hash mismatch)',
      };
    }

    const adapter =
      plan.targetAssistant === 'claude-code'
        ? claudeAdapter
        : plan.targetAssistant === 'github-copilot'
        ? copilotAdapter
        : kiloAdapter;
    const targetFilePath = plan.targetDir;
    const randomId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const backupPath = `${targetFilePath}.backup-${randomId}`;

    let backupCreated = false;
    try {
      if (fs.existsSync(targetFilePath)) {
        await fs.promises.copyFile(targetFilePath, backupPath);
        backupCreated = true;
      }
      await adapter.writeMcpServer(mcp, {
        scope: plan.targetScope,
        projectRoot: plan.projectRoot,
      });
    } catch (writeErr: unknown) {
      const msg = writeErr instanceof Error ? writeErr.message : String(writeErr);
      if (backupCreated) {
        try {
          await fs.promises.copyFile(backupPath, targetFilePath);
          await fs.promises.unlink(backupPath);
          return { status: 'rolled-back', reason: `MCP write failed and restored from backup: ${msg}` };
        } catch {
          return {
            status: 'manual-recovery-required',
            reason: `MCP write failed and backup restore failed: ${msg}`,
            paths: [targetFilePath, backupPath],
          };
        }
      }
      return { status: 'refused', reason: `MCP write failed: ${msg}` };
    }

    // Final verification
    try {
      const verified = await adapter.readMcpServer(mcp.id, {
        scope: plan.targetScope,
        projectRoot: plan.projectRoot,
      });
      const vHash = verified ? canonicalMcpServerHash(verified) : '';
      if (!verified || vHash !== prepared.contentHash) {
        console.error('MCP MISMATCH DETAIL:', {
          vHash,
          pHash: prepared.contentHash,
          verified,
          prepared: prepared.content,
        });
        throw new Error(`Final MCP server verification hash mismatch: verifiedHash=${vHash} vs preparedHash=${prepared.contentHash}`);
      }
    } catch (verifyErr: unknown) {
      const msg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
      if (backupCreated) {
        try {
          await fs.promises.copyFile(backupPath, targetFilePath);
          await fs.promises.unlink(backupPath);
          return { status: 'rolled-back', reason: `Final MCP verification failed and restored: ${msg}` };
        } catch {
          return {
            status: 'manual-recovery-required',
            reason: `Final MCP verification failed and restore failed: ${msg}`,
            paths: [targetFilePath, backupPath],
          };
        }
      }
      return { status: 'rolled-back', reason: `Final MCP verification failed: ${msg}` };
    }

    // State persistence
    const installation: ManagedInstallation = {
      assistant: plan.targetAssistant,
      scope: plan.targetScope,
      projectPath: plan.projectRoot,
      kind: 'mcp-server',
      name: mcp.id,
      path: targetFilePath,
      sourceId: plan.sourceId,
      packageId: plan.packageId,
      artifactId: plan.artifactId,
      sourceRevision: plan.sourceRevision,
      installedAt: new Date().toISOString(),
      contentHash: prepared.contentHash,
    };

    try {
      const state = await readState(plan.targetScope, plan.projectRoot, homeRoot);
      const filtered = state.installations.filter(
        (inst) =>
          !(
            inst.assistant === plan.targetAssistant &&
            inst.scope === plan.targetScope &&
            inst.projectPath === plan.projectRoot &&
            inst.path === targetFilePath &&
            inst.name === mcp.id
          )
      );
      filtered.push(installation);

      await writeState(
        plan.targetScope,
        {
          schemaVersion: state.schemaVersion,
          installations: filtered,
        },
        plan.projectRoot,
        homeRoot
      );
    } catch (stateErr: unknown) {
      const msg = stateErr instanceof Error ? stateErr.message : String(stateErr);
      if (backupCreated) {
        try {
          await fs.promises.copyFile(backupPath, targetFilePath);
          await fs.promises.unlink(backupPath);
          return { status: 'rolled-back', reason: `State persistence failed and restored config: ${msg}` };
        } catch {
          return {
            status: 'manual-recovery-required',
            reason: `State persistence failed and rollback failed: ${msg}`,
            paths: [targetFilePath, backupPath],
          };
        }
      }
      return { status: 'rolled-back', reason: `State persistence failed: ${msg}` };
    }

    // Cleanup backup
    if (backupCreated) {
      try {
        await fs.promises.unlink(backupPath);
      } catch {
        // ignore
      }
    }

    return {
      status: 'applied',
      installation,
    };
  }

  // --- COMMAND KIND APPLY ---
  if (prepared.kind === 'command') {
    const cmd = prepared.content;
    const recomputedHash = canonicalCommandHash(cmd);
    if (recomputedHash !== prepared.contentHash) {
      return {
        status: 'refused',
        reason: 'Command content was mutated after preview (hash mismatch)',
      };
    }

    const targetFilePath = plan.targetDir;
    let targetExists = false;

    try {
      const stat = await fs.promises.lstat(targetFilePath);
      targetExists = true;
      if (stat.isSymbolicLink() || stat.isDirectory()) {
        return {
          status: 'refused',
          reason: `Target command path "${targetFilePath}" is a directory or symlink and will not be overwritten`,
        };
      }
      const data = await fs.promises.readFile(targetFilePath);
      const currentHash = sha256(data);
      if (plan.existingFiles.length === 0 || plan.existingFiles[0].contentHash !== currentHash) {
        return {
          status: 'refused',
          reason: 'Target command file changed after preview was computed',
        };
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        if (plan.existingFiles.length > 0) {
          return {
            status: 'refused',
            reason: 'Target command file was deleted after preview was computed',
          };
        }
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          status: 'refused',
          reason: `Failed to inspect target command file: ${msg}`,
        };
      }
    }

    const randomId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const stagingPath = `${targetFilePath}.staging-${randomId}`;
    const backupPath = `${targetFilePath}.backup-${randomId}`;

    const serialized =
      plan.targetAssistant === 'kilo-code'
        ? serializeKiloCommandMarkdown(cmd)
        : serializeClaudeCommandMarkdown(cmd);

    try {
      await fs.promises.mkdir(path.dirname(stagingPath), { recursive: true });
      await fs.promises.writeFile(stagingPath, serialized, 'utf-8');
      const readBack = await fs.promises.readFile(stagingPath, 'utf-8');
      const parsedStaged =
        plan.targetAssistant === 'kilo-code'
          ? parseKiloCommandMarkdown(readBack, cmd.name)
          : parseClaudeCommandMarkdown(readBack, cmd.name);
      if (canonicalCommandHash(parsedStaged) !== prepared.contentHash) {
        throw new Error('Staging command verification hash mismatch');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        if (fs.existsSync(stagingPath)) {
          await fs.promises.unlink(stagingPath);
        }
        return { status: 'refused', reason: `Staging failed: ${msg}` };
      } catch {
        return {
          status: 'manual-recovery-required',
          reason: `Staging failed and cleanup failed: ${msg}`,
          paths: [stagingPath],
        };
      }
    }

    let backupCreated = false;
    try {
      if (targetExists) {
        await fs.promises.rename(targetFilePath, backupPath);
        backupCreated = true;
      }
      await fs.promises.rename(stagingPath, targetFilePath);
    } catch (swapErr: unknown) {
      const msg = swapErr instanceof Error ? swapErr.message : String(swapErr);
      if (backupCreated) {
        try {
          if (fs.existsSync(targetFilePath)) {
            await fs.promises.unlink(targetFilePath);
          }
          await fs.promises.rename(backupPath, targetFilePath);
          if (fs.existsSync(stagingPath)) {
            await fs.promises.unlink(stagingPath);
          }
          return {
            status: 'rolled-back',
            reason: `Command swap failed and restored from backup: ${msg}`,
          };
        } catch {
          return {
            status: 'manual-recovery-required',
            reason: `Command swap failed and backup restoration failed: ${msg}`,
            paths: [targetFilePath, backupPath, stagingPath].filter((p) => fs.existsSync(p)),
          };
        }
      } else {
        try {
          if (fs.existsSync(stagingPath)) {
            await fs.promises.unlink(stagingPath);
          }
          return { status: 'refused', reason: `Swap failed: ${msg}` };
        } catch {
          return {
            status: 'manual-recovery-required',
            reason: `Swap failed and staging cleanup failed: ${msg}`,
            paths: [stagingPath],
          };
        }
      }
    }

    // Final verification
    try {
      const finalContent = await fs.promises.readFile(targetFilePath, 'utf-8');
      const finalCmd =
        plan.targetAssistant === 'claude-code'
          ? parseClaudeCommandMarkdown(finalContent, cmd.name)
          : parseKiloCommandMarkdown(finalContent, cmd.name);
      if (canonicalCommandHash(finalCmd) !== prepared.contentHash) {
        throw new Error('Final target command verification hash mismatch');
      }
    } catch (verifyErr: unknown) {
      const msg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
      try {
        if (fs.existsSync(targetFilePath)) {
          await fs.promises.unlink(targetFilePath);
        }
        if (backupCreated) {
          await fs.promises.rename(backupPath, targetFilePath);
        }
        return {
          status: 'rolled-back',
          reason: `Final command verification failed and rolled back: ${msg}`,
        };
      } catch {
        return {
          status: 'manual-recovery-required',
          reason: `Final command verification failed and rollback failed: ${msg}`,
          paths: [targetFilePath, backupPath].filter((p) => fs.existsSync(p)),
        };
      }
    }

    // State persistence
    const installation: ManagedInstallation = {
      assistant: plan.targetAssistant,
      scope: plan.targetScope,
      projectPath: plan.projectRoot,
      kind: 'command',
      name: cmd.name,
      path: targetFilePath,
      sourceId: plan.sourceId,
      packageId: plan.packageId,
      artifactId: plan.artifactId,
      sourceRevision: plan.sourceRevision,
      installedAt: new Date().toISOString(),
      contentHash: prepared.contentHash,
    };

    try {
      const state = await readState(plan.targetScope, plan.projectRoot, homeRoot);
      const filtered = state.installations.filter(
        (inst) =>
          !(
            inst.assistant === plan.targetAssistant &&
            inst.scope === plan.targetScope &&
            inst.projectPath === plan.projectRoot &&
            inst.path === targetFilePath &&
            inst.name === cmd.name
          )
      );
      filtered.push(installation);

      await writeState(
        plan.targetScope,
        {
          schemaVersion: state.schemaVersion,
          installations: filtered,
        },
        plan.projectRoot,
        homeRoot
      );
    } catch (stateErr: unknown) {
      const msg = stateErr instanceof Error ? stateErr.message : String(stateErr);
      try {
        if (fs.existsSync(targetFilePath)) {
          await fs.promises.unlink(targetFilePath);
        }
        if (backupCreated) {
          await fs.promises.rename(backupPath, targetFilePath);
        }
        return {
          status: 'rolled-back',
          reason: `State persistence failed and rolled back command file: ${msg}`,
        };
      } catch {
        return {
          status: 'manual-recovery-required',
          reason: `State persistence failed and rollback failed: ${msg}`,
          paths: [targetFilePath, backupPath].filter((p) => fs.existsSync(p)),
        };
      }
    }

    // Cleanup backup
    if (backupCreated) {
      try {
        await fs.promises.unlink(backupPath);
      } catch {
        // ignore
      }
    }

    return {
      status: 'applied',
      installation,
    };
  }

  // --- AGENT KIND APPLY ---
  if (prepared.kind === 'agent') {
    const agent = prepared.content;
    const recomputedHash = canonicalAgentHash(agent);
    if (recomputedHash !== prepared.contentHash) {
      return {
        status: 'refused',
        reason: 'Agent content was mutated after preview (hash mismatch)',
      };
    }

    const targetFilePath = plan.targetDir;
    let targetExists = false;

    try {
      const stat = await fs.promises.lstat(targetFilePath);
      targetExists = true;
      if (stat.isSymbolicLink() || stat.isDirectory()) {
        return {
          status: 'refused',
          reason: `Target agent path "${targetFilePath}" is a directory or symlink and will not be overwritten`,
        };
      }
      const data = await fs.promises.readFile(targetFilePath);
      const currentHash = sha256(data);
      if (plan.existingFiles.length === 0 || plan.existingFiles[0].contentHash !== currentHash) {
        return {
          status: 'refused',
          reason: 'Target agent file changed after preview was computed',
        };
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        if (plan.existingFiles.length > 0) {
          return {
            status: 'refused',
            reason: 'Target agent file was deleted after preview was computed',
          };
        }
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          status: 'refused',
          reason: `Failed to inspect target agent file: ${msg}`,
        };
      }
    }

    const randomId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const stagingPath = `${targetFilePath}.staging-${randomId}`;
    const backupPath = `${targetFilePath}.backup-${randomId}`;

    const serialized =
      plan.targetAssistant === 'kilo-code'
        ? serializeKiloAgentMarkdown(agent)
        : serializeClaudeAgentMarkdown(agent);

    try {
      await fs.promises.mkdir(path.dirname(stagingPath), { recursive: true });
      await fs.promises.writeFile(stagingPath, serialized, 'utf-8');
      const readBack = await fs.promises.readFile(stagingPath, 'utf-8');
      const parsedStaged =
        plan.targetAssistant === 'kilo-code'
          ? parseKiloAgentMarkdown(readBack)
          : parseClaudeAgentMarkdown(readBack);
      if (canonicalAgentHash(parsedStaged) !== prepared.contentHash) {
        throw new Error('Staging agent verification hash mismatch');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        if (fs.existsSync(stagingPath)) {
          await fs.promises.unlink(stagingPath);
        }
        return { status: 'refused', reason: `Staging failed: ${msg}` };
      } catch {
        return {
          status: 'manual-recovery-required',
          reason: `Staging failed and cleanup failed: ${msg}`,
          paths: [stagingPath],
        };
      }
    }

    let backupCreated = false;
    try {
      if (targetExists) {
        await fs.promises.rename(targetFilePath, backupPath);
        backupCreated = true;
      }
      await fs.promises.rename(stagingPath, targetFilePath);
    } catch (swapErr: unknown) {
      const msg = swapErr instanceof Error ? swapErr.message : String(swapErr);
      if (backupCreated) {
        try {
          if (fs.existsSync(targetFilePath)) {
            await fs.promises.unlink(targetFilePath);
          }
          await fs.promises.rename(backupPath, targetFilePath);
          if (fs.existsSync(stagingPath)) {
            await fs.promises.unlink(stagingPath);
          }
          return {
            status: 'rolled-back',
            reason: `Agent swap failed and restored from backup: ${msg}`,
          };
        } catch {
          return {
            status: 'manual-recovery-required',
            reason: `Agent swap failed and backup restoration failed: ${msg}`,
            paths: [targetFilePath, backupPath, stagingPath].filter((p) => fs.existsSync(p)),
          };
        }
      } else {
        try {
          if (fs.existsSync(stagingPath)) {
            await fs.promises.unlink(stagingPath);
          }
          return { status: 'refused', reason: `Swap failed: ${msg}` };
        } catch {
          return {
            status: 'manual-recovery-required',
            reason: `Swap failed and staging cleanup failed: ${msg}`,
            paths: [stagingPath],
          };
        }
      }
    }

    // Final verification
    try {
      const finalContent = await fs.promises.readFile(targetFilePath, 'utf-8');
      const finalAgent =
        plan.targetAssistant === 'claude-code'
          ? parseClaudeAgentMarkdown(finalContent)
          : parseKiloAgentMarkdown(finalContent);
      if (canonicalAgentHash(finalAgent) !== prepared.contentHash) {
        throw new Error('Final target agent verification hash mismatch');
      }
    } catch (verifyErr: unknown) {
      const msg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
      try {
        if (fs.existsSync(targetFilePath)) {
          await fs.promises.unlink(targetFilePath);
        }
        if (backupCreated) {
          await fs.promises.rename(backupPath, targetFilePath);
        }
        return {
          status: 'rolled-back',
          reason: `Final agent verification failed and rolled back: ${msg}`,
        };
      } catch {
        return {
          status: 'manual-recovery-required',
          reason: `Final agent verification failed and rollback failed: ${msg}`,
          paths: [targetFilePath, backupPath].filter((p) => fs.existsSync(p)),
        };
      }
    }

    // State persistence
    const installation: ManagedInstallation = {
      assistant: plan.targetAssistant,
      scope: plan.targetScope,
      projectPath: plan.projectRoot,
      kind: 'agent',
      name: agent.name,
      path: targetFilePath,
      sourceId: plan.sourceId,
      packageId: plan.packageId,
      artifactId: plan.artifactId,
      sourceRevision: plan.sourceRevision,
      installedAt: new Date().toISOString(),
      contentHash: prepared.contentHash,
    };

    try {
      const state = await readState(plan.targetScope, plan.projectRoot, homeRoot);
      const filtered = state.installations.filter(
        (inst) =>
          !(
            inst.assistant === plan.targetAssistant &&
            inst.scope === plan.targetScope &&
            inst.projectPath === plan.projectRoot &&
            inst.path === targetFilePath &&
            inst.name === agent.name
          )
      );
      filtered.push(installation);

      await writeState(
        plan.targetScope,
        {
          schemaVersion: state.schemaVersion,
          installations: filtered,
        },
        plan.projectRoot,
        homeRoot
      );
    } catch (stateErr: unknown) {
      const msg = stateErr instanceof Error ? stateErr.message : String(stateErr);
      try {
        if (fs.existsSync(targetFilePath)) {
          await fs.promises.unlink(targetFilePath);
        }
        if (backupCreated) {
          await fs.promises.rename(backupPath, targetFilePath);
        }
        return {
          status: 'rolled-back',
          reason: `State persistence failed and rolled back agent file: ${msg}`,
        };
      } catch {
        return {
          status: 'manual-recovery-required',
          reason: `State persistence failed and rollback failed: ${msg}`,
          paths: [targetFilePath, backupPath].filter((p) => fs.existsSync(p)),
        };
      }
    }

    // Cleanup backup
    if (backupCreated) {
      try {
        await fs.promises.unlink(backupPath);
      } catch {
        // ignore
      }
    }

    return {
      status: 'applied',
      installation,
    };
  }

  // --- SKILL KIND APPLY ---
  const content = prepared.content;

  const recomputedHash = canonicalSkillHash(content);
  if (recomputedHash !== prepared.contentHash) {
    return {
      status: 'refused',
      reason: 'Content was mutated after preview (hash mismatch)',
    };
  }

  const proposedPaths = new Set(plan.proposedFiles.map((p) => p.path));
  const uncovered = plan.existingFiles.filter((e) => !proposedPaths.has(e.path));
  if (uncovered.length > 0) {
    return {
      status: 'refused',
      reason: 'Target contains existing files not covered by the installation payload',
    };
  }

  const targetDir = plan.targetDir;
  let targetExists = false;

  try {
    const targetStat = await fs.promises.lstat(targetDir);
    targetExists = true;

    if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
      return {
        status: 'refused',
        reason: `Target path "${targetDir}" is a ${targetStat.isSymbolicLink() ? 'symlink' : 'non-directory file'} and will not be followed or modified`,
      };
    }

    const currentFiles: Array<{ path: string; contentHash: string }> = [];
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
            currentFiles.push({
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
        status: 'refused',
        reason: `Target directory "${targetDir}" contains symlinks or unreadable files`,
      };
    }

    if (currentFiles.length !== plan.existingFiles.length) {
      return {
        status: 'refused',
        reason: 'Target directory contents changed after preview (file count mismatch)',
      };
    }

    const existingMap = new Map(plan.existingFiles.map((e) => [e.path, e.contentHash]));
    for (const cur of currentFiles) {
      if (existingMap.get(cur.path) !== cur.contentHash) {
        return {
          status: 'refused',
          reason: `Target file "${cur.path}" changed or appeared after preview`,
        };
      }
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      if (plan.existingFiles.length > 0) {
        return {
          status: 'refused',
          reason: 'Target directory was deleted after preview was computed',
        };
      }
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: 'refused',
        reason: `Failed to inspect target directory: ${msg}`,
      };
    }
  }

  const randomId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const stagingDir = `${targetDir}.staging-${randomId}`;
  const backupDir = `${targetDir}.backup-${randomId}`;

  try {
    await writeSkill(content, stagingDir);
    const stagedSkill = await readSkill(stagingDir);
    const stagedHash = canonicalSkillHash(stagedSkill);

    if (stagedHash !== prepared.contentHash) {
      throw new Error('Staging verification hash mismatch');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      if (fs.existsSync(stagingDir)) {
        await fs.promises.rm(stagingDir, { recursive: true, force: true });
      }
      return {
        status: 'refused',
        reason: `Staging failed: ${msg}`,
      };
    } catch {
      return {
        status: 'manual-recovery-required',
        reason: `Staging failed and cleanup failed: ${msg}`,
        paths: [stagingDir],
      };
    }
  }

  let backupCreated = false;
  try {
    if (targetExists) {
      await fs.promises.rename(targetDir, backupDir);
      backupCreated = true;
    }
    await fs.promises.rename(stagingDir, targetDir);
  } catch (swapErr: unknown) {
    const msg = swapErr instanceof Error ? swapErr.message : String(swapErr);

    if (backupCreated) {
      try {
        if (fs.existsSync(targetDir)) {
          await fs.promises.rm(targetDir, { recursive: true, force: true });
        }
        await fs.promises.rename(backupDir, targetDir);
        if (fs.existsSync(stagingDir)) {
          await fs.promises.rm(stagingDir, { recursive: true, force: true });
        }
        return {
          status: 'rolled-back',
          reason: `Swap failed and restored from backup: ${msg}`,
        };
      } catch {
        return {
          status: 'manual-recovery-required',
          reason: `Swap failed and backup restoration failed: ${msg}`,
          paths: [targetDir, backupDir, stagingDir].filter((p) => fs.existsSync(p)),
        };
      }
    } else {
      try {
        if (fs.existsSync(stagingDir)) {
          await fs.promises.rm(stagingDir, { recursive: true, force: true });
        }
        return {
          status: 'refused',
          reason: `Swap failed: ${msg}`,
        };
      } catch {
        return {
          status: 'manual-recovery-required',
          reason: `Swap failed and staging cleanup failed: ${msg}`,
          paths: [stagingDir],
        };
      }
    }
  }

  // Final verification
  try {
    const finalSkill = await readSkill(targetDir);
    const finalHash = canonicalSkillHash(finalSkill);

    if (finalHash !== prepared.contentHash) {
      throw new Error('Final target verification hash mismatch');
    }
  } catch (verifyErr: unknown) {
    const msg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);

    try {
      if (fs.existsSync(targetDir)) {
        await fs.promises.rm(targetDir, { recursive: true, force: true });
      }
      if (backupCreated) {
        await fs.promises.rename(backupDir, targetDir);
      }
      return {
        status: 'rolled-back',
        reason: `Final verification failed and rolled back: ${msg}`,
      };
    } catch {
      return {
        status: 'manual-recovery-required',
        reason: `Final verification failed and rollback failed: ${msg}`,
        paths: [targetDir, backupDir].filter((p) => fs.existsSync(p)),
      };
    }
  }

  // State persistence
  const installation: ManagedInstallation = {
    assistant: plan.targetAssistant,
    scope: plan.targetScope,
    projectPath: plan.projectRoot,
    kind: 'skill',
    name: content.name,
    path: plan.targetDir,
    sourceId: plan.sourceId,
    packageId: plan.packageId,
    artifactId: plan.artifactId,
    sourceRevision: plan.sourceRevision,
    installedAt: new Date().toISOString(),
    contentHash: prepared.contentHash,
  };

  try {
    const state = await readState(plan.targetScope, plan.projectRoot, homeRoot);
    const filteredInstallations = state.installations.filter(
      (inst) =>
        !(
          inst.assistant === plan.targetAssistant &&
          inst.scope === plan.targetScope &&
          inst.projectPath === plan.projectRoot &&
          inst.path === plan.targetDir &&
          inst.name === content.name
        )
    );
    filteredInstallations.push(installation);

    await writeState(
      plan.targetScope,
      {
        schemaVersion: state.schemaVersion,
        installations: filteredInstallations,
      },
      plan.projectRoot,
      homeRoot
    );
  } catch (stateErr: unknown) {
    const msg = stateErr instanceof Error ? stateErr.message : String(stateErr);

    try {
      if (fs.existsSync(targetDir)) {
        await fs.promises.rm(targetDir, { recursive: true, force: true });
      }
      if (backupCreated) {
        await fs.promises.rename(backupDir, targetDir);
      }
      return {
        status: 'rolled-back',
        reason: `State persistence failed and rolled back filesystem: ${msg}`,
      };
    } catch {
      return {
        status: 'manual-recovery-required',
        reason: `State persistence failed and rollback failed: ${msg}`,
        paths: [targetDir, backupDir].filter((p) => fs.existsSync(p)),
      };
    }
  }

  const warnings: string[] = [];
  if (backupCreated) {
    try {
      await fs.promises.rm(backupDir, { recursive: true, force: true });
    } catch {
      warnings.push(`Failed to clean up backup directory at ${backupDir}`);
    }
  }

  return {
    status: 'applied',
    installation,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
