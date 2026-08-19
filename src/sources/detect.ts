import * as fs from 'fs';
import * as path from 'path';

import type {
  DetectedSkillDir,
  DetectedAgentFile,
  DetectedCommandFile,
  DetectedMcpServer,
  DetectedHookFile,
  DetectedRuleFile,
  SkillDetectionResult,
  DetectionDiagnostic,
} from './types';

/**
 * Minimal, self-contained frontmatter parser to extract `name` and optional `description` from a markdown file.
 */
export function extractSkillFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return {};
  }
  const yamlBlock = match[1];
  const lines = yamlBlock.split(/\r?\n/);
  let name: string | undefined;
  let description: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const nameMatch = line.match(/^name:\s*(.+)$/);
    if (nameMatch && !name) {
      let val = nameMatch[1].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      name = val;
    }
    const descMatch = line.match(/^description:\s*(.*)$/);
    if (descMatch && !description) {
      let val = descMatch[1].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (val) {
        description = val;
      }
    }
  }

  return { name, description };
}

/**
 * Recursively walks `rootDir` looking for directories that directly contain a SKILL.md file.
 */
export async function findSkillDirs(rootDir: string): Promise<SkillDetectionResult> {
  const resolvedRoot = path.resolve(rootDir);
  const skills: DetectedSkillDir[] = [];
  const diagnostics: DetectionDiagnostic[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (dir === resolvedRoot) {
        throw err;
      }
      diagnostics.push({
        severity: 'error',
        path: dir,
        message: 'Unreadable directory',
        code: 'unreadable-skill',
      });
      return;
    }

    const hasSkillMd = entries.some((e) => e.isFile() && e.name === 'SKILL.md');
    if (hasSkillMd) {
      const skillFilePath = path.join(dir, 'SKILL.md');
      let name = path.basename(dir);
      let description: string | undefined;

      try {
        const content = await fs.promises.readFile(skillFilePath, 'utf-8');
        const frontmatter = extractSkillFrontmatter(content);
        if (frontmatter.name) {
          name = frontmatter.name;
        } else {
          diagnostics.push({
            severity: 'warning',
            path: dir,
            message: 'Missing name in frontmatter, falling back to directory name',
            code: 'invalid-frontmatter',
          });
        }
        description = frontmatter.description;
      } catch {
        diagnostics.push({
          severity: 'error',
          path: dir,
          message: 'Failed to read or parse SKILL.md',
          code: 'unreadable-skill',
        });
        return;
      }

      skills.push({
        path: dir,
        name,
        description,
      });
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') {
          continue;
        }
        await walk(path.join(dir, entry.name));
      }
    }
  }

  await walk(resolvedRoot);
  return { skills, diagnostics };
}

/**
 * Recursively walks `rootDir` looking for agent markdown files (*.agent.md, or *.md inside agents/ / agent/ directories).
 */
export async function findAgentFiles(
  rootDir: string
): Promise<{ agents: DetectedAgentFile[]; diagnostics: DetectionDiagnostic[] }> {
  const resolvedRoot = path.resolve(rootDir);
  const agents: DetectedAgentFile[] = [];
  const diagnostics: DetectionDiagnostic[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') {
          continue;
        }
        await walk(path.join(dir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const fullPath = path.join(dir, entry.name);
        const relDir = path.relative(resolvedRoot, dir).split(path.sep).join('/');

        const isAgentNamed =
          entry.name.endsWith('.agent.md') ||
          relDir === 'agents' ||
          relDir === 'agent' ||
          relDir.endsWith('/agents') ||
          relDir.endsWith('/agent') ||
          relDir.includes('/agents/') ||
          relDir.includes('/agent/');

        if (entry.name.toLowerCase() === 'readme.md' || entry.name === 'SKILL.md') {
          continue;
        }

        if (isAgentNamed) {
          let name = entry.name.replace(/(\.agent)?\.md$/, '');
          let description: string | undefined;

          try {
            const content = await fs.promises.readFile(fullPath, 'utf-8');
            const frontmatter = extractSkillFrontmatter(content);
            if (frontmatter.name) {
              name = frontmatter.name;
            } else {
              diagnostics.push({
                severity: 'warning',
                path: fullPath,
                message: 'Missing name in agent frontmatter, falling back to file name',
                code: 'invalid-frontmatter',
              });
            }
            description = frontmatter.description;
          } catch {
            diagnostics.push({
              severity: 'error',
              path: fullPath,
              message: 'Failed to read agent file',
              code: 'unreadable-skill',
            });
            continue;
          }

          agents.push({
            path: fullPath,
            name,
            description,
          });
        }
      }
    }
  }

  await walk(resolvedRoot);
  return { agents, diagnostics };
}

/**
 * Recursively walks `rootDir` looking for command markdown files (*.command.md, or *.md inside commands/ / command/ directories).
 */
