import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Source, ManagedInstallation } from './types';

export interface RegistryFile {
  sources: Source[];
  installations: ManagedInstallation[];
}

export function emptyRegistry(): RegistryFile {
  return { sources: [], installations: [] };
}

export function registryPath(scope: 'global' | 'project', projectRoot?: string): string {
  // global: os.homedir() + '/.ai-toolkit/registry.json'
  // project: requires projectRoot; projectRoot + '/.ai-toolkit/registry.json'
  // throw a clear Error if scope === 'project' and projectRoot is missing —
  // do not silently fall back to global.
  if (scope === 'global') {
    return path.join(os.homedir(), '.ai-toolkit', 'registry.json');
  }

  if (scope === 'project') {
    if (!projectRoot) {
      throw new Error('projectRoot is required when scope is "project"');
    }
    return path.join(projectRoot, '.ai-toolkit', 'registry.json');
  }

  throw new Error(`Unsupported scope: ${scope}`);
}

export async function readRegistry(scope: 'global' | 'project', projectRoot?: string): Promise<RegistryFile> {
  // if the file doesn't exist yet, return emptyRegistry() — this is the
  // normal first-run state, not an error condition.
  // if the file exists but fails to JSON.parse, throw a clear Error
  // naming the file path — do not silently treat a corrupt file as empty,
  // that would silently discard a user's existing registry.
  const filePath = registryPath(scope, projectRoot);

  let rawContent: string;
  try {
    rawContent = await fs.promises.readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyRegistry();
    }
    throw err;
  }

  try {
    const parsed = JSON.parse(rawContent) as RegistryFile;
    return {
      sources: Array.isArray(parsed?.sources) ? parsed.sources : [],
      installations: Array.isArray(parsed?.installations) ? parsed.installations : [],
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse registry JSON at ${filePath}: ${message}`);
  }
}

export async function writeRegistry(
  scope: 'global' | 'project',
  data: RegistryFile,
  projectRoot?: string
): Promise<void> {
  // atomic write: write to `<path>.tmp-<random>`, then fs.rename() over
  // the real path (rename is atomic on the same filesystem — this is the
  // "atomic and recoverable" requirement from SPEC.md §2 "apply", reused
  // here for the simpler registry-write case).
  // ensure the parent directory exists first (fs.mkdir with recursive:
  // true) — the global `~/.ai-toolkit/` directory won't exist on a fresh
  // machine.
  const filePath = registryPath(scope, projectRoot);
  const parentDir = path.dirname(filePath);

  await fs.promises.mkdir(parentDir, { recursive: true });

  const randomSuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tempPath = `${filePath}.tmp-${randomSuffix}`;
  const serialized = JSON.stringify(data, null, 2) + '\n';

  try {
    await fs.promises.writeFile(tempPath, serialized, 'utf-8');
    await fs.promises.rename(tempPath, filePath);
  } catch (err) {
    try {
      await fs.promises.unlink(tempPath);
    } catch {
      // Ignore cleanup error if temp file does not exist
    }
    throw err;
  }
}
