import type { AssistantId, ItemKind, ManagedInstallation, Scope } from '../domain/types';
import type { DriftReport, DriftStatus } from './types';
import type { CliExplainedUpdateItem } from '../cli/types';

export type ExplainStatus = DriftStatus;

export interface ExplainedState {
  key: string;
  kind: ItemKind;
  name: string;
  assistant: AssistantId;
  scope: Scope;
  sourceIdentity: string;
  sourceLocation?: string;
  installedCommit?: string;
  currentCommit?: string;
  installedContentHash?: string;
  sourceContentHash?: string;
  diskHash?: string;
  status: DriftStatus;
  rebaselined?: 'codec';
  reason: string;
  details?: string;
  workspace?: string | null;
  held?: boolean;
}

export function shortHash(val?: string | null): string {
  if (!val || typeof val !== 'string') return '-';
  return val.slice(0, 7);
}

export function shortCommit(val?: string | null): string {
  if (!val || typeof val !== 'string') return '-';
  return val.slice(0, 7);
}

export function formatSourceIdentity(installation: ManagedInstallation): string {
  if (installation.source?.id) {
    return `${installation.source.scope}:${installation.source.id}`;
  }
  if (installation.sourceId) {
    return `${installation.scope}:${installation.sourceId}`;
  }
  return '-';
}

export function computeExplainReason(
  status: DriftStatus,
  options: {
    installedCommit?: string;
    currentCommit?: string;
    installedContentHash?: string;
    sourceContentHash?: string;
    diskHash?: string;
    dirty?: boolean;
    hasLocalPatch?: boolean;
    details?: string;
    reportReason?: string;
    provenanceReason?: string;
    rebaselined?: 'codec';
  }
): string {
  const {
    installedCommit,
    currentCommit,
    dirty,
    hasLocalPatch,
    details,
    reportReason,
    provenanceReason,
    rebaselined,
  } = options;

  let baseReason: string;

  if (status === 'provenance-unknown') {
    if (provenanceReason) {
      baseReason = `provenance unknown: ${provenanceReason}`;
    } else if (reportReason) {
      baseReason = `provenance unknown: ${reportReason}`;
    } else {
      baseReason = 'provenance unknown: artifact-not-in-source';
    }
  } else if (status === 'modified-locally') {
    if (hasLocalPatch) {
      baseReason = 'edited on disk after install (local.patch applied)';
    } else {
      baseReason = 'edited on disk after install';
    }
  } else if (status === 'update-available') {
    if (installedCommit && currentCommit && installedCommit !== currentCommit) {
      baseReason = `source moved from ${shortCommit(installedCommit)} to ${shortCommit(currentCommit)} and the content changed`;
    } else if (dirty) {
      baseReason = 'newer version available in source (dirty working tree)';
    } else {
      baseReason = 'newer version available from upstream source';
    }
  } else if (status === 'modified-and-update-available') {
    if (installedCommit && currentCommit && installedCommit !== currentCommit) {
      baseReason = `edited on disk after install; source moved from ${shortCommit(installedCommit)} to ${shortCommit(currentCommit)} and the content changed`;
    } else {
      baseReason = 'edited on disk after install and upstream source changed';
    }
  } else if (status === 'missing-on-disk') {
    baseReason = details || 'installation directory not found on disk';
  } else if (status === 'source-unavailable') {
    if (reportReason) {
      baseReason = `source unavailable: ${reportReason}`;
    } else if (details) {
      baseReason = `source unavailable: ${details}`;
    } else {
      baseReason = 'source unavailable';
    }
  } else {
    // up-to-date
    if (installedCommit && currentCommit && installedCommit !== currentCommit) {
      baseReason = `source moved from ${shortCommit(installedCommit)} to ${shortCommit(currentCommit)} but content is unchanged`;
    } else if (installedCommit && currentCommit && installedCommit === currentCommit) {
      baseReason = 'source commit unchanged';
    } else {
      baseReason = 'up to date with source';
    }
  }

  if (rebaselined === 'codec') {
    return `${baseReason} (installed hash rebaselined after a codec change)`;
  }
  return baseReason;
}

