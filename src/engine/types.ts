import type {
  AssistantId,
  Scope,
  Source,
  Package,
  Artifact,
  ResolvedRevision,
  ManagedInstallation,
} from '../domain/types';
import type { CanonicalSkill } from '../adapters/types';
import type { TranslationDiagnostic } from '../translator/skill';

export interface UnsupportedInstallPlan {
  supported: false;
  sourceId: string;
  packageId: string;
  artifactId: string;
  reason: string;
  diagnostics?: TranslationDiagnostic[];
}

export interface ProposedFile {
  path: string;
  contentHash: string;
  mode?: number;
}

export interface ExistingFile {
  path: string;
  contentHash: string;
}

export interface SupportedInstallPlan {
  supported: true;
  sourceId: string;
  packageId: string;
  artifactId: string;
  targetAssistant: AssistantId;
  targetScope: Scope;
  targetDir: string;
  projectRoot?: string;
  sourceRevision?: ResolvedRevision;
  conflict: boolean;
  existingFiles: ExistingFile[];
  proposedFiles: ProposedFile[];
  diagnostics: TranslationDiagnostic[];
}

export type PreparedInstall =
  | { supported: false; plan: UnsupportedInstallPlan }
  | {
      supported: true;
      plan: SupportedInstallPlan;
      content: CanonicalSkill;
      contentHash: string;
    };

export type ApplyOutcome =
  | { status: 'applied'; installation: ManagedInstallation; warnings?: string[] }
  | { status: 'refused'; reason: string }
  | { status: 'rolled-back'; reason: string }
  | { status: 'manual-recovery-required'; reason: string; paths: string[] };

export interface PlanInstallParams {
  source: Source;
  pkg: Package;
  artifact: Artifact;
  targetAdapter: {
    assistant: AssistantId;
    skillDir(name: string, loc: { scope: Scope; projectRoot?: string }): string;
  };
  targetScope: Scope;
  projectRoot?: string;
  homeRoot?: string;
  resolverOpts?: { cacheDir?: string };
}
