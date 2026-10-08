import * as fs from 'fs';
import * as path from 'path';
import type { ManagedInstallation } from '../domain/types';
import { getAdapter, getAdapterWithHomeRoot } from '../adapters/registry';
import { readState, writeState } from '../domain/registry';
import { withStateLock } from '../domain/stateLock';

export interface DisableOptions {
  homeRoot?: string;
  _injectStateWriteError?: Error;
}

export interface DisablePlanReady {
  status: 'ready';
  installation: ManagedInstallation;
  sourcePath: string;
  targetPath: string;
  homeRoot?: string;
}

export interface DisablePlanConflict {
  status: 'conflict';
  existingPath: string;
  installation: ManagedInstallation;
}

export interface DisablePlanUnsupported {
  status: 'unsupported';
  reason: string;
  installation: ManagedInstallation;
}

export type DisablePlan = DisablePlanReady | DisablePlanConflict | DisablePlanUnsupported;

export type DisableOutcome =
  | { status: 'applied'; installation: ManagedInstallation }
  | { status: 'conflict'; existingPath: string }
  | { status: 'unsupported'; reason: string };

function isSameInstallation(a: ManagedInstallation, b: ManagedInstallation): boolean {
  return (
    a.assistant === b.assistant &&
    a.scope === b.scope &&
    a.kind === b.kind &&
    a.name === b.name &&
    (a.projectPath ?? '') === (b.projectPath ?? '')
  );
}

async function copyDirectory(src: string, dest: string): Promise<void> {
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}

export async function movePath(source: string, destination: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });

  try {
    await fs.promises.rename(source, destination);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EXDEV') {
      const stat = await fs.promises.stat(source);
      if (stat.isDirectory()) {
        await copyDirectory(source, destination);
        await fs.promises.rm(source, { recursive: true, force: true });
      } else {
        await fs.promises.copyFile(source, destination);
        await fs.promises.unlink(source);
      }
    } else {
      throw err;
    }
  }
}

/**
 * Plans disabling a managed installation.
 * Verifies kind and adapter support, checks for conflicts at the disabled destination,
 * and produces a DisablePlan.
 */
export async function planDisable(
  inst: ManagedInstallation,
  options?: DisableOptions
): Promise<DisablePlan> {
  const homeRoot = options?.homeRoot;

  // 1. Kind support: only skill, agent, command
  if (inst.kind !== 'skill' && inst.kind !== 'agent' && inst.kind !== 'command') {
    return {
      status: 'unsupported',
      reason: `Disable is unsupported for kind "${inst.kind}". Only skills, agents, and commands are supported.`,
      installation: inst,
    };
  }

  // 2. Adapter support
  const adapter = homeRoot
    ? getAdapterWithHomeRoot(inst.assistant, homeRoot)
    : getAdapter(inst.assistant);

  if (adapter.disableSupport === 'unsupported') {
    return {
      status: 'unsupported',
      reason: `Disable is unsupported for assistant "${inst.assistant}".`,
      installation: inst,
    };
  }

  // 3. Compute disabled destination path
  const loc = {
    scope: inst.scope,
    projectRoot: inst.projectPath,
  };

  const disabledPath = adapter.getDisabledPath(inst.kind, inst.name, loc);
  if (!disabledPath) {
    return {
      status: 'unsupported',
      reason: `No disabled path returned by adapter for ${inst.kind} "${inst.name}".`,
      installation: inst,
    };
  }

  // 4. Check if source exists on disk
  if (!fs.existsSync(inst.path)) {
    return {
      status: 'unsupported',
      reason: `Source file or directory does not exist at ${inst.path}.`,
      installation: inst,
    };
  }

  // 5. Check if target disabled path already exists (conflict)
  if (fs.existsSync(disabledPath)) {
    return {
      status: 'conflict',
      existingPath: disabledPath,
      installation: inst,
    };
  }

  return {
    status: 'ready',
    installation: inst,
    sourcePath: inst.path,
    targetPath: disabledPath,
    homeRoot,
  };
}

/**
 * Applies a disable plan (or plans and disables an installation).
 * Performs a single move (with EXDEV copy+delete fallback), updates state.json under withStateLock,
 * and rolls back the move if state persistence fails.
 */
