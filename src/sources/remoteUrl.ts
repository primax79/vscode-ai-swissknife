import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Source, Package, Artifact, ResolvedArtifact, ItemKind } from '../domain/types';
import type {
  CanonicalSkill,
  CanonicalAgent,
  CanonicalCommand,
  CanonicalMcpServer,
  CanonicalHook,
  CanonicalRule,
} from '../adapters/types';
import type { SourceResolution, SourceResolver } from './types';
import { parseClaudeAgentMarkdown, parseClaudeCommandMarkdown } from '../adapters/claude';
import { extractSkillFrontmatter } from './detect';

/**
 * Resolves a `Source` of type `remote-url` by downloading the raw URL content over HTTP(S).
 */
export async function resolveRemoteUrl(
  source: Source,
  opts?: { cacheDir?: string }
): Promise<SourceResolution> {
  if (!source.url || source.url.trim() === '') {
    throw new Error(`source.url is required for remote-url source "${source.id}"`);
  }

  const baseCacheDir = opts?.cacheDir ?? path.join(os.homedir(), '.ai-swissknife', 'cache', 'remote');
  const sanitizedId = source.id.replace(/[^a-zA-Z0-9._-]/g, '_');
  const targetDir = path.join(baseCacheDir, sanitizedId);
  await fs.promises.mkdir(targetDir, { recursive: true });

  const fileName = path.basename(new URL(source.url).pathname) || 'artifact.md';
  const targetFilePath = path.join(targetDir, fileName);

  let rawContent: string;
  try {
    if (source.url.startsWith('file://')) {
      const localFilePath = new URL(source.url).pathname;
      rawContent = await fs.promises.readFile(localFilePath, 'utf-8');
      await fs.promises.writeFile(targetFilePath, rawContent, 'utf-8');
    } else {
      const res = await fetch(source.url);
      if (!res.ok) {
        throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
      }
      rawContent = await res.text();
      await fs.promises.writeFile(targetFilePath, rawContent, 'utf-8');
    }
  } catch (err: unknown) {
    if (fs.existsSync(targetFilePath)) {
      rawContent = await fs.promises.readFile(targetFilePath, 'utf-8');
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to fetch remote URL "${source.url}": ${msg}`);
    }
  }

  let kind: ItemKind = 'skill';
  let name = source.name ?? path.basename(fileName, path.extname(fileName));
  let description = '';

  if (fileName.endsWith('.json')) {
    kind = 'mcp-server';
  } else {
    const fm = extractSkillFrontmatter(rawContent);
    if (fm.name) name = fm.name;
    if (fm.description) description = fm.description;
    kind = fileName.includes('agent') ? 'agent' : fileName.includes('prompt') || fileName.includes('command') ? 'command' : 'skill';
  }

  const packageId = `${source.id}:${name}`;
  const artifactId = `${packageId}:${name}`;

  const artifact: Artifact = {
    id: artifactId,
    packageId,
    kind,
    name,
    description,
    nativeFormat: `claude-${kind}`,
    path: targetFilePath,
  };

  const pkg: Package = {
    id: packageId,
    sourceId: source.id,
    nativeFormat: `claude-${kind}`,
    artifacts: [artifact],
  };

  return {
    packages: [pkg],
    diagnostics: [],
  };
}

/**
 * Resolves content for a remote-url artifact from cache.
 */
export async function resolveArtifactContent(
  source: Source,
  pkg: Package,
  artifact: Artifact,
  opts?: { cacheDir?: string }
): Promise<ResolvedArtifact<CanonicalSkill | CanonicalAgent | CanonicalCommand | CanonicalMcpServer | CanonicalHook | CanonicalRule>> {
  const baseCacheDir = opts?.cacheDir ?? path.join(os.homedir(), '.ai-swissknife', 'cache', 'remote');
  const sanitizedId = source.id.replace(/[^a-zA-Z0-9._-]/g, '_');
  const targetDir = path.join(baseCacheDir, sanitizedId);
  const fileName = path.basename(new URL(source.url!).pathname) || 'artifact.md';
  const targetFilePath = path.join(targetDir, fileName);

  const raw = await fs.promises.readFile(targetFilePath, 'utf-8');

  if (artifact.kind === 'skill') {
    const fm = extractSkillFrontmatter(raw);
    const content: CanonicalSkill = {
      name: artifact.name,
      description: fm.description ?? '',
      body: raw.replace(/^---[\s\S]*?---/, '').trim(),
      extraFields: {},
      files: [],
    };
    return { artifact, content };
  }

  if (artifact.kind === 'agent') {
    const content = parseClaudeAgentMarkdown(raw);
    return { artifact, content };
  }

  if (artifact.kind === 'command') {
    const content = parseClaudeCommandMarkdown(raw, artifact.name);
    return { artifact, content };
  }

  if (artifact.kind === 'mcp-server') {
    const parsed = JSON.parse(raw);
    const serverConfig = parsed.mcpServers?.[artifact.name] ?? parsed;
    const content: CanonicalMcpServer = {
      id: artifact.name,
      type: serverConfig.type ?? (serverConfig.command ? 'stdio' : 'sse'),
      command: serverConfig.command,
      args: serverConfig.args,
      url: serverConfig.url,
      env: serverConfig.env,
      headers: serverConfig.headers,
      extraFields: { ...serverConfig },
    };
    return { artifact, content };
  }

  if (artifact.kind === 'rule') {
    const content: CanonicalRule = {
      name: artifact.name,
      content: raw,
    };
    return { artifact, content };
  }

  throw new Error(`Unsupported artifact kind for remote-url: ${artifact.kind}`);
}

export const remoteUrlResolver: SourceResolver = {
  type: 'remote-url',
  displayName: 'Remote URL',
  iconThemeId: 'link',
  resolve: resolveRemoteUrl,
  resolveArtifactContent,
};