export async function findCommandFiles(
  rootDir: string
): Promise<{ commands: DetectedCommandFile[]; diagnostics: DetectionDiagnostic[] }> {
  const resolvedRoot = path.resolve(rootDir);
  const commands: DetectedCommandFile[] = [];
  const diagnostics: DetectionDiagnostic[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') {
          continue;
        }
        await walk(path.join(dir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const fullPath = path.join(dir, entry.name);
        const relDir = path.relative(resolvedRoot, dir).split(path.sep).join('/');

        const isCommandNamed =
          entry.name.endsWith('.command.md') ||
          relDir === 'commands' ||
          relDir === 'command' ||
          relDir.endsWith('/commands') ||
          relDir.endsWith('/command') ||
          relDir.includes('/commands/') ||
          relDir.includes('/command/');

        if (entry.name.toLowerCase() === 'readme.md' || entry.name === 'SKILL.md') {
          continue;
        }

        if (isCommandNamed) {
          let name = entry.name.replace(/(\.command)?\.md$/, '');
          let description: string | undefined;

          try {
            const content = await fs.promises.readFile(fullPath, 'utf-8');
            const frontmatter = extractSkillFrontmatter(content);
            if (frontmatter.name) {
              name = frontmatter.name;
            }
            description = frontmatter.description;
          } catch {
            diagnostics.push({
              severity: 'error',
              path: fullPath,
              message: 'Failed to read command file',
              code: 'unreadable-skill',
            });
            continue;
          }

          commands.push({
            path: fullPath,
            name,
            description,
          });
        }
      }
    }
  }

  await walk(resolvedRoot);
  return { commands, diagnostics };
}

/**
 * Scans `rootDir` for MCP configuration files (mcp.json, .mcp.json, mcps/*.json).
 */
export async function findMcpDefinitions(
  rootDir: string
): Promise<{ mcpServers: DetectedMcpServer[]; diagnostics: DetectionDiagnostic[] }> {
  const resolvedRoot = path.resolve(rootDir);
  const mcpServers: DetectedMcpServer[] = [];
  const diagnostics: DetectionDiagnostic[] = [];

  const candidateFiles = [
    path.join(resolvedRoot, 'mcp.json'),
    path.join(resolvedRoot, '.mcp.json'),
  ];

  const mcpsDir = path.join(resolvedRoot, 'mcps');
  if (fs.existsSync(mcpsDir) && fs.statSync(mcpsDir).isDirectory()) {
    try {
      const entries = await fs.promises.readdir(mcpsDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith('.json')) {
          candidateFiles.push(path.join(mcpsDir, e.name));
        }
      }
    } catch {
      // ignore
    }
  }

  for (const filePath of candidateFiles) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      try {
        const raw = await fs.promises.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        const map = (parsed.mcpServers ?? parsed.mcp ?? (parsed.command || parsed.url ? { [path.basename(filePath, '.json')]: parsed } : {})) as Record<string, Record<string, unknown>>;

        for (const [id, conf] of Object.entries(map)) {
          if (conf && typeof conf === 'object') {
            mcpServers.push({
              id,
              type: String(conf.type ?? (conf.command ? 'stdio' : 'sse')),
              command: conf.command ? String(conf.command) : undefined,
              url: conf.url ? String(conf.url) : undefined,
              description: conf.description ? String(conf.description) : undefined,
              path: filePath,
            });
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        diagnostics.push({
          severity: 'error',
          path: filePath,
          message: `Failed to parse MCP JSON: ${msg}`,
          code: 'invalid-frontmatter',
        });
      }
    }
  }

  return { mcpServers, diagnostics };
}

/**
 * Scans `rootDir` for hook configuration files (hooks/*.json or *.hook.json).
 */
export async function findHookFiles(
  rootDir: string
): Promise<{ hooks: DetectedHookFile[]; diagnostics: DetectionDiagnostic[] }> {
  const resolvedRoot = path.resolve(rootDir);
  const hooks: DetectedHookFile[] = [];
  const diagnostics: DetectionDiagnostic[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        await walk(path.join(dir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        const fullPath = path.join(dir, entry.name);
        const relDir = path.relative(resolvedRoot, dir).split(path.sep).join('/');

        const isHook =
          entry.name.endsWith('.hook.json') ||
          relDir === 'hooks' ||
          relDir.endsWith('/hooks') ||
          relDir.includes('/hooks/');

        if (isHook) {
          try {
            const raw = await fs.promises.readFile(fullPath, 'utf-8');
            const parsed = JSON.parse(raw);
            const name = entry.name.replace(/(\.hook)?\.json$/, '');
            hooks.push({
              name,
              event: parsed.event ?? 'PreToolUse',
              command: parsed.command ?? '',
              timeout: parsed.timeout,
              path: fullPath,
            });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            diagnostics.push({
              severity: 'error',
              path: fullPath,
              message: `Failed to parse hook JSON: ${msg}`,
              code: 'invalid-frontmatter',
            });
          }
        }
      }
    }
  }

  await walk(resolvedRoot);
  return { hooks, diagnostics };
}

/**
 * Scans `rootDir` for rule / instructions files (rules/*.md).
 */
export async function findRuleFiles(
  rootDir: string
): Promise<{ rules: DetectedRuleFile[]; diagnostics: DetectionDiagnostic[] }> {
  const resolvedRoot = path.resolve(rootDir);
  const rules: DetectedRuleFile[] = [];
  const diagnostics: DetectionDiagnostic[] = [];

  const rulesDir = path.join(resolvedRoot, 'rules');
  if (fs.existsSync(rulesDir) && fs.statSync(rulesDir).isDirectory()) {
    try {
      const entries = await fs.promises.readdir(rulesDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith('.md')) {
          const fullPath = path.join(rulesDir, e.name);
          const content = await fs.promises.readFile(fullPath, 'utf-8');
          rules.push({
            name: e.name.replace(/\.md$/, ''),
            content,
            path: fullPath,
          });
        }
      }
    } catch {
      // ignore
    }
  }

  return { rules, diagnostics };
}
