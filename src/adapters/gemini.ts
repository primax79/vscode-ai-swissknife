import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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
import { parseClaudeAgentMarkdown, serializeClaudeAgentMarkdown } from './claude';

export class GeminiAdapter implements Adapter {
  readonly assistant: AssistantId = 'gemini-cli';
  readonly displayName: string = 'Gemini CLI';
  readonly iconId: string = 'ai-swissknife-gemini-cli';
  readonly disableSupport: DisableSupport = 'unsupported';

  getDisabledPath(_kind: ItemKind, _name: string, _loc: LocationRef): string | undefined {
    return undefined;
  }

  getDisabledRoot(_kind: ItemKind, _loc: LocationRef): string | undefined {
    return undefined;
  }

  constructor(private readonly getHomedir: () => string = os.homedir) {}

  skillDir(name: string, loc: LocationRef): string {
    return path.dirname(this.skillPath(name, loc));
  }

  skillPath(name: string, loc: LocationRef): string {
    if (loc.scope === 'global') {
      return path.join(this.getHomedir(), '.gemini', 'skills', name, 'SKILL.md');
    }
    if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      return path.join(loc.projectRoot, '.gemini', 'skills', name, 'SKILL.md');
    }
    throw new Error(`Unsupported scope: ${(loc as { scope: string }).scope}`);
  }

  async readSkill(name: string, loc: LocationRef): Promise<CanonicalSkill | null> {
    const filePath = this.skillPath(name, loc);
    const dir = path.dirname(filePath);
    try {
      return await codecReadSkill(dir);
    } catch {
      return null;
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
      skillsDir = path.join(this.getHomedir(), '.gemini', 'skills');
    } else if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      skillsDir = path.join(loc.projectRoot, '.gemini', 'skills');
    } else {
      throw new Error(`Unsupported scope: ${(loc as { scope: string }).scope}`);
    }

    try {
      const entries = await fs.promises.readdir(skillsDir, { withFileTypes: true });
      const names: string[] = [];
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
          if (fs.existsSync(skillFile)) {
            names.push(entry.name);
          }
        }
      }
      return names;
    } catch {
      return [];
    }
  }

  agentPath(name: string, loc: LocationRef): string {
    const fileName = name.endsWith('.md') ? name : `${name}.md`;
    if (loc.scope === 'global') {
      return path.join(this.getHomedir(), '.gemini', 'agents', fileName);
    }
    if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      return path.join(loc.projectRoot, '.gemini', 'agents', fileName);
    }
    throw new Error(`Unsupported scope: ${(loc as { scope: string }).scope}`);
  }

  async readAgent(name: string, loc: LocationRef): Promise<CanonicalAgent | null> {
    const filePath = this.agentPath(name, loc);
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return parseClaudeAgentMarkdown(content);
    } catch {
      return null;
    }
  }

  async writeAgent(agent: CanonicalAgent, loc: LocationRef): Promise<void> {
    const filePath = this.agentPath(agent.name, loc);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const serialized = serializeClaudeAgentMarkdown(agent);
    await fs.promises.writeFile(filePath, serialized, 'utf-8');
  }

  async listAgents(loc: LocationRef): Promise<string[]> {
    let dir: string;
    if (loc.scope === 'global') {
      dir = path.join(this.getHomedir(), '.gemini', 'agents');
    } else if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      dir = path.join(loc.projectRoot, '.gemini', 'agents');
    } else {
      throw new Error(`Unsupported scope: ${(loc as { scope: string }).scope}`);
    }

    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      return entries
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => e.name.replace(/\.md$/, ''));
    } catch {
      return [];
    }
  }

  commandPath(name: string, loc: LocationRef): string {
    const baseName = name.replace(/\.toml$/, '').replace(/\//g, ':');
    const fileName = `${baseName}.toml`;
    if (loc.scope === 'global') {
      return path.join(this.getHomedir(), '.gemini', 'commands', fileName);
    }
    if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      return path.join(loc.projectRoot, '.gemini', 'commands', fileName);
    }
    throw new Error(`Unsupported scope: ${(loc as { scope: string }).scope}`);
  }

  async readCommand(name: string, loc: LocationRef): Promise<CanonicalCommand | null> {
    const filePath = this.commandPath(name, loc);
    try {
      const raw = await fs.promises.readFile(filePath, 'utf-8');
      const lines = raw.split(/\r?\n/);
      let description = '';
      let body = '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('description =')) {
          description = trimmed.replace(/^description\s*=\s*["']?([^"']*)["']?$/, '$1');
        } else if (trimmed.startsWith('prompt =')) {
          body = trimmed.replace(/^prompt\s*=\s*["']?([^"']*)["']?$/, '$1');
        }
      }

      return {
        name,
        description,
        body,
        extraFields: {},
      };
    } catch {
      return null;
    }
  }

  async writeCommand(command: CanonicalCommand, loc: LocationRef): Promise<void> {
    const filePath = this.commandPath(command.name, loc);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    let toml = `description = ${JSON.stringify(command.description)}\n`;
    toml += `prompt = ${JSON.stringify(command.body)}\n`;
    await fs.promises.writeFile(filePath, toml, 'utf-8');
  }

  async listCommands(loc: LocationRef): Promise<string[]> {
    let dir: string;
    if (loc.scope === 'global') {
      dir = path.join(this.getHomedir(), '.gemini', 'commands');
    } else if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      dir = path.join(loc.projectRoot, '.gemini', 'commands');
    } else {
      throw new Error(`Unsupported scope: ${(loc as { scope: string }).scope}`);
    }

    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      return entries
        .filter((e) => e.isFile() && e.name.endsWith('.toml'))
        .map((e) => e.name.replace(/\.toml$/, ''));
    } catch {
      return [];
    }
  }

  mcpConfigPath(loc: LocationRef): string {
    if (loc.scope === 'global') {
      return path.join(this.getHomedir(), '.gemini', 'settings.json');
    }
    if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      return path.join(loc.projectRoot, '.gemini', 'settings.json');
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
      return {
        id,
        type,
        ...(conf.command ? { command: conf.command } : {}),
        ...(conf.args ? { args: conf.args } : {}),
        ...(conf.url ? { url: conf.url } : {}),
        ...(conf.env ? { env: conf.env } : {}),
        ...(conf.headers ? { headers: conf.headers } : {}),
        extraFields: { ...conf },
      };
    } catch {
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

    if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
      parsed.mcpServers = {};
    }
    const mcpServers = parsed.mcpServers as Record<string, unknown>;
    mcpServers[server.id] = {
      type: server.type,
      ...(server.command ? { command: server.command } : {}),
      ...(server.args ? { args: server.args } : {}),
      ...(server.url ? { url: server.url } : {}),
      ...(server.env ? { env: server.env } : {}),
    };

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
      return path.join(this.getHomedir(), '.gemini', 'hooks', fileName);
    }
    if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      return path.join(loc.projectRoot, '.gemini', 'hooks', fileName);
    }
    throw new Error(`Unsupported scope: ${(loc as { scope: string }).scope}`);
  }

  async readHook(name: string, loc: LocationRef): Promise<CanonicalHook | null> {
    const filePath = this.hookPath(name, loc);
    try {
      const raw = await fs.promises.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
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
    let dir: string;
    if (loc.scope === 'global') {
      dir = path.join(this.getHomedir(), '.gemini', 'hooks');
    } else if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      dir = path.join(loc.projectRoot, '.gemini', 'hooks');
    } else {
      throw new Error(`Unsupported scope: ${(loc as { scope: string }).scope}`);
    }

    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      return entries
        .filter((e) => e.isFile() && e.name.endsWith('.json'))
        .map((e) => e.name.replace(/\.json$/, ''));
    } catch {
      return [];
    }
  }

  rulePath(loc: LocationRef): string {
    if (loc.scope === 'global') {
      return path.join(this.getHomedir(), '.gemini', 'GEMINI.md');
    }
    if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      return path.join(loc.projectRoot, 'GEMINI.md');
    }
    throw new Error(`Unsupported scope: ${(loc as { scope: string }).scope}`);
  }

  async readRule(loc: LocationRef): Promise<CanonicalRule | null> {
    const filePath = this.rulePath(loc);
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return { content };
    } catch {
      return null;
    }
  }

  async writeRule(rule: CanonicalRule, loc: LocationRef): Promise<void> {
    const filePath = this.rulePath(loc);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, rule.content, 'utf-8');
  }
}

export const geminiAdapter = new GeminiAdapter();
