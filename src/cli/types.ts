import type { AssistantId, ItemKind, Scope, ResolvedRevision } from '../domain/types';
import type { MatrixSummary } from '../engine/installMatrix';
import type { DriftReport } from '../engine/types';

export type ErrorCode =
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'SOURCE_RESOLUTION_FAILED'
  | 'INTERNAL'
  | 'WRITE_NOT_ENABLED'
  | 'KIND_NOT_ALLOWED'
  | 'NOT_A_LOCAL_FOLDER_SOURCE'
  | 'DUPLICATE_ID'
  | 'CONFLICT';

export interface CliErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
  };
}

export interface GlobalCliOptions {
  workspace?: string;
  home?: string;
  assistants?: string;
  roots?: string[];
  maxDepth?: number | string;
  ignore?: string[];
  extraIgnore?: string[];
}

export interface CliOptionDefinition {
  flags: string;
  description: string;
  required?: boolean;
}

export interface CliArgumentDefinition {
  name: string;
  required?: boolean;
  description?: string;
}

export interface CliCommandDescription {
  name: string;
  description: string;
  arguments?: CliArgumentDefinition[];
  options: CliOptionDefinition[];
  outputShape: Record<string, unknown>;
}

export interface CliCommandDefinition extends CliCommandDescription {
  examples?: string[];
  run: (args: Record<string, any>, globalOpts: GlobalCliOptions) => Promise<unknown>;
}

export interface CliSource {
  id: string;
  type: string;
  scope: Scope;
  url?: string;
  localPath?: string;
  branch?: string;
  tag?: string;
  commit?: string;
  name?: string;
}

export interface CatalogArtifact {
  sourceId: string;
  scope: Scope;
  packageId: string;
  artifactId: string;
  kind: ItemKind;
  name: string;
  description?: string;
  version?: string | ResolvedRevision;
}

export interface CatalogDiagnostic {
  sourceId: string;
  scope: Scope;
  message: string;
}

export interface CatalogResult {
  artifacts: CatalogArtifact[];
  diagnostics: CatalogDiagnostic[];
}

export interface CliInstalledItem {
  key: string;
  kind: ItemKind;
  name: string;
  assistant: AssistantId;
  scope: Scope;
  membership: 'managed' | 'observed';
  path: string;
  sourceId?: string;
  match?: 'identical' | 'different';
  workspace?: string | null;
}

export interface CliInstalledRootsResult {
  items: CliInstalledItem[];
  installed: CliInstalledItem[];
  workspaces: string[];
  skipped: Array<{ path: string; reason: string }>;
}

export interface CliUpdateItem {
  key: string;
  kind: ItemKind;
  name: string;
  assistant: AssistantId;
  scope: Scope;
  status: DriftReport['status'];
  sourceId?: string;
  details?: string;
  workspace?: string | null;
}

export interface CliItemDetail {
  key: string;
  kind: ItemKind;
  name: string;
  assistant: AssistantId;
  scope: Scope;
  membership: 'managed' | 'observed';
  path: string;
  workspace?: string | null;
  origin?: {
    sourceId?: string;
    packageId?: string;
    artifactId?: string;
    sourceRevision?: string | ResolvedRevision;
    status?: string;
    type?: string;
  };
  installedIn: Array<{
    assistant: AssistantId;
    scope: Scope;
    membership: 'managed' | 'observed';
    path: string;
    workspace?: string | null;
  }>;
  diffAvailable: boolean;
  diff?: string;
}

export type CliPlanInstallSummary = MatrixSummary;
