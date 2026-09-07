import type { ManagedInstallation, Source } from '../domain/types';
import {
  type DesiredInstallation,
  type ManifestFile,
  type StateFile,
  readManifest,
  readState,
  fromDesiredSource,
} from '../domain/registry';
import { checkForUpstreamUpdate } from './drift';

export interface PendingCounts {
  unsatisfiedRecommendations: number;
  updatesAvailable: number;
  total: number;
}

export function countUnsatisfiedRecommendations(
  desired: DesiredInstallation[],
  installed: ManagedInstallation[]
): number {
  let count = 0;
  for (const d of desired) {
    const isInstalled = installed.some(
      (inst) => inst.sourceId === d.sourceId && inst.artifactId === d.artifactId && inst.assistant === d.assistant
    );
    if (!isInstalled) {
      count++;
    }
  }
  return count;
}

export async function computePendingCounts(
  projectRoot?: string,
  homeRoot?: string
): Promise<PendingCounts> {
  let unsatisfiedRecommendations = 0;
  let pManifest: ManifestFile | undefined;
  let pState: StateFile | undefined;

  if (projectRoot) {
    try {
      pManifest = await readManifest('project', projectRoot, homeRoot);
      pState = await readState('project', projectRoot, homeRoot);
      unsatisfiedRecommendations = countUnsatisfiedRecommendations(
        pManifest.desiredInstallations,
        pState.installations
      );
    } catch {
      // ignore read failures
    }
  }

  const allInstallations: ManagedInstallation[] = [];
  const allSources: Source[] = [];

  try {
    const gState = await readState('global', undefined, homeRoot);
    allInstallations.push(...gState.installations);
    const gManifest = await readManifest('global', undefined, homeRoot);
    allSources.push(...gManifest.sources.map((d) => fromDesiredSource(d, undefined, homeRoot)));
  } catch {
    // ignore
  }

  if (projectRoot) {
    try {
      const pStateLoaded = pState ?? (await readState('project', projectRoot, homeRoot));
      allInstallations.push(...pStateLoaded.installations);
      const pManifestLoaded = pManifest ?? (await readManifest('project', projectRoot, homeRoot));
      allSources.push(...pManifestLoaded.sources.map((d) => fromDesiredSource(d, projectRoot, homeRoot)));
    } catch {
      // ignore
    }
  }

  let updatesAvailable = 0;
  for (const inst of allInstallations) {
    const matchingSource = allSources.find((s) => s.id === inst.sourceId);
    if (matchingSource) {
      try {
        const report = await checkForUpstreamUpdate(inst, matchingSource, homeRoot);
        if (report.status === 'update-available' || report.status === 'modified-and-update-available') {
          updatesAvailable++;
        }
      } catch {
        // ignore
      }
    }
  }

  return {
    unsatisfiedRecommendations,
    updatesAvailable,
    total: unsatisfiedRecommendations + updatesAvailable,
  };
}

export function formatStatusBarLabel(counts: PendingCounts): string {
  if (counts.total === 0) {
    return '$(dashboard) AI Swissknife';
  }

  const parts: string[] = [];
  if (counts.updatesAvailable > 0) {
    parts.push(`${counts.updatesAvailable} ${counts.updatesAvailable === 1 ? 'update' : 'updates'}`);
  }
  if (counts.unsatisfiedRecommendations > 0) {
    parts.push(
      `${counts.unsatisfiedRecommendations} ${counts.unsatisfiedRecommendations === 1 ? 'recommendation' : 'recommendations'}`
    );
  }

  if (parts.length > 0) {
    return `$(dashboard) AI Swissknife: ${parts.join(', ')}`;
  }
  return '$(dashboard) AI Swissknife';
}

export function formatStatusBarTooltip(counts: PendingCounts): string {
  if (counts.total === 0) {
    return 'AI Swissknife: Open Dashboard';
  }

  const parts: string[] = [];
  if (counts.updatesAvailable > 0) {
    parts.push(`${counts.updatesAvailable} update(s) available`);
  }
  if (counts.unsatisfiedRecommendations > 0) {
    parts.push(`${counts.unsatisfiedRecommendations} unsatisfied recommendation(s)`);
  }

  return `AI Swissknife (${parts.join(', ')})\nClick to open Dashboard`;
}
