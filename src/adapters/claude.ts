import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AssistantId } from '../domain/types';
import type { Adapter, CanonicalRule, CanonicalSkill, LocationRef } from './types';

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
 * Parses markdown content with YAML frontmatter into a CanonicalSkill.
 */
export function parseSkillMarkdown(content: string): CanonicalSkill {
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
 * Serializes a CanonicalSkill into markdown with YAML frontmatter.
 */
export function serializeSkillMarkdown(skill: CanonicalSkill): string {
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

export class ClaudeAdapter implements Adapter {
  readonly assistant: AssistantId = 'claude-code';

  constructor(private readonly getHomedir: () => string = os.homedir) {}

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
    let rawContent: string;
    try {
      rawContent = await fs.promises.readFile(filePath, 'utf-8');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
    return parseSkillMarkdown(rawContent);
  }

  async writeSkill(skill: CanonicalSkill, loc: LocationRef): Promise<void> {
    const filePath = this.skillPath(skill.name, loc);
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    const content = serializeSkillMarkdown(skill);
    await fs.promises.writeFile(filePath, content, 'utf-8');
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
          // Not a valid skill directory if SKILL.md is missing or unreadable
        }
      }
    }
    return skillNames;
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
