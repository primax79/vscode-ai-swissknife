import type { AssistantId, ItemKind, ManagedInstallation, Scope } from '../domain/types';
import type { DriftReport, DriftStatus } from './types';
import type { CliExplainedUpdateItem } from '../cli/types';

export type ExplainStatus =
  | DriftStatus
  | 'rebaselined';

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
  status: ExplainStatus;
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
  status: ExplainStatus,
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
  } = options;

  if (status === 'rebaselined') {
    return 'hash rebaselined after codec change';
  }

  if (status === 'provenance-unknown') {
    if (provenanceReason) {
      return `provenance unknown: ${provenanceReason}`;
    }
    if (reportReason) {
      return `provenance unknown: ${reportReason}`;
    }
    return 'provenance unknown: artifact-not-in-source';
  }

  if (status === 'modified-locally') {
    if (hasLocalPatch) {
      return 'edited on disk after install (local.patch applied)';
    }
    return 'edited on disk after install';
  }

  if (status === 'update-available') {
    if (installedCommit && currentCommit && installedCommit !== currentCommit) {
      return `source moved from ${shortCommit(installedCommit)} to ${shortCommit(currentCommit)} and the content changed`;
    }
    if (dirty) {
      return 'newer version available in source (dirty working tree)';
    }
    return 'newer version available from upstream source';
  }

  if (status === 'modified-and-update-available') {
    if (installedCommit && currentCommit && installedCommit !== currentCommit) {
      return `edited on disk after install; source moved from ${shortCommit(installedCommit)} to ${shortCommit(currentCommit)} and the content changed`;
    }
    return 'edited on disk after install and upstream source changed';
  }

  if (status === 'missing-on-disk') {
    if (details) {
      return details;
    }
    return 'installation directory not found on disk';
  }

  if (status === 'source-unavailable') {
    if (reportReason) {
      return `source unavailable: ${reportReason}`;
    }
    if (details) {
      return `source unavailable: ${details}`;
    }
    return 'source unavailable';
  }

  // up-to-date
  if (installedCommit && currentCommit && installedCommit !== currentCommit) {
    return `source moved from ${shortCommit(installedCommit)} to ${shortCommit(currentCommit)} but content is unchanged`;
  }
  if (installedCommit && currentCommit && installedCommit === currentCommit) {
    return 'source commit unchanged';
  }
  return 'up to date with source';
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

  let status: ExplainStatus;
  if (
    installation.rebaselined === 'codec' ||
    report?.rebaselined === 'codec' ||
    (report as any)?.status === 'rebaselined'
  ) {
    status = 'rebaselined';
  } else if (report?.status) {
    status = report.status;
  } else {
    status = 'up-to-date';
  }

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
    status: item.status as DriftReport['status'],
    sourceIdentity: item.sourceIdentity,
    ...(item.installedCommit ? { installedCommit: item.installedCommit } : {}),
    ...(item.currentCommit ? { currentCommit: item.currentCommit } : {}),
    ...(item.installedContentHash ? { installedContentHash: item.installedContentHash } : {}),
    ...(item.sourceContentHash ? { sourceContentHash: item.sourceContentHash } : {}),
    ...(item.diskHash ? { diskHash: item.diskHash } : {}),
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
    `  <div><strong>Reason:</strong> ${esc(item.reason)}</div>`,
    '</div>',
  ].join('\n');
}
