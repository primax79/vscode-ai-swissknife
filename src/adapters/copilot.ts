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
import {
  parseClaudeAgentMarkdown,
  serializeClaudeAgentMarkdown,
  parseClaudeCommandMarkdown,
  serializeClaudeCommandMarkdown,
} from './claude';

export class CopilotAdapter implements Adapter {
  readonly assistant: AssistantId = 'github-copilot';
  readonly displayName: string = 'GitHub Copilot';
  readonly iconId: string = 'ai-swissknife-github-copilot';

  constructor(private readonly getHomedir: () => string = os.homedir) {}

  skillDir(name: string, loc: LocationRef): string {
    return path.dirname(this.skillPath(name, loc));
  }

  skillPath(name: string, loc: LocationRef): string {
    if (loc.scope === 'global') {
      return path.join(this.getHomedir(), '.copilot', 'skills', name, 'SKILL.md');
    }
    if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      return path.join(loc.projectRoot, '.github', 'skills', name, 'SKILL.md');
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
      skillsDir = path.join(this.getHomedir(), '.copilot', 'skills');
    } else if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      skillsDir = path.join(loc.projectRoot, '.github', 'skills');
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
    const baseName = name.replace(/(\.agent)?\.md$/, '');
    const fileName = `${baseName}.agent.md`;
    if (loc.scope === 'global') {
      return path.join(this.getHomedir(), '.copilot', 'agents', fileName);
    }
    if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      return path.join(loc.projectRoot, '.github', 'agents', fileName);
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
      dir = path.join(this.getHomedir(), '.copilot', 'agents');
    } else if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      dir = path.join(loc.projectRoot, '.github', 'agents');
    } else {
      throw new Error(`Unsupported scope: ${(loc as { scope: string }).scope}`);
    }

    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      return entries
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => e.name.replace(/(\.agent)?\.md$/, ''));
    } catch {
      return [];
    }
  }

  commandPath(name: string, loc: LocationRef): string {
    const baseName = name.replace(/(\.prompt)?\.md$/, '');
    const fileName = `${baseName}.prompt.md`;
    if (loc.scope === 'global') {
      return path.join(this.getHomedir(), '.copilot', 'prompts', fileName);
    }
    if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      return path.join(loc.projectRoot, '.github', 'prompts', fileName);
    }
    throw new Error(`Unsupported scope: ${(loc as { scope: string }).scope}`);
  }

  async readCommand(name: string, loc: LocationRef): Promise<CanonicalCommand | null> {
    const filePath = this.commandPath(name, loc);
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return parseClaudeCommandMarkdown(content, name);
    } catch {
      return null;
    }
  }

  async writeCommand(command: CanonicalCommand, loc: LocationRef): Promise<void> {
    const filePath = this.commandPath(command.name, loc);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const serialized = serializeClaudeCommandMarkdown(command);
    await fs.promises.writeFile(filePath, serialized, 'utf-8');
  }

  async listCommands(loc: LocationRef): Promise<string[]> {
    let dir: string;
    if (loc.scope === 'global') {
      dir = path.join(this.getHomedir(), '.copilot', 'prompts');
    } else if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      dir = path.join(loc.projectRoot, '.github', 'prompts');
    } else {
      throw new Error(`Unsupported scope: ${(loc as { scope: string }).scope}`);
    }

    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      return entries
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => e.name.replace(/(\.prompt)?\.md$/, ''));
    } catch {
      return [];
    }
  }

  mcpConfigPath(loc: LocationRef): string {
    if (loc.scope === 'global') {
      return path.join(this.getHomedir(), '.copilot', 'mcp.json');
    }
    if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      return path.join(loc.projectRoot, '.vscode', 'mcp.json');
    }
    throw new Error(`Unsupported scope: ${(loc as { scope: string }).scope}`);
  }

  async readMcpServer(id: string, loc: LocationRef): Promise<CanonicalMcpServer | null> {
    const filePath = this.mcpConfigPath(loc);
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      const mcpBlock = parsed.mcpServers ?? parsed.servers ?? parsed;
      const conf = mcpBlock[id] as Record<string, unknown> | undefined;
      if (!conf) return null;

      const type: 'stdio' | 'http' | 'sse' = (conf.type as 'stdio' | 'http' | 'sse') ?? (conf.command ? 'stdio' : 'sse');
      const extraFields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(conf)) {
        if (!['id', 'type', 'command', 'args', 'url', 'env', 'headers'].includes(k)) {
          extraFields[k] = v;
        }
      }

      return {
        id,
        type,
        ...(conf.command ? { command: String(conf.command) } : {}),
        ...(Array.isArray(conf.args) ? { args: conf.args.map(String) } : {}),
        ...(conf.url ? { url: String(conf.url) } : {}),
        ...(conf.env ? { env: conf.env as Record<string, string> } : {}),
        ...(conf.headers ? { headers: conf.headers as Record<string, string> } : {}),
        extraFields,
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

    if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object' || Array.isArray(parsed.mcpServers)) {
      parsed.mcpServers = {};
    }

    const mcpServers = parsed.mcpServers as Record<string, unknown>;
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
        if (!entry[k] && k !== 'id' && k !== 'type') {
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
    } else if (parsed.servers && typeof parsed.servers === 'object' && !Array.isArray(parsed.servers)) {
      const servers = parsed.servers as Record<string, unknown>;
      if (id in servers) {
        delete servers[id];
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
      }
    } else if (id in parsed) {
      delete parsed[id];
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
    }
  }

  async listMcpServers(loc: LocationRef): Promise<string[]> {
    const filePath = this.mcpConfigPath(loc);
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      const mcpBlock = parsed.mcpServers ?? parsed.servers ?? {};
      return Object.keys(mcpBlock);
    } catch {
      return [];
    }
  }

  hookPath(name: string, loc: LocationRef): string {
    const fileName = name.endsWith('.json') ? name : `${name}.json`;
    if (loc.scope === 'global') {
      return path.join(this.getHomedir(), '.copilot', 'hooks', fileName);
    }
    if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      return path.join(loc.projectRoot, '.github', 'hooks', fileName);
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
    let dir: string;
    if (loc.scope === 'global') {
      dir = path.join(this.getHomedir(), '.copilot', 'hooks');
    } else if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      dir = path.join(loc.projectRoot, '.github', 'hooks');
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
      return path.join(this.getHomedir(), '.copilot', 'copilot-instructions.md');
    }
    if (loc.scope === 'project') {
      if (!loc.projectRoot) {
        throw new Error('projectRoot is required when scope is "project"');
      }
      return path.join(loc.projectRoot, '.github', 'copilot-instructions.md');
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

export const copilotAdapter = new CopilotAdapter();
