import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AssistantId } from '../domain/types';
import type {
  Adapter,
  CanonicalRule,
  CanonicalSkill,
  CanonicalSkillDocument,
  CanonicalAgent,
  CanonicalCommand,
  CanonicalMcpServer,
  CanonicalHook,
  LocationRef,
} from './types';
import { readSkill as codecReadSkill, writeSkill as codecWriteSkill } from './codec';

/**
 * Parses a single YAML value from a string.
 * Supports numbers, booleans, null, quoted strings, JSON objects/arrays, and plain strings.
 */
export function parseYamlValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return '';
  }
  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }
  if (trimmed === 'null') {
    return null;
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    if (trimmed.startsWith('"')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed.slice(1, -1);
      }
    } else {
      return trimmed.slice(1, -1).replace(/\\'/g, "'");
    }
  }
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    if (!Number.isNaN(num)) {
      return num;
    }
  }
  return trimmed;
}

/**
 * Serializes a value for YAML frontmatter.
 */
export function serializeYamlValue(val: unknown): string {
  if (val === null || val === undefined) {
    return 'null';
  }
  if (typeof val === 'boolean' || typeof val === 'number') {
    return String(val);
  }
  if (typeof val === 'object') {
    return JSON.stringify(val);
  }
  const str = String(val);
  if (
    str === '' ||
    str === 'true' ||
    str === 'false' ||
    str === 'null' ||
    /^-?\d+(\.\d+)?$/.test(str) ||
    str.includes('\n') ||
    str.startsWith(' ') ||
    str.endsWith(' ') ||
    /[:#"'[\]{}|>%@`]/.test(str)
  ) {
    return JSON.stringify(str);
  }
  return str;
}

/**
 * Parses markdown content with YAML frontmatter into a CanonicalSkillDocument.
 */
export function parseSkillMarkdown(content: string): CanonicalSkillDocument {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/);
  if (!match) {
    return {
      name: '',
      description: '',
      body: content,
      extraFields: {},
    };
  }

  const fmBlock = match[1];
  const body = match[2] ?? '';
  const lines = fmBlock.split(/\r?\n/);

  let name = '';
  let description = '';
  const extraFields: Record<string, unknown> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      continue;
    }
    const key = trimmed.slice(0, colonIdx).trim();
    const rawVal = trimmed.slice(colonIdx + 1).trim();
    const parsedVal = parseYamlValue(rawVal);

    if (key === 'name') {
      name = typeof parsedVal === 'string' ? parsedVal : String(parsedVal ?? '');
    } else if (key === 'description') {
      description = typeof parsedVal === 'string' ? parsedVal : String(parsedVal ?? '');
    } else {
      extraFields[key] = parsedVal;
    }
  }

  return {
    name,
    description,
    body,
    extraFields,
  };
}

/**
 * Serializes a CanonicalSkillDocument into markdown with YAML frontmatter.
 */
export function serializeSkillMarkdown(skill: CanonicalSkillDocument): string {
  let fm = `---\nname: ${serializeYamlValue(skill.name)}\ndescription: ${serializeYamlValue(skill.description)}\n`;
  if (skill.extraFields) {
    for (const [key, value] of Object.entries(skill.extraFields)) {
      if (key === 'name' || key === 'description') {
        continue;
      }
      fm += `${key}: ${serializeYamlValue(value)}\n`;
    }
  }
  fm += '---';
  return skill.body ? `${fm}\n${skill.body}` : `${fm}\n`;
}

/**
 * Parses Claude agent markdown into CanonicalAgent.
 */
