import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as jsonc from 'jsonc-parser';
import type { AssistantId, ItemKind } from '../domain/types';
import type {
  Adapter,
  CanonicalRule,
  CanonicalSkill,
  CanonicalAgent,
  CanonicalCommand,
  CanonicalMcpServer,
  CanonicalHook,
  LocationRef,
  DisableSupport,
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

export const KILO_CONFIG_FILES = ['kilo.jsonc', 'kilo.json', 'opencode.jsonc', 'opencode.json'] as const;
export const KILO_PROJECT_DIRS = ['.kilo', '.kilocode'] as const;
export const KILO_GLOBAL_CONFIG_FILES = ['kilo.jsonc', 'kilo.json', 'opencode.jsonc', 'opencode.json', 'config.json'] as const;

/**
 * Maps a CanonicalMcpServer to Kilo's local or remote configuration shape.
 */
export function canonicalToKiloMcp(server: CanonicalMcpServer): Record<string, unknown> {
  const isRemote = server.type === 'http' || server.type === 'sse' || (server.type as string) === 'remote';
  const entry: Record<string, unknown> = {};

  if (isRemote) {
    entry.type = 'remote';
    if (server.url) {
      entry.url = server.url;
    }
    if (server.headers && Object.keys(server.headers).length > 0) {
      entry.headers = server.headers;
    }
  } else {
    entry.type = 'local';
    const commandList: string[] = [];
    if (server.command) {
      commandList.push(server.command);
    }
    if (server.args && Array.isArray(server.args)) {
      commandList.push(...server.args);
    }
    entry.command = commandList;
    if (server.env && Object.keys(server.env).length > 0) {
      entry.environment = server.env;
    }
  }

  // Preserve unknown/extra fields (cwd, timeout, enabled, oauth, etc.)
  if (server.extraFields) {
    for (const [k, v] of Object.entries(server.extraFields)) {
      if (!['id', 'type', 'command', 'args', 'url', 'env', 'headers', 'environment'].includes(k)) {
        if (v !== undefined) {
          entry[k] = v;
        }
      }
    }
  }

  return entry;
}

/**
 * Maps a Kilo local or remote configuration shape back to CanonicalMcpServer.
 */
export function kiloToCanonicalMcp(id: string, raw: Record<string, unknown>): CanonicalMcpServer {
  const rawType = raw.type as string | undefined;
  let type: 'stdio' | 'http' | 'sse';

  if (rawType === 'local') {
    type = 'stdio';
  } else if (rawType === 'remote') {
    type = 'http';
  } else if (rawType === 'sse') {
    type = 'sse';
  } else if (rawType === 'stdio') {
    type = 'stdio';
  } else if (rawType === 'http') {
    type = 'http';
  } else if (raw.command) {
    type = 'stdio';
  } else {
    type = 'http';
  }

  let command: string | undefined;
  let args: string[] | undefined;

  if (Array.isArray(raw.command)) {
    const cmdList = raw.command as string[];
    if (cmdList.length > 0) {
      command = cmdList[0];
      if (cmdList.length > 1) {
        args = cmdList.slice(1);
      }
    }
  } else if (typeof raw.command === 'string') {
    command = raw.command;
    if (Array.isArray(raw.args)) {
      args = raw.args as string[];
    }
  }

  let url: string | undefined;
  if (typeof raw.url === 'string') {
    url = raw.url;
  }

  let env: Record<string, string> | undefined;
  const rawEnv = (raw.environment ?? raw.env) as Record<string, string> | undefined;
  if (rawEnv && typeof rawEnv === 'object' && !Array.isArray(rawEnv)) {
    env = rawEnv;
  }

  let headers: Record<string, string> | undefined;
  if (raw.headers && typeof raw.headers === 'object' && !Array.isArray(raw.headers)) {
    headers = raw.headers as Record<string, string>;
  }

  const extraFields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!['id', 'type', 'command', 'args', 'url', 'env', 'headers', 'environment'].includes(k)) {
      extraFields[k] = v;
    }
  }

  return {
    id,
    type,
    ...(command !== undefined ? { command } : {}),
    ...(args !== undefined ? { args } : {}),
    ...(url !== undefined ? { url } : {}),
    ...(env !== undefined ? { env } : {}),
    ...(headers !== undefined ? { headers } : {}),
    extraFields,
  };
}

