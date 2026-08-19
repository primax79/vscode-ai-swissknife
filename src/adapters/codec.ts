import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { parseSkillMarkdown, serializeSkillMarkdown } from './claude';
import type { CanonicalSkill, CanonicalSkillFile, CanonicalAgent } from './types';

function toPosixPath(p: string): string {
  return p.split(path.sep).join('/');
}

function isValidRelativePath(p: string): boolean {
  if (!p || p === '.' || p === 'SKILL.md') return false;
  if (path.isAbsolute(p)) return false;
  if (p.includes('\0')) return false;

  const posixPath = toPosixPath(p);
  const segments = posixPath.split('/');

  for (const seg of segments) {
    if (seg === '..') return false;
  }

  const resolved = path.posix.resolve('/root', posixPath);
  if (!resolved.startsWith('/root/') || resolved === '/root/SKILL.md' || resolved === '/root') {
    return false;
  }

  return true;
}

export async function readSkill(skillDir: string): Promise<CanonicalSkill> {
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  const skillMdContent = await fs.promises.readFile(skillMdPath, 'utf-8');
  const doc = parseSkillMarkdown(skillMdContent);

  const files: CanonicalSkillFile[] = [];

  async function walk(currentDir: string, relativeRoot: string) {
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);
      const relPath = relativeRoot === '' ? entry.name : path.posix.join(relativeRoot, entry.name);

      if (relPath === 'SKILL.md') continue;

      const stat = await fs.promises.lstat(fullPath);

      if (stat.isSymbolicLink() || stat.isSocket() || stat.isFIFO() || stat.isBlockDevice() || stat.isCharacterDevice()) {
        throw new Error(`Unsupported file type at ${fullPath}`);
      }

      if (stat.isDirectory()) {
        await walk(fullPath, relPath);
      } else if (stat.isFile()) {
        if (!isValidRelativePath(relPath)) {
          throw new Error(`Invalid path: ${relPath}`);
        }

        try {
          await fs.promises.access(fullPath, fs.constants.R_OK);
          const content = await fs.promises.readFile(fullPath);
          files.push({
            path: relPath,
            content,
            mode: stat.mode,
          });
        } catch (err) {
          throw new Error(`Unreadable file at ${fullPath}: ${err}`);
        }
      }
    }
  }

  await walk(skillDir, '');

  const seenPaths = new Set<string>();
  for (const f of files) {
    const norm = path.posix.normalize(f.path);
    if (seenPaths.has(norm)) {
      throw new Error(`Duplicate normalized path: ${norm}`);
    }
    seenPaths.add(norm);
  }

  return {
    ...doc,
    files,
  };
}

export async function writeSkill(skill: CanonicalSkill, skillDir: string): Promise<void> {
  await fs.promises.mkdir(skillDir, { recursive: true });

  const docContent = serializeSkillMarkdown(skill);
  await fs.promises.writeFile(path.join(skillDir, 'SKILL.md'), docContent, 'utf-8');

  const seenPaths = new Set<string>();

  for (const file of skill.files) {
    const posixPath = toPosixPath(file.path);
    if (!isValidRelativePath(posixPath)) {
      throw new Error(`Invalid path: ${posixPath}`);
    }

    const norm = path.posix.normalize(posixPath);
    if (seenPaths.has(norm)) {
      throw new Error(`Duplicate normalized path: ${norm}`);
    }
    seenPaths.add(norm);

    const targetPath = path.join(skillDir, norm);
    if (!targetPath.startsWith(path.resolve(skillDir) + path.sep)) {
      throw new Error(`Path breaks out of skill directory: ${targetPath}`);
    }

    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.promises.writeFile(targetPath, file.content);
    if (file.mode !== undefined) {
      await fs.promises.chmod(targetPath, file.mode);
    }
  }
}

export function canonicalSkillHash(skill: CanonicalSkill): string {
  const hash = crypto.createHash('sha256');

  hash.update('name:');
  hash.update(skill.name);
  hash.update('\n');

  hash.update('description:');
  hash.update(skill.description);
  hash.update('\n');

  hash.update('body:');
  hash.update(skill.body);
  hash.update('\n');

  hash.update('extraFields:\n');
  const extraKeys = Object.keys(skill.extraFields).sort();
  for (const key of extraKeys) {
    hash.update(`${key}:`);
    hash.update(JSON.stringify(skill.extraFields[key]));
    hash.update('\n');
  }

  hash.update('files:\n');
  const sortedFiles = [...skill.files].sort((a, b) => {
    const normA = path.posix.normalize(toPosixPath(a.path));
    const normB = path.posix.normalize(toPosixPath(b.path));
    return normA.localeCompare(normB);
  });

  for (const file of sortedFiles) {
    hash.update('path:');
    hash.update(path.posix.normalize(toPosixPath(file.path)));
    hash.update('\n');
    hash.update('content:');
    hash.update(file.content);
    hash.update('\n');
    hash.update('mode:');
    hash.update(file.mode !== undefined ? file.mode.toString(8) : 'default');
    hash.update('\n');
  }

  return hash.digest('hex');
}

export function canonicalAgentHash(agent: CanonicalAgent): string {
  const hash = crypto.createHash('sha256');

  hash.update('name:');
  hash.update(agent.name);
  hash.update('\n');

  hash.update('description:');
  hash.update(agent.description);
  hash.update('\n');

  if (agent.mode) {
    hash.update(`mode:${agent.mode}\n`);
  }

  hash.update('tools:\n');
  const sortedTools = [...agent.tools].sort();
  for (const t of sortedTools) {
    hash.update(`${t}\n`);
  }

  hash.update('permissions:\n');
  const sortedPermKeys = Object.keys(agent.permissions).sort();
  for (const k of sortedPermKeys) {
    hash.update(`${k}:${agent.permissions[k]}\n`);
  }

  if (agent.model) {
    hash.update(`model:${agent.model}\n`);
  }
  if (agent.variant) {
    hash.update(`variant:${agent.variant}\n`);
  }

  hash.update('body:\n');
  hash.update(agent.body);
  hash.update('\n');

  hash.update('extraFields:\n');
  const extraKeys = Object.keys(agent.extraFields).sort();
  for (const key of extraKeys) {
    hash.update(`${key}:${JSON.stringify(agent.extraFields[key])}\n`);
  }

  return hash.digest('hex');
}
