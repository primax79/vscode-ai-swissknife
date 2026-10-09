export type AssistantId =
  | 'claude-code'
  | 'kilo-code'
  | 'github-copilot'
  | 'codex-cli'
  | 'gemini-cli';

export type Scope = 'global' | 'project';

export type ItemKind =
  | 'skill'
  | 'agent'
  | 'command'
  | 'mcp-server'
  | 'rule'
  | 'hook';

export type SourceType =
  | 'git-custom'
  | 'git-marketplace'
  | 'local-folder'
  | 'remote-url'
  | 'git-single-item';

export interface Source {
  id: string;
  type: SourceType;
  scope: Scope;
  projectPath?: string;
  url?: string;
  localPath?: string;
  branch?: string;
  tag?: string;
  commit?: string;
  name?: string;
}

export interface Artifact {
  id: string;
  packageId: string;
  kind: ItemKind;
  name: string;
  description?: string;
  nativeFormat: string;
  /**
   * Absolute filesystem path to this artifact's file or directory on disk
   * (inside the source's local clone/cache), when the resolver that produced
   * it could determine one. Lets the UI offer file browsing/preview before
   * install, same as it does for already-installed artifacts.
   */
  path?: string;
}

export interface ResolvedRevision {
  commit: string;
  requestedRef?: string;
}

export interface Package {
  id: string;
  sourceId: string;
  version?: ResolvedRevision;
  nativeFormat: string;
  artifacts: Artifact[];
}

export interface ResolvedArtifact<T> {
  artifact: Artifact;
  content: T;
}

export interface ObservedSourceMatch {
  status: 'identical' | 'different' | 'unmatched';
  sourceId?: string;
  packageId?: string;
  artifactId?: string;
  sourceRevision?: ResolvedRevision;
  details?: string;
}

export interface ObservedArtifact {
  assistant: AssistantId;
  scope: Scope;
  projectPath?: string;
  kind: ItemKind;
  name: string;
  path: string;
  discoveredAt: string;
  contentHash?: string;
  candidates?: ObservedSourceMatch[];
  match?: ObservedSourceMatch;
  disabled?: boolean;
}

export interface ManagedInstallation {
  assistant: AssistantId;
  scope: Scope;
  projectPath?: string;
  kind: ItemKind;
  name: string;
  path: string;
  sourceId?: string;
  packageId?: string;
  artifactId?: string;
  sourceRevision?: ResolvedRevision;
  installedAt: string;
  contentHash?: string;
  disabled?: boolean;
  held?: boolean;
}

export type ConversionDiagnostic =
  | 'lossless'
  | 'adapted-with-warning'
  | 'potentially-destructive'
  | 'unsupported';