export function parseClaudeAgentMarkdown(content: string): CanonicalAgent {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/);
  if (!match) {
    return {
      name: '',
      description: '',
      tools: [],
      permissions: {},
      body: content,
      extraFields: {},
    };
  }

  const fmBlock = match[1];
  const body = match[2] ?? '';
  const lines = fmBlock.split(/\r?\n/);

  let name = '';
  let description = '';
  let model: string | undefined;
  let tools: string[] = [];
  const extraFields: Record<string, unknown> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      continue;
    }
    const key = trimmed.slice(0, colonIdx).trim();
    const rawVal = trimmed.slice(colonIdx + 1).trim();
    const parsedVal = parseYamlValue(rawVal);

    if (key === 'name') {
      name = typeof parsedVal === 'string' ? parsedVal : String(parsedVal ?? '');
    } else if (key === 'description') {
      description = typeof parsedVal === 'string' ? parsedVal : String(parsedVal ?? '');
    } else if (key === 'model') {
      model = typeof parsedVal === 'string' ? parsedVal : String(parsedVal ?? '');
    } else if (key === 'tools') {
      if (Array.isArray(parsedVal)) {
        tools = parsedVal.map(String);
      } else if (typeof parsedVal === 'string' && parsedVal) {
        tools = [parsedVal];
      }
    } else {
      extraFields[key] = parsedVal;
    }
  }

  return {
    name,
    description,
    tools,
    permissions: {},
    ...(model ? { model } : {}),
    body,
    extraFields,
  };
}

/**
 * Serializes a CanonicalAgent into Claude agent markdown.
 */
export function serializeClaudeAgentMarkdown(agent: CanonicalAgent): string {
  let fm = `---\nname: ${serializeYamlValue(agent.name)}\ndescription: ${serializeYamlValue(agent.description)}\n`;
  if (agent.tools && agent.tools.length > 0) {
    fm += `tools: ${JSON.stringify(agent.tools)}\n`;
  }
  if (agent.model) {
    fm += `model: ${serializeYamlValue(agent.model)}\n`;
  }
  if (agent.extraFields) {
    for (const [key, value] of Object.entries(agent.extraFields)) {
      if (key === 'name' || key === 'description' || key === 'tools' || key === 'model' || key === 'permissions' || key === 'mode' || key === 'variant') {
        continue;
      }
      fm += `${key}: ${serializeYamlValue(value)}\n`;
    }
  }
  fm += '---';
  return agent.body ? `${fm}\n${agent.body}` : `${fm}\n`;
}

/**
 * Parses Claude command markdown into CanonicalCommand.
 */
export function parseClaudeCommandMarkdown(content: string, defaultName = ''): CanonicalCommand {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/);
  if (!match) {
    return {
      name: defaultName,
      description: '',
      body: content,
      extraFields: {},
    };
  }

  const fmBlock = match[1];
  const body = match[2] ?? '';
  const lines = fmBlock.split(/\r?\n/);

  let name = defaultName;
  let description = '';
  let agent: string | undefined;
  let model: string | undefined;
  let subtask: boolean | undefined;
  const extraFields: Record<string, unknown> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      continue;
    }
    const key = trimmed.slice(0, colonIdx).trim();
    const rawVal = trimmed.slice(colonIdx + 1).trim();
    const parsedVal = parseYamlValue(rawVal);

    if (key === 'name') {
      name = typeof parsedVal === 'string' ? parsedVal : String(parsedVal ?? '');
    } else if (key === 'description') {
      description = typeof parsedVal === 'string' ? parsedVal : String(parsedVal ?? '');
    } else if (key === 'agent') {
      agent = typeof parsedVal === 'string' ? parsedVal : String(parsedVal ?? '');
    } else if (key === 'model') {
      model = typeof parsedVal === 'string' ? parsedVal : String(parsedVal ?? '');
    } else if (key === 'subtask') {
      subtask = typeof parsedVal === 'boolean' ? parsedVal : Boolean(parsedVal);
    } else {
      extraFields[key] = parsedVal;
    }
  }

  return {
    name,
    description,
    ...(agent ? { agent } : {}),
    ...(model ? { model } : {}),
    ...(subtask !== undefined ? { subtask } : {}),
    body,
    extraFields,
  };
}

/**
 * Serializes a CanonicalCommand into Claude command markdown.
 */