export async function applyDisable(
  planOrInst: DisablePlan | ManagedInstallation,
  options?: DisableOptions
): Promise<DisableOutcome> {
  let plan: DisablePlan;
  if ('status' in planOrInst) {
    plan = planOrInst;
  } else {
    plan = await planDisable(planOrInst, options);
  }

  if (plan.status === 'unsupported') {
    return { status: 'unsupported', reason: plan.reason };
  }

  if (plan.status === 'conflict') {
    return { status: 'conflict', existingPath: plan.existingPath };
  }

  const homeRoot = plan.homeRoot ?? options?.homeRoot;
  const inst = plan.installation;

  return await withStateLock(inst.scope, inst.projectPath, homeRoot, async () => {
    // Re-check inside state lock
    if (fs.existsSync(plan.targetPath)) {
      return { status: 'conflict', existingPath: plan.targetPath };
    }
    if (!fs.existsSync(plan.sourcePath)) {
      return {
        status: 'unsupported',
        reason: `Source file or directory does not exist at ${plan.sourcePath}.`,
      };
    }

    // 1. Move to disabled destination
    await movePath(plan.sourcePath, plan.targetPath);

    // 2. State persistence with rollback
    try {
      const state = await readState(inst.scope, inst.projectPath, homeRoot);
      const resultingInst: ManagedInstallation = {
        ...inst,
        path: plan.targetPath,
        disabled: true,
      };

      let updated = false;
      const updatedInstallations = state.installations.map((item) => {
        if (isSameInstallation(item, inst)) {
          updated = true;
          return {
            ...item,
            path: plan.targetPath,
            disabled: true,
          };
        }
        return item;
      });

      if (!updated) {
        updatedInstallations.push(resultingInst);
      }

      if (options?._injectStateWriteError) {
        throw options._injectStateWriteError;
      }

      await writeState(
        inst.scope,
        {
          schemaVersion: state.schemaVersion,
          installations: updatedInstallations,
        },
        inst.projectPath,
        homeRoot
      );

      return {
        status: 'applied',
        installation: resultingInst,
      };
    } catch (stateErr) {
      try {
        await movePath(plan.targetPath, plan.sourcePath);
      } catch {
        // Rollback move error swallowed to preserve the primary error
      }
      throw stateErr;
    }
  });
}

/**
 * Enables a disabled managed installation.
 * Restores the item to its exact original path, clears the disabled flag in state.json,
 * and never overwrites an existing item at the target path.
 */
export async function applyEnable(
  inst: ManagedInstallation,
  options?: DisableOptions
): Promise<DisableOutcome> {
  const homeRoot = options?.homeRoot;

  // 1. Unsupported kinds
  if (inst.kind !== 'skill' && inst.kind !== 'agent' && inst.kind !== 'command') {
    return {
      status: 'unsupported',
      reason: `Enable is unsupported for kind "${inst.kind}". Only skills, agents, and commands are supported.`,
    };
  }

  // 2. Unsupported adapter
  const adapter = homeRoot
    ? getAdapterWithHomeRoot(inst.assistant, homeRoot)
    : getAdapter(inst.assistant);

  if (adapter.disableSupport === 'unsupported') {
    return {
      status: 'unsupported',
      reason: `Enable is unsupported for assistant "${inst.assistant}".`,
    };
  }

  // 3. Compute exact original active path
  const loc = {
    scope: inst.scope,
    projectRoot: inst.projectPath,
  };
  let activePath: string;
  if (inst.kind === 'skill') {
    activePath = adapter.skillDir(inst.name, loc);
  } else if (inst.kind === 'agent') {
    activePath = adapter.agentPath(inst.name, loc);
  } else if (inst.kind === 'command') {
    activePath = adapter.commandPath(inst.name, loc);
  } else {
    return {
      status: 'unsupported',
      reason: `Enable is unsupported for kind "${inst.kind}".`,
    };
  }

  const sourcePath = inst.path;

  // 4. Never overwrite: if target active path already exists
  if (activePath !== sourcePath && fs.existsSync(activePath)) {
    return {
      status: 'conflict',
      existingPath: activePath,
    };
  }

  if (!fs.existsSync(sourcePath)) {
    return {
      status: 'unsupported',
      reason: `Disabled file or directory does not exist at ${sourcePath}.`,
    };
  }

  // If already at activePath and not disabled, nothing to do
  if (activePath === sourcePath && !inst.disabled) {
    return {
      status: 'applied',
      installation: inst,
    };
  }

  return await withStateLock(inst.scope, inst.projectPath, homeRoot, async () => {
    // Re-check conflict inside lock
    if (activePath !== sourcePath && fs.existsSync(activePath)) {
      return {
        status: 'conflict',
        existingPath: activePath,
      };
    }
    if (!fs.existsSync(sourcePath)) {
      return {
        status: 'unsupported',
        reason: `Disabled file or directory does not exist at ${sourcePath}.`,
      };
    }

    // 1. Move back to original active path
    await movePath(sourcePath, activePath);

    // 2. State persistence with rollback
    try {
      const state = await readState(inst.scope, inst.projectPath, homeRoot);
      const resultingInst: ManagedInstallation = {
        ...inst,
        path: activePath,
      };
      delete resultingInst.disabled;

      let updated = false;
      const updatedInstallations = state.installations.map((item) => {
        if (isSameInstallation(item, inst)) {
          updated = true;
          const copy = { ...item, path: activePath };
          delete copy.disabled;
          return copy;
        }
        return item;
      });

      if (!updated) {
        updatedInstallations.push(resultingInst);
      }

      if (options?._injectStateWriteError) {
        throw options._injectStateWriteError;
      }

      await writeState(
        inst.scope,
        {
          schemaVersion: state.schemaVersion,
          installations: updatedInstallations,
        },
        inst.projectPath,
        homeRoot
      );

      return {
        status: 'applied',
        installation: resultingInst,
      };
    } catch (stateErr) {
      try {
        await movePath(activePath, sourcePath);
      } catch {
        // Rollback move error swallowed to preserve the primary error
      }
      throw stateErr;
    }
  });
}
