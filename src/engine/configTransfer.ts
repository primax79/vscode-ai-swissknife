import type { Scope } from '../domain/types';
import { readManifest, writeManifest, type DesiredSource, type DesiredInstallation } from '../domain/registry';

export const CONFIG_TRANSFER_SCHEMA_VERSION = 1;

export interface ScopeConfigPayload {
  sources: DesiredSource[];
  desiredInstallations: DesiredInstallation[];
}

export interface ExportedConfigFile {
  schemaVersion: typeof CONFIG_TRANSFER_SCHEMA_VERSION;
  kind: 'ai-swissknife-config' | 'ai-swissknife-source';
  exportedAt: string;
  global?: ScopeConfigPayload;
  project?: ScopeConfigPayload;
  source?: DesiredSource;
}

export async function buildScopeExport(
  scope: Scope,
  projectRoot?: string,
  homeRoot?: string
): Promise<ScopeConfigPayload> {
  const manifest = await readManifest(scope, projectRoot, homeRoot);
  return { sources: manifest.sources, desiredInstallations: manifest.desiredInstallations };
}

export function buildSourceExport(source: DesiredSource): ExportedConfigFile {
  return {
    schemaVersion: CONFIG_TRANSFER_SCHEMA_VERSION,
    kind: 'ai-swissknife-source',
    exportedAt: new Date().toISOString(),
    source,
  };
}

export function parseExportedConfigFile(raw: string): ExportedConfigFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Not valid JSON: ${msg}`);
  }

  const obj = parsed as Partial<ExportedConfigFile> | null;
  if (!obj || typeof obj !== 'object') {
    throw new Error('File does not contain a JSON object');
  }
  if (obj.schemaVersion !== CONFIG_TRANSFER_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported or missing schemaVersion (expected ${CONFIG_TRANSFER_SCHEMA_VERSION}, got ${String(obj.schemaVersion)})`
    );
  }
  if (obj.kind !== 'ai-swissknife-config' && obj.kind !== 'ai-swissknife-source') {
    throw new Error(`Unrecognized file kind: ${String(obj.kind)}`);
  }
  if (obj.kind === 'ai-swissknife-source' && !obj.source) {
    throw new Error('Missing "source" field for a single-source export file');
  }
  if (obj.kind === 'ai-swissknife-config' && !obj.global && !obj.project) {
    throw new Error('Configuration file has neither "global" nor "project" data');
  }

  return obj as ExportedConfigFile;
}

export interface MergeResult {
  sourcesAdded: number;
  sourcesUpdated: number;
  desiredInstallationsAdded: number;
}

/** Merges by id (sources) / (sourceId, artifactId, assistant) (desiredInstallations); existing sources are overwritten, matching addSource's own dedup convention. */
export async function mergeScopeConfig(
  scope: Scope,
  payload: ScopeConfigPayload,
  projectRoot?: string,
  homeRoot?: string
): Promise<MergeResult> {
  const manifest = await readManifest(scope, projectRoot, homeRoot);

  let sourcesAdded = 0;
  let sourcesUpdated = 0;
  for (const src of payload.sources) {
    const existingIndex = manifest.sources.findIndex((s) => s.id === src.id);
    if (existingIndex === -1) {
      manifest.sources.push(src);
      sourcesAdded++;
    } else {
      manifest.sources[existingIndex] = src;
      sourcesUpdated++;
    }
  }

  let desiredInstallationsAdded = 0;
  for (const d of payload.desiredInstallations) {
    const exists = manifest.desiredInstallations.some(
      (e) => e.sourceId === d.sourceId && e.artifactId === d.artifactId && e.assistant === d.assistant
    );
    if (!exists) {
      manifest.desiredInstallations.push(d);
      desiredInstallationsAdded++;
    }
  }

  await writeManifest(scope, manifest, projectRoot, homeRoot);
  return { sourcesAdded, sourcesUpdated, desiredInstallationsAdded };
}