export function serializeClaudeCommandMarkdown(cmd: CanonicalCommand): string {
  let fm = '---\n';
  if (cmd.description) {
    fm += `description: ${serializeYamlValue(cmd.description)}\n`;
  }
  if (cmd.agent) {
    fm += `agent: ${serializeYamlValue(cmd.agent)}\n`;
  }
  if (cmd.model) {
    fm += `model: ${serializeYamlValue(cmd.model)}\n`;
  }
  if (cmd.subtask !== undefined) {
    fm += `subtask: ${cmd.subtask}\n`;
  }
  if (cmd.extraFields) {
    for (const [key, value] of Object.entries(cmd.extraFields)) {
      if (key === 'name' || key === 'description' || key === 'agent' || key === 'model' || key === 'subtask') {
        continue;
      }
      fm += `${key}: ${serializeYamlValue(value)}\n`;
    }
  }
  fm += '---';
  return cmd.body ? `${fm}\n${cmd.body}` : `${fm}\n`;
}

export class ClaudeAdapter implements Adapter {
  readonly assistant: AssistantId = 'claude-code';
  readonly displayName: string = 'Claude Code';
  readonly iconId: string = 'ai-swissknife-claude-code';

  constructor(private readonly getHomedir: () => string = os.homedir) {}

  skillDir(name: string, loc: LocationRef): string {
    return path.dirname(this.skillPath(name, loc));
  }

