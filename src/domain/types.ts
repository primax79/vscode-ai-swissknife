import * as path from 'path';

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
  readWorkingTree?: boolean;
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
  dirty?: boolean;
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
  source?: InstallationSourceIdentity;
  sourceId?: string;
  packageId?: string;
  artifactId?: string;
  sourceRevision?: ResolvedRevision;
  sourceContentHash?: string;
  details?: string;
}

export type InstalledFlag = 'link' | 'copy' | 'broken-link' | 'orphan' | 'duplicate';

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
  flags?: InstalledFlag[];
  linkTarget?: string;
  duplicateOf?: string[];
}

export interface InstallationSourceIdentity {
  id: string;
  scope: 'global' | 'workspace';
  type: SourceType;
  location: string;
}

export function toInstallationSourceIdentity(
  source: Source,
  homeRoot?: string
): InstallationSourceIdentity {
  const scope: 'global' | 'workspace' = source.scope === 'project' ? 'workspace' : 'global';
  const rawLocation =
    source.type === 'local-folder'
      ? (source.localPath ?? '')
      : (source.url ?? '');
  const baseDir =
    source.scope === 'project'
      ? (source.projectPath ?? process.cwd())
      : (homeRoot ?? process.env.HOME ?? process.cwd());
  const location =
    source.type === 'local-folder' && rawLocation
      ? (path.isAbsolute(rawLocation) ? rawLocation : path.resolve(baseDir, rawLocation))
      : rawLocation;
  return {
    id: source.id,
    scope,
    type: source.type,
    location,
  };
}

export interface ManagedInstallation {
  assistant: AssistantId;
  scope: Scope;
  projectPath?: string;
  kind: ItemKind;
  name: string;
  path: string;
  source?: InstallationSourceIdentity;
  sourceId?: string;
  packageId?: string;
  artifactId?: string;
  sourceRevision?: ResolvedRevision;
  sourceContentHash?: string;
  provenance?: 'unknown';
  provenanceReason?: string;
  provenanceHint?: string;
  installedAt: string;
  contentHash?: string;
  rebaselined?: 'codec';
  disabled?: boolean;
  held?: boolean;
  flags?: InstalledFlag[];
  linkTarget?: string;
  duplicateOf?: string[];
}

export type ConversionDiagnostic =
  | 'lossless'
  | 'adapted-with-warning'
  | 'potentially-destructive'
  | 'unsupported';
