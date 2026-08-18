import * as fs from 'fs';
import * as path from 'path';

export interface DetectedSkillDir {
  path: string; // absolute path to the directory containing SKILL.md
  name: string; // from SKILL.md frontmatter, not the directory name — they can differ
  description?: string;
}

/**
 * Minimal, self-contained frontmatter parser to extract `name` and optional `description` from a SKILL.md file.
 * (Note: When task 03.2 lands, this can be consolidated with the Claude adapter's frontmatter helper).
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
 *
 * Rules:
 * - Stops recursing into a directory once it is identified as a skill directory.
 * - Skips node_modules, .git, and any dotfile-prefixed directory during the walk.
 * - Extracts `name` from SKILL.md frontmatter (falling back to directory basename if missing).
 */
export async function findSkillDirs(rootDir: string): Promise<DetectedSkillDir[]> {
  const resolvedRoot = path.resolve(rootDir);
  const results: DetectedSkillDir[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
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
        }
        description = frontmatter.description;
      } catch {
        // Fallback to directory basename if reading fails
      }

      results.push({
        path: dir,
        name,
        description,
      });
      // Stop recursing into subdirectories once identified as a skill directory
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
          continue;
        }
        await walk(path.join(dir, entry.name));
      }
    }
  }

  await walk(resolvedRoot);
  return results;
}
