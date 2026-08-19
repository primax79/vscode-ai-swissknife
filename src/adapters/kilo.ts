import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AssistantId } from '../domain/types';
import type {
  Adapter,
  CanonicalRule,
  CanonicalSkill,
  CanonicalAgent,
  CanonicalCommand,
  CanonicalMcpServer,
  CanonicalHook,
  LocationRef,
} from './types';
import { readSkill as codecReadSkill, writeSkill as codecWriteSkill } from './codec';
import { parseYamlValue, serializeYamlValue } from './claude';

/**
 * Parses Kilo agent markdown into CanonicalAgent.
 */
export function parseKiloAgentMarkdown(content: string): CanonicalAgent {
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
  let mode: 'primary' | 'subagent' | 'all' | undefined;
  let model: string | undefined;
  let variant: string | undefined;
  const permissions: Record<string, 'allow' | 'deny' | 'ask'> = {};
  const extraFields: Record<string, unknown> = {};

  let inPermissionBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    if (inPermissionBlock) {
      if (line.startsWith('  ') || line.startsWith('\t')) {
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx !== -1) {
          const permKey = trimmed.slice(0, colonIdx).trim();
          const permVal = trimmed.slice(colonIdx + 1).trim() as 'allow' | 'deny' | 'ask';
          permissions[permKey] = permVal;
        }
        continue;
      } else {
        inPermissionBlock = false;
      }
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      continue;
    }
    const key = trimmed.slice(0, colonIdx).trim();
    const rawVal = trimmed.slice(colonIdx + 1).trim();

    if (key === 'permission') {
      if (rawVal.startsWith('{') && rawVal.endsWith('}')) {
        try {
          const parsed = JSON.parse(rawVal);
          Object.assign(permissions, parsed);
        } catch {
          // ignore
        }
      } else {
        inPermissionBlock = true;
      }
      continue;
    }

    const parsedVal = parseYamlValue(rawVal);

    if (key === 'name') {
      name = typeof parsedVal === 'string' ? parsedVal : String(parsedVal ?? '');
    } else if (key === 'description') {
      description = typeof parsedVal === 'string' ? parsedVal : String(parsedVal ?? '');
    } else if (key === 'mode') {
      if (parsedVal === 'primary' || parsedVal === 'subagent' || parsedVal === 'all') {
        mode = parsedVal;
      }
    } else if (key === 'model') {
      model = typeof parsedVal === 'string' ? parsedVal : String(parsedVal ?? '');
    } else if (key === 'variant') {
      variant = typeof parsedVal === 'string' ? parsedVal : String(parsedVal ?? '');
    } else {
      extraFields[key] = parsedVal;
    }
  }

  return {
    name,
    description,
    mode,
    tools: [],
    permissions,
    ...(model ? { model } : {}),
    ...(variant ? { variant } : {}),
    body,
    extraFields,
  };
}

/**
 * Serializes a CanonicalAgent into Kilo agent markdown.
 */
export function serializeKiloAgentMarkdown(agent: CanonicalAgent): string {
  let fm = `---\nname: ${serializeYamlValue(agent.name)}\ndescription: ${serializeYamlValue(agent.description)}\n`;
  if (agent.mode) {
    fm += `mode: ${agent.mode}\n`;
  }
  if (agent.permissions && Object.keys(agent.permissions).length > 0) {
    fm += 'permission:\n';
    for (const [permKey, permVal] of Object.entries(agent.permissions)) {
      fm += `  ${permKey}: ${permVal}\n`;
    }
  }
  if (agent.model) {
    fm += `model: ${serializeYamlValue(agent.model)}\n`;
  }
  if (agent.variant) {
    fm += `variant: ${serializeYamlValue(agent.variant)}\n`;
  }
  if (agent.extraFields) {
    for (const [key, value] of Object.entries(agent.extraFields)) {
      if (key === 'name' || key === 'description' || key === 'mode' || key === 'permission' || key === 'permissions' || key === 'tools' || key === 'model' || key === 'variant') {
        continue;
      }
      fm += `${key}: ${serializeYamlValue(value)}\n`;
    }
  }
  fm += '---';
  return agent.body ? `${fm}\n${agent.body}` : `${fm}\n`;
}