export class KiloAdapter implements Adapter {
  readonly assistant: AssistantId = 'kilo-code';
  readonly displayName: string = 'Kilo Code';
  readonly iconId: string = 'ai-swissknife-kilo-code';
  readonly disableSupport: DisableSupport = 'verified';

  getDisabledPath(kind: ItemKind, name: string, loc: LocationRef): string | undefined {
    if (kind === 'skill') {
      const activeFile = this.skillPath(name, loc);
      const skillDir = path.dirname(activeFile);
      const activeDir = path.dirname(skillDir);
      const assistantRoot = path.dirname(activeDir);
      return path.join(assistantRoot, '_disabled', path.basename(activeDir), name);
    }
    if (kind === 'agent') {
      const activeFile = this.agentPath(name, loc);
      const activeDir = path.dirname(activeFile);
      const assistantRoot = path.dirname(activeDir);
      const fileName = path.basename(activeFile);
      return path.join(assistantRoot, '_disabled', path.basename(activeDir), fileName);
    }
    if (kind === 'command') {
      const activeFile = this.commandPath(name, loc);
      const activeDir = path.dirname(activeFile);
      const assistantRoot = path.dirname(activeDir);
      const fileName = path.basename(activeFile);
      return path.join(assistantRoot, '_disabled', path.basename(activeDir), fileName);
    }
    return undefined;
  }

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

  legacyMcpConfigPaths(loc: LocationRef): string[] {
    if (loc.scope === 'global') {
      return [path.join(this.getHomedir(), '.config', 'kilo', 'mcp.json')];
    }
    if (loc.scope === 'project') {
      if (!loc.projectRoot) return [];
      return [
        path.join(loc.projectRoot, '.kilo', 'mcp.json'),
        path.join(loc.projectRoot, '.kilocode', 'mcp.json'),
      ];
    }
    return [];
  }

  mcpConfigPath(loc: LocationRef): string {
    if (loc.scope === 'global') {
      const globalDir = path.join(this.getHomedir(), '.config', 'kilo');
      for (const file of KILO_GLOBAL_CONFIG_FILES) {
        const candidate = path.join(globalDir, file);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
      return path.join(globalDir, 'kilo.jsonc');
    }
    if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      for (const dir of KILO_PROJECT_DIRS) {
        for (const file of KILO_CONFIG_FILES) {
          const candidate = path.join(loc.projectRoot, dir, file);
          if (fs.existsSync(candidate)) {
            return candidate;
          }
        }
      }
      for (const file of KILO_CONFIG_FILES) {
        const candidate = path.join(loc.projectRoot, file);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
      return path.join(loc.projectRoot, '.kilo', 'kilo.jsonc');
    }
    throw new Error(`Unsupported scope: ${(loc as { scope: string }).scope}`);
  }

  async readMcpServer(id: string, loc: LocationRef): Promise<CanonicalMcpServer | null> {
    const filePath = this.mcpConfigPath(loc);
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const parsed = jsonc.parse(content);
      if (parsed && typeof parsed === 'object') {
        const mcpBlock = (parsed.mcp ?? parsed.mcpServers) as Record<string, unknown> | undefined;
        if (mcpBlock && typeof mcpBlock === 'object' && mcpBlock[id]) {
          return kiloToCanonicalMcp(id, mcpBlock[id] as Record<string, unknown>);
        }
      }
    } catch {
      // ignore, fall through to legacy
    }

    for (const legacyPath of this.legacyMcpConfigPaths(loc)) {
      try {
        const content = await fs.promises.readFile(legacyPath, 'utf-8');
        const parsed = jsonc.parse(content);
        if (parsed && typeof parsed === 'object') {
          const mcpBlock = (parsed.mcp ?? parsed.mcpServers ?? parsed) as Record<string, unknown>;
          if (mcpBlock && typeof mcpBlock === 'object' && mcpBlock[id]) {
            return kiloToCanonicalMcp(id, mcpBlock[id] as Record<string, unknown>);
          }
        }
      } catch {
        // ignore
      }
    }

    return null;
  }

