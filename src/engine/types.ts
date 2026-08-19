import type {
  AssistantId,
  Scope,
  Source,
  Package,
  Artifact,
  ResolvedRevision,
  ManagedInstallation,
} from '../domain/types';
import type {
  CanonicalSkill,
  CanonicalAgent,
  CanonicalCommand,
  CanonicalMcpServer,
  CanonicalHook,
  CanonicalRule,
  LocationRef,
} from '../adapters/types';
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
      kind: 'skill';
      plan: SupportedInstallPlan;
      content: CanonicalSkill;
      contentHash: string;
    }
  | {
      supported: true;
      kind: 'agent';
      plan: SupportedInstallPlan;
      content: CanonicalAgent;
      contentHash: string;
    }
  | {
      supported: true;
      kind: 'command';
      plan: SupportedInstallPlan;
      content: CanonicalCommand;
      contentHash: string;
    }
  | {
      supported: true;
      kind: 'mcp-server';
      plan: SupportedInstallPlan;
      content: CanonicalMcpServer;
      contentHash: string;
    }
  | {
      supported: true;
      kind: 'hook';
      plan: SupportedInstallPlan;
      content: CanonicalHook;
      contentHash: string;
    }
  | {
      supported: true;
      kind: 'rule';
      plan: SupportedInstallPlan;
      content: CanonicalRule;
      contentHash: string;
    };

export type ApplyOutcome =
  | { status: 'applied'; installation: ManagedInstallation; warnings?: string[] }
  | { status: 'refused'; reason: string }
  | { status: 'rolled-back'; reason: string }
  | { status: 'manual-recovery-required'; reason: string; paths: string[] };

export type DriftStatus =
  | 'up-to-date'
  | 'modified-locally'
  | 'update-available'
  | 'modified-and-update-available'
  | 'missing-on-disk';

export interface DriftReport {
  installation: ManagedInstallation;
  status: DriftStatus;
  diskHash?: string;
  sourceHash?: string;
  details?: string;
}

export interface PlanInstallParams {
  source: Source;
  pkg: Package;
  artifact: Artifact;
  targetAdapter: {
    assistant: AssistantId;
    skillDir(name: string, loc: { scope: Scope; projectRoot?: string }): string;
    agentPath?(name: string, loc: { scope: Scope; projectRoot?: string }): string;
    commandPath?(name: string, loc: { scope: Scope; projectRoot?: string }): string;
    mcpConfigPath?(loc: LocationRef): string;
    readMcpServer?(id: string, loc: LocationRef): Promise<CanonicalMcpServer | null>;
    writeMcpServer?(server: CanonicalMcpServer, loc: LocationRef): Promise<void>;
    hookPath?(name: string, loc: LocationRef): string;
    readHook?(name: string, loc: LocationRef): Promise<CanonicalHook | null>;
    writeHook?(hook: CanonicalHook, loc: LocationRef): Promise<void>;
    rulePath?(loc: LocationRef): string;
    readRule?(loc: LocationRef): Promise<CanonicalRule | null>;
    writeRule?(rule: CanonicalRule, loc: LocationRef): Promise<void>;
  };
  targetScope: Scope;
  projectRoot?: string;
  homeRoot?: string;
  resolverOpts?: { cacheDir?: string };
}