/**
 * Parses Kilo command markdown into CanonicalCommand.
 */
export function parseKiloCommandMarkdown(content: string, defaultName = ''): CanonicalCommand {
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
 * Serializes a CanonicalCommand into Kilo command markdown.
 * STRICT SCHEMA: Kilo accepts strictly only `description`, `agent`, `model`, `subtask`.
 */
export function serializeKiloCommandMarkdown(cmd: CanonicalCommand): string {
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
  fm += '---';
  return cmd.body ? `${fm}\n${cmd.body}` : `${fm}\n`;
}

export class KiloAdapter implements Adapter {
  readonly assistant: AssistantId = 'kilo-code';

  constructor(private readonly getHomedir: () => string = os.homedir) {}

  skillDir(name: string, loc: LocationRef): string {
    return path.dirname(this.skillPath(name, loc));
  }

  skillPath(name: string, loc: LocationRef): string {
    if (loc.scope === 'global') {
      return path.join(this.getHomedir(), '.kilo', 'skills', name, 'SKILL.md');
    }
    if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      return path.join(loc.projectRoot, '.kilo', 'skills', name, 'SKILL.md');
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
      skillsDir = path.join(this.getHomedir(), '.kilo', 'skills');
    } else if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      skillsDir = path.join(loc.projectRoot, '.kilo', 'skills');
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
      return path.join(this.getHomedir(), '.config', 'kilo', 'agents', fileName);
    }
    if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      return path.join(loc.projectRoot, '.kilo', 'agents', fileName);
    }
    throw new Error(`Unsupported scope: ${(loc as { scope: string }).scope}`);
  }

  async readAgent(name: string, loc: LocationRef): Promise<CanonicalAgent | null> {
    const primaryPath = this.agentPath(name, loc);
    const fileName = name.endsWith('.md') ? name : `${name}.md`;
    const fallbackPath =
      loc.scope === 'global'
        ? path.join(this.getHomedir(), '.config', 'kilo', 'agent', fileName)
        : loc.projectRoot
        ? path.join(loc.projectRoot, '.kilo', 'agent', fileName)
        : '';

    for (const candidate of [primaryPath, fallbackPath]) {
      if (!candidate) continue;
      try {
        const content = await fs.promises.readFile(candidate, 'utf-8');
        return parseKiloAgentMarkdown(content);
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
      }
    }
    return null;
  }

  async writeAgent(agent: CanonicalAgent, loc: LocationRef): Promise<void> {
    const filePath = this.agentPath(agent.name, loc);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const serialized = serializeKiloAgentMarkdown(agent);
    await fs.promises.writeFile(filePath, serialized, 'utf-8');
  }

  async listAgents(loc: LocationRef): Promise<string[]> {
    const candidates: string[] = [];
    if (loc.scope === 'global') {
      candidates.push(
        path.join(this.getHomedir(), '.config', 'kilo', 'agents'),
        path.join(this.getHomedir(), '.config', 'kilo', 'agent')
      );
    } else if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      candidates.push(
        path.join(loc.projectRoot, '.kilo', 'agents'),
        path.join(loc.projectRoot, '.kilo', 'agent')
      );
    }

    const agentNames = new Set<string>();
    for (const dir of candidates) {
      try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isFile() && e.name.endsWith('.md')) {
            agentNames.add(e.name.replace(/\.md$/, ''));
          }
        }
      } catch {
        // ignore
      }
    }
    return Array.from(agentNames);
  }

  commandPath(name: string, loc: LocationRef): string {
    const fileName = name.endsWith('.md') ? name : `${name}.md`;
    if (loc.scope === 'global') {
      return path.join(this.getHomedir(), '.config', 'kilo', 'command', fileName);
    }
    if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      return path.join(loc.projectRoot, '.kilo', 'command', fileName);
    }
    throw new Error(`Unsupported scope: ${(loc as { scope: string }).scope}`);
  }

  async readCommand(name: string, loc: LocationRef): Promise<CanonicalCommand | null> {
    const primaryPath = this.commandPath(name, loc);
    const fileName = name.endsWith('.md') ? name : `${name}.md`;
    const fallbackPath =
      loc.scope === 'global'
        ? path.join(this.getHomedir(), '.config', 'kilo', 'commands', fileName)
        : loc.projectRoot
        ? path.join(loc.projectRoot, '.kilo', 'commands', fileName)
        : '';

    for (const candidate of [primaryPath, fallbackPath]) {
      if (!candidate) continue;
      try {
        const content = await fs.promises.readFile(candidate, 'utf-8');
        return parseKiloCommandMarkdown(content, name);
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
      }
    }
    return null;
  }

  async writeCommand(command: CanonicalCommand, loc: LocationRef): Promise<void> {
    const filePath = this.commandPath(command.name, loc);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const serialized = serializeKiloCommandMarkdown(command);
    await fs.promises.writeFile(filePath, serialized, 'utf-8');
  }

  async listCommands(loc: LocationRef): Promise<string[]> {
    const candidates: string[] = [];
    if (loc.scope === 'global') {
      candidates.push(
        path.join(this.getHomedir(), '.config', 'kilo', 'command'),
        path.join(this.getHomedir(), '.config', 'kilo', 'commands')
      );
    } else if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      candidates.push(
        path.join(loc.projectRoot, '.kilo', 'command'),
        path.join(loc.projectRoot, '.kilo', 'commands')
      );
    }

    const commandNames = new Set<string>();
    for (const dir of candidates) {
      try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isFile() && e.name.endsWith('.md')) {
            commandNames.add(e.name.replace(/\.md$/, ''));
          }
        }
      } catch {
        // ignore
      }
    }
    return Array.from(commandNames);
  }

  mcpConfigPath(loc: LocationRef): string {
    if (loc.scope === 'global') {
      return path.join(this.getHomedir(), '.config', 'kilo', 'mcp.json');
    }
    if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      return path.join(loc.projectRoot, '.kilo', 'mcp.json');
    }
    throw new Error(`Unsupported scope: ${(loc as { scope: string }).scope}`);
  }

  async readMcpServer(id: string, loc: LocationRef): Promise<CanonicalMcpServer | null> {
    const filePath = this.mcpConfigPath(loc);
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      const mcpBlock = parsed.mcp ?? parsed.mcpServers ?? parsed;
      const conf = mcpBlock[id];
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
        console.error('DEBUG KILO READ MCP ERROR:', err);
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

    if (!parsed.mcp || typeof parsed.mcp !== 'object' || Array.isArray(parsed.mcp)) {
      parsed.mcp = {};
    }

    const mcpMap = parsed.mcp as Record<string, unknown>;
    const entry: Record<string, unknown> = {
      type: server.type,
      ...(server.command ? { command: server.command } : {}),
      ...(server.args ? { args: server.args } : {}),
      ...(server.url ? { url: server.url } : {}),
      ...(server.env ? { env: server.env } : {}),
      ...(server.headers ? { headers: server.headers } : {}),
    };

    if (server.extraFields) {
      for (const [k, v] of Object.entries(server.extraFields)) {
        if (!['id', 'type', 'command', 'args', 'url', 'env', 'headers'].includes(k)) {
          entry[k] = v;
        }
      }
    }

    mcpMap[server.id] = entry;

    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
  }

  async listMcpServers(loc: LocationRef): Promise<string[]> {
    const filePath = this.mcpConfigPath(loc);
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      const mcpBlock = parsed.mcp ?? parsed.mcpServers ?? {};
      return Object.keys(mcpBlock);
    } catch {
      return [];
    }
  }

  hookPath(name: string, loc: LocationRef): string {
    const fileName = name.endsWith('.json') ? name : `${name}.json`;
    if (loc.scope === 'global') {
      return path.join(this.getHomedir(), '.config', 'kilo', 'hooks', fileName);
    }
    if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      return path.join(loc.projectRoot, '.kilo', 'hooks', fileName);
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
      hooksDir = path.join(this.getHomedir(), '.config', 'kilo', 'hooks');
    } else if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      hooksDir = path.join(loc.projectRoot, '.kilo', 'hooks');
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
      return path.join(this.getHomedir(), '.config', 'kilo', 'AGENTS.md');
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

export const kiloAdapter = new KiloAdapter();
