import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { ManagedInstallation } from '../domain/types';
import {
  canonicalSkillHash,
  canonicalAgentHash,
  readSkill,
  writeSkill,
} from '../adapters/codec';
import {
  serializeClaudeAgentMarkdown,
  parseClaudeAgentMarkdown,
} from '../adapters/claude';
import {
  serializeKiloAgentMarkdown,
  parseKiloAgentMarkdown,
} from '../adapters/kilo';
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
      plan.targetAssistant === 'claude-code'
        ? serializeClaudeAgentMarkdown(agent)
        : serializeKiloAgentMarkdown(agent);

    try {
      await fs.promises.mkdir(path.dirname(stagingPath), { recursive: true });
      await fs.promises.writeFile(stagingPath, serialized, 'utf-8');
      const readBack = await fs.promises.readFile(stagingPath, 'utf-8');
      const parsedStaged =
        plan.targetAssistant === 'claude-code'
          ? parseClaudeAgentMarkdown(readBack)
          : parseKiloAgentMarkdown(readBack);
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

  // Check contentHash hasn't mutated
  const recomputedHash = canonicalSkillHash(content);
  if (recomputedHash !== prepared.contentHash) {
    return {
      status: 'refused',
      reason: 'Content was mutated after preview (hash mismatch)',
    };
  }

  // Check uncovered files
  const proposedPaths = new Set(plan.proposedFiles.map((p) => p.path));
  const uncovered = plan.existingFiles.filter((e) => !proposedPaths.has(e.path));
  if (uncovered.length > 0) {
    return {
      status: 'refused',
      reason: 'Target contains existing files not covered by the installation payload',
    };
  }

  // Re-inspect targetDir
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

  // Staging
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

  // Transactional swap
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
        reason: `State persistence failed and filesystem rollback failed: ${msg}`,
        paths: [targetDir, backupDir].filter((p) => fs.existsSync(p)),
      };
    }
  }

  // Backup cleanup
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
