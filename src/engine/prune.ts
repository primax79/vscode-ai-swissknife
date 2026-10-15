import * as fs from 'fs';
import type { Scope, ManagedInstallation } from '../domain/types';
import { readState, writeState } from '../domain/registry';
import { withStateLock } from '../domain/stateLock';

export interface PruneResult {
  scope: Scope;
  projectRoot?: string;
  pruned: ManagedInstallation[];
}

/**
 * Scans state.json for the given scope and removes any installation records
 * whose files or directories no longer exist on disk.
 */
export async function pruneMissingInstallations(
  scope: Scope,
  projectRoot?: string,
  homeRoot?: string
): Promise<PruneResult> {
  return await withStateLock(
    scope,
    projectRoot,
    homeRoot,
    async () => {
      const state = await readState(scope, projectRoot, homeRoot);
      const valid: ManagedInstallation[] = [];
      const pruned: ManagedInstallation[] = [];

      for (const inst of state.installations) {
        const exists = inst.path ? fs.existsSync(inst.path) : false;
        if (exists) {
          valid.push(inst);
        } else {
          pruned.push(inst);
        }
      }

      if (pruned.length > 0) {
        state.installations = valid;
        await writeState(scope, state, projectRoot, homeRoot);
      }

      return {
        scope,
        projectRoot,
        pruned,
      };
    }
  );
}
