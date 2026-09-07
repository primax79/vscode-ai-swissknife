export * from './types';
export { planInstall } from './plan';
export { applyInstall } from './apply';
export { analyzeLocalDrift, checkForUpstreamUpdate } from './drift';
export { resolveRecommendations } from './recommendations';
export type { SourceResolutionAttempt, BrokenReason } from './recommendations';
export { scanInstalledInventory, promoteObservedArtifact } from './discovery';
export { planSync, type PlanSyncParams } from './sync';
export {
  findRelatedInstallations,
  type MatchStrategy,
  type RelatedInstallation,
} from './crossFrameworkLookup';