  async writeMcpServer(server: CanonicalMcpServer, loc: LocationRef): Promise<void> {
    const filePath = this.mcpConfigPath(loc);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

    let content = '';
    try {
      content = await fs.promises.readFile(filePath, 'utf-8');
    } catch {
      content = '';
    }

    if (!content.trim()) {
      content = '{\n}\n';
    }

    const kiloEntry = canonicalToKiloMcp(server);
    const edits = jsonc.modify(content, ['mcp', server.id], kiloEntry, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    });
    const updated = jsonc.applyEdits(content, edits);
    await fs.promises.writeFile(filePath, updated, 'utf-8');
  }

  async removeMcpServer(id: string, loc: LocationRef): Promise<void> {
    const filePath = this.mcpConfigPath(loc);
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const parsed = jsonc.parse(content);
      if (parsed && typeof parsed === 'object') {
        if (parsed.mcp && typeof parsed.mcp === 'object' && id in parsed.mcp) {
          const edits = jsonc.modify(content, ['mcp', id], undefined, {
            formattingOptions: { insertSpaces: true, tabSize: 2 },
          });
          const updated = jsonc.applyEdits(content, edits);
          await fs.promises.writeFile(filePath, updated, 'utf-8');
        } else if (parsed.mcpServers && typeof parsed.mcpServers === 'object' && id in parsed.mcpServers) {
          const edits = jsonc.modify(content, ['mcpServers', id], undefined, {
            formattingOptions: { insertSpaces: true, tabSize: 2 },
          });
          const updated = jsonc.applyEdits(content, edits);
          await fs.promises.writeFile(filePath, updated, 'utf-8');
        }
      }
    } catch {
      // ignore
    }

    for (const legacyPath of this.legacyMcpConfigPaths(loc)) {
      try {
        const content = await fs.promises.readFile(legacyPath, 'utf-8');
        const parsed = JSON.parse(content);
        let changed = false;
        if (parsed.mcp && typeof parsed.mcp === 'object' && !Array.isArray(parsed.mcp) && id in parsed.mcp) {
          delete parsed.mcp[id];
          changed = true;
        }
        if (parsed.mcpServers && typeof parsed.mcpServers === 'object' && !Array.isArray(parsed.mcpServers) && id in parsed.mcpServers) {
          delete parsed.mcpServers[id];
          changed = true;
        }
        if (id in parsed) {
          delete parsed[id];
          changed = true;
        }
        if (changed) {
          await fs.promises.writeFile(legacyPath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
        }
      } catch {
        // ignore
      }
    }
  }

  async listMcpServers(loc: LocationRef): Promise<string[]> {
    const ids = new Set<string>();

    const filePath = this.mcpConfigPath(loc);
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const parsed = jsonc.parse(content);
      if (parsed && typeof parsed === 'object') {
        const mcpBlock = (parsed.mcp ?? parsed.mcpServers) as Record<string, unknown> | undefined;
        if (mcpBlock && typeof mcpBlock === 'object') {
          for (const key of Object.keys(mcpBlock)) {
            ids.add(key);
          }
        }
      }
    } catch {
      // ignore
    }

    for (const legacyPath of this.legacyMcpConfigPaths(loc)) {
      try {
        const content = await fs.promises.readFile(legacyPath, 'utf-8');
        const parsed = jsonc.parse(content);
        if (parsed && typeof parsed === 'object') {
          const mcpBlock = (parsed.mcp ?? parsed.mcpServers ?? parsed) as Record<string, unknown>;
          if (mcpBlock && typeof mcpBlock === 'object') {
            for (const key of Object.keys(mcpBlock)) {
              if (typeof mcpBlock[key] === 'object' && mcpBlock[key] !== null) {
                ids.add(key);
              }
            }
          }
        }
      } catch {
        // ignore
      }
    }

    return Array.from(ids);
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
