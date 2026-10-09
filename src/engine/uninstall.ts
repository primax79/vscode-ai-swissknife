import * as fs from 'fs';
import type { ManagedInstallation } from '../domain/types';
import { getAdapter, getAdapterWithHomeRoot } from '../adapters/registry';
import { readState, writeState, withStateLock } from '../domain/registry';
import { softDeletePath } from './softDelete';

export type UninstallMode = 'soft' | 'hard';

export interface UninstallOptions {
  mode?: UninstallMode;
  homeRoot?: string;
  projectRoot?: string;
}

export interface UninstallResult {
  mode: UninstallMode;
  path: string;
  backupPath?: string;
}

/**
 * Uninstalls a managed installation:
 * - If mcp-server: removes from assistant configuration via the adapter.
 * - Otherwise:
 *   - If mode === 'soft': soft-deletes files to _deleted/ folder with .origin.json metadata.
 *   - If mode === 'hard': permanently deletes files via fs.promises.rm.
 * - In both modes: removes the installation record from state.json under withStateLock.
 */
export async function uninstallInstallation(
  inst: ManagedInstallation,
  options?: UninstallOptions
): Promise<UninstallResult> {
  const mode = options?.mode ?? 'soft';
  let backupPath: string | undefined;

  if (inst.kind === 'mcp-server') {
    const originAdapter = options?.homeRoot
      ? getAdapterWithHomeRoot(inst.assistant, options.homeRoot)
      : getAdapter(inst.assistant);
    await originAdapter.removeMcpServer(inst.name, {
      scope: inst.scope,
      projectRoot: inst.projectPath ?? options?.projectRoot,
    });
  } else {
    if (fs.existsSync(inst.path)) {
      if (mode === 'hard') {
        await fs.promises.rm(inst.path, { recursive: true, force: true });
      } else {
        backupPath = await softDeletePath(
          inst.path,
          inst.kind,
          inst.name,
          inst.scope,
          inst.projectPath ?? options?.projectRoot,
          options?.homeRoot,
          { assistant: inst.assistant }
        );
      }
    }
  }

  const effectiveProjectRoot = inst.projectPath ?? options?.projectRoot;
  await withStateLock(inst.scope, effectiveProjectRoot, options?.homeRoot, async () => {
    const state = await readState(inst.scope, effectiveProjectRoot, options?.homeRoot);
    state.installations = state.installations.filter(
      (i) => !(i.assistant === inst.assistant && i.kind === inst.kind && i.name === inst.name)
    );
    await writeState(inst.scope, state, effectiveProjectRoot, options?.homeRoot);
  });

  return {
    mode,
    path: inst.path,
    ...(backupPath ? { backupPath } : {}),
  };
}