  skillPath(name: string, loc: LocationRef): string {
    if (loc.scope === 'global') {
      return path.join(this.getHomedir(), '.claude', 'skills', name, 'SKILL.md');
    }
    if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      return path.join(loc.projectRoot, '.claude', 'skills', name, 'SKILL.md');
    }
    throw new Error(`Unsupported scope: ${(loc as { scope: string }).scope}`);
  }

  async readSkill(name: string, loc: LocationRef): Promise<CanonicalSkill | null> {
    const filePath = this.skillPath(name, loc);
    const dir = path.dirname(filePath);
    try {
      return await codecReadSkill(dir);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  async writeSkill(skill: CanonicalSkill, loc: LocationRef): Promise<void> {
    const filePath = this.skillPath(skill.name, loc);
    const dir = path.dirname(filePath);
    await codecWriteSkill(skill, dir);
  }

  async listSkills(loc: LocationRef): Promise<string[]> {
    let skillsDir: string;
    if (loc.scope === 'global') {
      skillsDir = path.join(this.getHomedir(), '.claude', 'skills');
    } else if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      skillsDir = path.join(loc.projectRoot, '.claude', 'skills');
    } else {
      throw new Error(`Unsupported scope: ${(loc as { scope: string }).scope}`);
    }

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(skillsDir, { withFileTypes: true });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }

    const skillNames: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
        try {
          const stat = await fs.promises.stat(skillFile);
          if (stat.isFile()) {
            skillNames.push(entry.name);
          }
        } catch {
          // ignore
        }
      }
    }
    return skillNames;
  }

  agentPath(name: string, loc: LocationRef): string {
    const fileName = name.endsWith('.md') ? name : `${name}.md`;
    if (loc.scope === 'global') {
      return path.join(this.getHomedir(), '.claude', 'agents', fileName);
    }
    if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      return path.join(loc.projectRoot, '.claude', 'agents', fileName);
    }
    throw new Error(`Unsupported scope: ${(loc as { scope: string }).scope}`);
  }

  async readAgent(name: string, loc: LocationRef): Promise<CanonicalAgent | null> {
    const filePath = this.agentPath(name, loc);
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return parseClaudeAgentMarkdown(content);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  async writeAgent(agent: CanonicalAgent, loc: LocationRef): Promise<void> {
    const filePath = this.agentPath(agent.name, loc);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const serialized = serializeClaudeAgentMarkdown(agent);
    await fs.promises.writeFile(filePath, serialized, 'utf-8');
  }

  async listAgents(loc: LocationRef): Promise<string[]> {
    let agentsDir: string;
    if (loc.scope === 'global') {
      agentsDir = path.join(this.getHomedir(), '.claude', 'agents');
    } else if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      agentsDir = path.join(loc.projectRoot, '.claude', 'agents');
    } else {
      throw new Error(`Unsupported scope: ${(loc as { scope: string }).scope}`);
    }

    try {
      const entries = await fs.promises.readdir(agentsDir, { withFileTypes: true });
      return entries
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => e.name.replace(/\.md$/, ''));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  commandPath(name: string, loc: LocationRef): string {
    const fileName = name.endsWith('.md') ? name : `${name}.md`;
    if (loc.scope === 'global') {
      return path.join(this.getHomedir(), '.claude', 'commands', fileName);
    }
    if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      return path.join(loc.projectRoot, '.claude', 'commands', fileName);
    }
    throw new Error(`Unsupported scope: ${(loc as { scope: string }).scope}`);
  }

  async readCommand(name: string, loc: LocationRef): Promise<CanonicalCommand | null> {
    const filePath = this.commandPath(name, loc);
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return parseClaudeCommandMarkdown(content, name);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  async writeCommand(command: CanonicalCommand, loc: LocationRef): Promise<void> {
    const filePath = this.commandPath(command.name, loc);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const serialized = serializeClaudeCommandMarkdown(command);
    await fs.promises.writeFile(filePath, serialized, 'utf-8');
  }

  async listCommands(loc: LocationRef): Promise<string[]> {
    let commandsDir: string;
    if (loc.scope === 'global') {
      commandsDir = path.join(this.getHomedir(), '.claude', 'commands');
    } else if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      commandsDir = path.join(loc.projectRoot, '.claude', 'commands');
    } else {
      throw new Error(`Unsupported scope: ${(loc as { scope: string }).scope}`);
    }

    try {
      const entries = await fs.promises.readdir(commandsDir, { withFileTypes: true });
      return entries
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => e.name.replace(/\.md$/, ''));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  mcpConfigPath(loc: LocationRef): string {
    if (loc.scope === 'global') {
      return path.join(this.getHomedir(), '.claude', 'settings.json');
    }
    if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      return path.join(loc.projectRoot, '.mcp.json');
    }
    throw new Error(`Unsupported scope: ${(loc as { scope: string }).scope}`);
  }

  async readMcpServer(id: string, loc: LocationRef): Promise<CanonicalMcpServer | null> {
    const filePath = this.mcpConfigPath(loc);
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      const conf = parsed.mcpServers?.[id];
      if (!conf) return null;

      const type: 'stdio' | 'http' | 'sse' = conf.type ?? (conf.command ? 'stdio' : 'sse');
      const extraFields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(conf)) {
        if (!['id', 'type', 'command', 'args', 'url', 'env', 'headers'].includes(k)) {
          extraFields[k] = v;
        }
      }

      return {
        id,
        type,
        ...(conf.command ? { command: conf.command } : {}),
        ...(conf.args ? { args: conf.args } : {}),
        ...(conf.url ? { url: conf.url } : {}),
        ...(conf.env ? { env: conf.env } : {}),
        ...(conf.headers ? { headers: conf.headers } : {}),
        extraFields,
      };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('DEBUG READ MCP ERROR:', err);
      }
      return null;
    }
  }

  async writeMcpServer(server: CanonicalMcpServer, loc: LocationRef): Promise<void> {
    const filePath = this.mcpConfigPath(loc);
    let parsed: Record<string, unknown> = {};

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      parsed = JSON.parse(content);
    } catch {
      parsed = {};
    }

    if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object' || Array.isArray(parsed.mcpServers)) {
      parsed.mcpServers = {};
    }

    const mcpServers = parsed.mcpServers as Record<string, unknown>;
    const entry: Record<string, unknown> = {};
    if (server.command) entry.command = server.command;
    if (server.args) entry.args = server.args;
    if (server.url) entry.url = server.url;
    if (server.env) entry.env = server.env;
    if (server.headers) entry.headers = server.headers;
    if (server.extraFields) {
      for (const [k, v] of Object.entries(server.extraFields)) {
        if (!['id', 'type', 'command', 'args', 'url', 'env', 'headers'].includes(k)) {
          entry[k] = v;
        }
      }
    }

    mcpServers[server.id] = entry;

    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
  }

  async removeMcpServer(id: string, loc: LocationRef): Promise<void> {
    const filePath = this.mcpConfigPath(loc);
    let parsed: Record<string, unknown> = {};

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      parsed = JSON.parse(content);
    } catch {
      return; // If file doesn't exist or is invalid, no-op
    }

    if (parsed.mcpServers && typeof parsed.mcpServers === 'object' && !Array.isArray(parsed.mcpServers)) {
      const mcpServers = parsed.mcpServers as Record<string, unknown>;
      if (id in mcpServers) {
        delete mcpServers[id];
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
      }
    }
  }

  async listMcpServers(loc: LocationRef): Promise<string[]> {
    const filePath = this.mcpConfigPath(loc);
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      return Object.keys(parsed.mcpServers ?? {});
    } catch {
      return [];
    }
  }

  hookPath(name: string, loc: LocationRef): string {
    const fileName = name.endsWith('.json') ? name : `${name}.json`;
    if (loc.scope === 'global') {
      return path.join(this.getHomedir(), '.claude', 'hooks', fileName);
    }
    if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      return path.join(loc.projectRoot, '.claude', 'hooks', fileName);
    }
    throw new Error(`Unsupported scope: ${(loc as { scope: string }).scope}`);
  }

  async readHook(name: string, loc: LocationRef): Promise<CanonicalHook | null> {
    const filePath = this.hookPath(name, loc);
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      return {
        name,
        event: parsed.event ?? 'PreToolUse',
        command: parsed.command ?? '',
        timeout: parsed.timeout,
        extraFields: { ...parsed },
      };
    } catch {
      return null;
    }
  }

  async writeHook(hook: CanonicalHook, loc: LocationRef): Promise<void> {
    const filePath = this.hookPath(hook.name, loc);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const payload = {
      event: hook.event,
      command: hook.command,
      ...(hook.timeout ? { timeout: hook.timeout } : {}),
      ...hook.extraFields,
    };
    await fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  }

  async listHooks(loc: LocationRef): Promise<string[]> {
    let hooksDir: string;
    if (loc.scope === 'global') {
      hooksDir = path.join(this.getHomedir(), '.claude', 'hooks');
    } else if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      hooksDir = path.join(loc.projectRoot, '.claude', 'hooks');
    } else {
      throw new Error(`Unsupported scope: ${(loc as { scope: string }).scope}`);
    }

    try {
      const entries = await fs.promises.readdir(hooksDir, { withFileTypes: true });
      return entries
        .filter((e) => e.isFile() && e.name.endsWith('.json'))
        .map((e) => e.name.replace(/\.json$/, ''));
    } catch {
      return [];
    }
  }

  rulePath(loc: LocationRef): string {
    if (loc.scope === 'global') {
      return path.join(this.getHomedir(), '.claude', 'CLAUDE.md');
    }
    if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      return path.join(loc.projectRoot, 'CLAUDE.md');
    }
    throw new Error(`Unsupported scope: ${(loc as { scope: string }).scope}`);
  }

  async readRule(loc: LocationRef): Promise<CanonicalRule | null> {
    const filePath = this.rulePath(loc);
    let rawContent: string;
    try {
      rawContent = await fs.promises.readFile(filePath, 'utf-8');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
    return { content: rawContent };
  }

  async writeRule(rule: CanonicalRule, loc: LocationRef): Promise<void> {
    const filePath = this.rulePath(loc);
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(filePath, rule.content, 'utf-8');
  }
}

export const claudeAdapter = new ClaudeAdapter();
