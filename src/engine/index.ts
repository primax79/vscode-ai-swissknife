export * from './types';
export { planInstall, resolveAndTranslate } from './plan';
export { applyInstall } from './apply';
export {
  analyzeLocalDrift,
  checkForUpstreamUpdate,
  checkDriftForAll,
  type SourceResolutionCache,
  type CheckForUpstreamUpdateOptions,
  type CheckForUpstreamUpdateOpts,
  type CheckDriftForAllOptions,
} from './drift';
export { resolveRecommendations } from './recommendations';
export type { SourceResolutionAttempt, BrokenReason } from './recommendations';
export { scanInstalledInventory, promoteObservedArtifact } from './discovery';
export { planSync, type PlanSyncParams } from './sync';
export {
  findRelatedInstallations,
  type MatchStrategy,
  type RelatedInstallation,
} from './crossFrameworkLookup';
export {
  computePendingCounts,
  countUnsatisfiedRecommendations,
  formatStatusBarLabel,
  formatStatusBarTooltip,
  type PendingCounts,
} from './pendingCounts';
export {
  buildScopeExport,
  buildSourceExport,
  parseExportedConfigFile,
  mergeScopeConfig,
  CONFIG_TRANSFER_SCHEMA_VERSION,
  type ScopeConfigPayload,
  type ExportedConfigFile,
  type MergeResult,
} from './configTransfer';
export {
  planInstallMatrix,
  applyInstallMatrix,
  type MatrixItem,
  type MatrixTarget,
  type MatrixSummary,
  type MatrixTargetOutcome,
  type PlanInstallMatrixParams,
  type PlanInstallMatrixResult,
  type ApplyInstallMatrixOptions,
} from './installMatrix';
export * from './claudeCli';
export * from './fileTree';
export * from './uninstall';
export * from './sourceManifest';
export * from './missingPlaces';

