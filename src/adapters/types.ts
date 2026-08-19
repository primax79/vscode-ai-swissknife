import type { AssistantId, Scope } from '../domain/types';

export interface CanonicalSkillFile {
  path: string;
  content: Uint8Array;
  mode?: number;
}

export interface CanonicalSkill {
  name: string;
  description: string;
  body: string; // the markdown content after the frontmatter
  extraFields: Record<string, unknown>; // unrecognized frontmatter fields, preserved verbatim (SPEC.md §4 "canonical model")
  files: CanonicalSkillFile[];
}

export type CanonicalSkillDocument = Omit<CanonicalSkill, 'files'>;

export interface CanonicalAgent {
  name: string;
  description: string;
  mode?: 'primary' | 'subagent' | 'all';
  tools: string[];
  permissions: Record<string, 'allow' | 'deny' | 'ask'>;
  model?: string;
  variant?: string;
  body: string; // markdown instructions/prompt
  extraFields: Record<string, unknown>;
}

export interface CanonicalCommand {
  name: string;
  description: string;
  agent?: string;
  model?: string;
  subtask?: boolean;
  body: string; // prompt template content
  extraFields: Record<string, unknown>;
}

export interface CanonicalRule {
  content: string; // raw file content, no frontmatter parsing — CLAUDE.md/AGENTS.md are plain markdown (SPEC.md §1)
}

export interface LocationRef {
  scope: Scope;
  projectRoot?: string; // required when scope === 'project'
}

export interface Adapter {
  readonly assistant: AssistantId;

  skillDir(name: string, loc: LocationRef): string;
  skillPath(name: string, loc: LocationRef): string;
  readSkill(name: string, loc: LocationRef): Promise<CanonicalSkill | null>; // null if not found, not an error
  writeSkill(skill: CanonicalSkill, loc: LocationRef): Promise<void>;
  listSkills(loc: LocationRef): Promise<string[]>; // names only

  agentPath(name: string, loc: LocationRef): string;
  readAgent(name: string, loc: LocationRef): Promise<CanonicalAgent | null>;
  writeAgent(agent: CanonicalAgent, loc: LocationRef): Promise<void>;
  listAgents(loc: LocationRef): Promise<string[]>;

  commandPath(name: string, loc: LocationRef): string;
  readCommand(name: string, loc: LocationRef): Promise<CanonicalCommand | null>;
  writeCommand(command: CanonicalCommand, loc: LocationRef): Promise<void>;
  listCommands(loc: LocationRef): Promise<string[]>;

  rulePath(loc: LocationRef): string;
  readRule(loc: LocationRef): Promise<CanonicalRule | null>;
  writeRule(rule: CanonicalRule, loc: LocationRef): Promise<void>;
}