export function explainInstallation(
  installation: ManagedInstallation,
  report?: DriftReport,
  options?: { workspace?: string | null; key?: string }
): ExplainedState {
  const itemKey =
    options?.key ??
    `${installation.assistant}:${installation.scope}:${installation.kind}:${installation.name}`;

  const sourceIdentity = formatSourceIdentity(installation);
  const sourceLocation = installation.source?.location;

  const installedCommit =
    installation.sourceRevision?.commit ?? report?.installedCommit ?? undefined;
  const currentCommit = report?.currentCommit ?? undefined;
  const installedContentHash = installation.contentHash ?? undefined;
  const sourceContentHash =
    report?.sourceHash ?? installation.sourceContentHash ?? undefined;
  const diskHash = report?.diskHash ?? undefined;

  const status: DriftStatus = report?.status ?? 'up-to-date';
  const rebaselined =
    installation.rebaselined === 'codec' || report?.rebaselined === 'codec'
      ? ('codec' as const)
      : undefined;

  const reason = computeExplainReason(status, {
    installedCommit,
    currentCommit,
    installedContentHash,
    sourceContentHash,
    diskHash,
    dirty: report?.dirty || Boolean(installation.sourceRevision?.dirty),
    hasLocalPatch: report?.hasLocalPatch,
    details: report?.details,
    reportReason: report?.reason,
    provenanceReason: installation.provenanceReason,
    rebaselined,
  });

  return {
    key: itemKey,
    kind: installation.kind,
    name: installation.name,
    assistant: installation.assistant,
    scope: installation.scope,
    sourceIdentity,
    ...(sourceLocation ? { sourceLocation } : {}),
    ...(installedCommit ? { installedCommit } : {}),
    ...(currentCommit ? { currentCommit } : {}),
    ...(installedContentHash ? { installedContentHash } : {}),
    ...(sourceContentHash ? { sourceContentHash } : {}),
    ...(diskHash ? { diskHash } : {}),
    status,
    ...(rebaselined ? { rebaselined } : {}),
    reason,
    ...(report?.details ? { details: report.details } : {}),
    workspace: options?.workspace ?? null,
    held: Boolean(installation.held),
  };
}

export function formatExplainCliLine(item: ExplainedState): string {
  const parts = [
    item.key,
    `source:${item.sourceIdentity}`,
    `installedCommit:${shortCommit(item.installedCommit)}`,
    `currentCommit:${shortCommit(item.currentCommit)}`,
    `installedHash:${shortHash(item.installedContentHash)}`,
    `sourceHash:${shortHash(item.sourceContentHash)}`,
    `diskHash:${shortHash(item.diskHash)}`,
    `status:${item.status}`,
    `reason:${item.reason}`,
  ];
  return parts.join('  ');
}

export function formatExplainCliJson(item: ExplainedState): CliExplainedUpdateItem {
  return {
    key: item.key,
    kind: item.kind,
    name: item.name,
    assistant: item.assistant,
    scope: item.scope,
    status: item.status,
    sourceIdentity: item.sourceIdentity,
    ...(item.installedCommit ? { installedCommit: item.installedCommit } : {}),
    ...(item.currentCommit ? { currentCommit: item.currentCommit } : {}),
    ...(item.installedContentHash ? { installedContentHash: item.installedContentHash } : {}),
    ...(item.sourceContentHash ? { sourceContentHash: item.sourceContentHash } : {}),
    ...(item.diskHash ? { diskHash: item.diskHash } : {}),
    ...(item.rebaselined ? { rebaselined: item.rebaselined } : {}),
    reason: item.reason,
    ...(item.details ? { details: item.details } : {}),
    workspace: item.workspace ?? null,
  };
}

export function formatExplainTooltip(item: ExplainedState): string {
  return [
    `Source: ${item.sourceIdentity}`,
    `Installed commit: ${shortCommit(item.installedCommit)}`,
    `Current commit: ${shortCommit(item.currentCommit)}`,
    `Installed hash: ${shortHash(item.installedContentHash)}`,
    `Source hash: ${shortHash(item.sourceContentHash)}`,
    `Disk hash: ${shortHash(item.diskHash)}`,
    `Status: ${item.status}`,
    `Reason: ${item.reason}`,
  ].join('\n');
}

export function formatExplainDetailHtml(item: ExplainedState): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  return [
    '<div class="detail-explain" style="margin-top: 8px; font-size: 12px; line-height: 1.6; border-top: 1px solid var(--vscode-editorGroup-border, #444); padding-top: 8px;">',
    `  <div><strong>Source:</strong> <code>${esc(item.sourceIdentity)}</code></div>`,
    `  <div><strong>Installed commit:</strong> <code>${esc(item.installedCommit || '-')}</code></div>`,
    `  <div><strong>Current source commit:</strong> <code>${esc(item.currentCommit || '-')}</code></div>`,
    `  <div><strong>Installed content hash:</strong> <code>${esc(item.installedContentHash || '-')}</code></div>`,
    `  <div><strong>Current source content hash:</strong> <code>${esc(item.sourceContentHash || '-')}</code></div>`,
    `  <div><strong>On-disk hash:</strong> <code>${esc(item.diskHash || '-')}</code></div>`,
    `  <div><strong>Status:</strong> ${esc(item.status)}</div>`,
    ...(item.rebaselined ? [`  <div><strong>Rebaselined:</strong> <code>${esc(item.rebaselined)}</code></div>`] : []),
    `  <div><strong>Reason:</strong> ${esc(item.reason)}</div>`,
    '</div>',
  ].join('\n');
}
