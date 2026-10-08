import type { AssistantId, Scope, ItemKind } from '../domain/types';

export interface CanonicalSkillFile {
  path: string;
  content: Uint8Array;
  mode?: number;
}

export interface CanonicalSkill {
  name: string;
  description: string;
  body: string;
  extraFields: Record<string, unknown>;
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
  body: string;
  extraFields: Record<string, unknown>;
}

export interface CanonicalCommand {
  name: string;
  description: string;
  agent?: string;
  model?: string;
  subtask?: boolean;
  body: string;
  extraFields: Record<string, unknown>;
}

export interface CanonicalMcpServer {
  id: string;
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  extraFields?: Record<string, unknown>;
}

export interface CanonicalHook {
  name: string;
  event: 'PreToolUse' | 'PostToolUse' | 'UserPromptSubmit' | 'SessionStart' | 'SessionStop' | 'SubagentStart' | 'SubagentStop' | 'PreCompact';
  command: string;
  timeout?: number;
  extraFields: Record<string, unknown>;
}

export interface CanonicalRule {
  name?: string;
  content: string;
}

export type DisableSupport = 'verified' | 'unverified' | 'unsupported';

export interface LocationRef {
  scope: Scope;
  projectRoot?: string;
}

export interface Adapter {
  readonly assistant: AssistantId;
  readonly displayName: string;
  readonly iconId: string;
  readonly disableSupport: DisableSupport;

  getDisabledPath(kind: ItemKind, name: string, loc: LocationRef): string | undefined;
  getDisabledRoot(kind: ItemKind, loc: LocationRef): string | undefined;

  skillDir(name: string, loc: LocationRef): string;
  skillPath(name: string, loc: LocationRef): string;
  readSkill(name: string, loc: LocationRef): Promise<CanonicalSkill | null>;
  writeSkill(skill: CanonicalSkill, loc: LocationRef): Promise<void>;
  listSkills(loc: LocationRef): Promise<string[]>;

  agentPath(name: string, loc: LocationRef): string;
  readAgent(name: string, loc: LocationRef): Promise<CanonicalAgent | null>;
  writeAgent(agent: CanonicalAgent, loc: LocationRef): Promise<void>;
  listAgents(loc: LocationRef): Promise<string[]>;

  commandPath(name: string, loc: LocationRef): string;
  readCommand(name: string, loc: LocationRef): Promise<CanonicalCommand | null>;
  writeCommand(command: CanonicalCommand, loc: LocationRef): Promise<void>;
  listCommands(loc: LocationRef): Promise<string[]>;

  mcpConfigPath(loc: LocationRef): string;
  readMcpServer(id: string, loc: LocationRef): Promise<CanonicalMcpServer | null>;
  writeMcpServer(server: CanonicalMcpServer, loc: LocationRef): Promise<void>;
  removeMcpServer(id: string, loc: LocationRef): Promise<void>;
  listMcpServers(loc: LocationRef): Promise<string[]>;

  hookPath(name: string, loc: LocationRef): string;
  readHook(name: string, loc: LocationRef): Promise<CanonicalHook | null>;
  writeHook(hook: CanonicalHook, loc: LocationRef): Promise<void>;
  listHooks(loc: LocationRef): Promise<string[]>;

  rulePath(loc: LocationRef): string;
  readRule(loc: LocationRef): Promise<CanonicalRule | null>;
  writeRule(rule: CanonicalRule, loc: LocationRef): Promise<void>;
}
