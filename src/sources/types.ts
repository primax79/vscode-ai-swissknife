import type { Artifact, Package, ResolvedArtifact, Source, SourceType } from '../domain/types';
import type {
  CanonicalAgent,
  CanonicalCommand,
  CanonicalHook,
  CanonicalMcpServer,
  CanonicalRule,
  CanonicalSkill,
} from '../adapters/types';

export interface DetectionDiagnostic {
  severity: 'error' | 'warning';
  path: string;
  message: string;
  code: 'invalid-frontmatter' | 'unsafe-path' | 'unreadable-skill';
}

export interface DetectedSkillDir {
  path: string;
  name: string;
  description?: string;
}

export interface DetectedAgentFile {
  path: string;
  name: string;
  description?: string;
}

export interface DetectedCommandFile {
  path: string;
  name: string;
  description?: string;
}

export interface DetectedMcpServer {
  id: string;
  type: string;
  command?: string;
  url?: string;
  description?: string;
  path: string;
}

export interface DetectedHookFile {
  name: string;
  event: string;
  command: string;
  timeout?: number;
  path: string;
}

export interface DetectedRuleFile {
  name: string;
  content: string;
  path: string;
}

export interface SkillDetectionResult {
  skills: DetectedSkillDir[];
  diagnostics: DetectionDiagnostic[];
}

export interface SourceResolution {
  packages: Package[];
  diagnostics: DetectionDiagnostic[];
}

/**
 * Shared interface for source-type resolvers.
 *
 * Locked displayName and iconThemeId values (from sourcesView.ts / spec §4.3):
 * - local-folder:    displayName "Local folder",      iconThemeId "folder"
 * - git-custom:      displayName "Git (custom)",      iconThemeId "repo"
 * - git-marketplace: displayName "Git marketplace",   iconThemeId "extensions"
 * - git-single-item: displayName "Git (single item)", iconThemeId "git-commit"
 * - remote-url:      displayName "Remote URL",        iconThemeId "link"
 */
export interface SourceResolver {
  readonly type: SourceType;
  readonly displayName: string;
  readonly iconThemeId: string;
  resolve(source: Source, opts?: { cacheDir?: string; homeRoot?: string; offline?: boolean }): Promise<SourceResolution>;
  resolveArtifactContent(
    source: Source,
    pkg: Package,
    artifact: Artifact,
    opts?: { cacheDir?: string; homeRoot?: string }
  ): Promise<ResolvedArtifact<CanonicalSkill | CanonicalAgent | CanonicalCommand | CanonicalMcpServer | CanonicalHook | CanonicalRule>>;
}

