import test from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  type DesiredSource,
  type DesiredInstallation,
  writeManifest,
  readManifest,
} from '../domain/registry';
import {
  CONFIG_TRANSFER_SCHEMA_VERSION,
  buildScopeExport,
  buildSourceExport,
  parseExportedConfigFile,
  mergeScopeConfig,
} from './configTransfer';

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('buildScopeExport - returns the scope\'s sources and desiredInstallations', async () => {
  const home = tempDir('config-transfer-home-');
  const source: DesiredSource = { id: 's1', type: 'git-custom', scope: 'global', url: 'https://example.com/repo.git' };
  const desired: DesiredInstallation = { sourceId: 's1', artifactId: 'a1', assistant: 'claude-code', scope: 'global' };

  await writeManifest(
    'global',
    { schemaVersion: 1, sources: [source], desiredInstallations: [desired] },
    undefined,
    home
  );

  const payload = await buildScopeExport('global', undefined, home);
  assert.deepEqual(payload.sources, [source]);
  assert.deepEqual(payload.desiredInstallations, [desired]);
});

test('buildSourceExport - wraps one DesiredSource as a single-source export file', () => {
  const source: DesiredSource = { id: 's1', type: 'local-folder', scope: 'project', localPath: 'skills' };
  const payload = buildSourceExport(source);

  assert.equal(payload.kind, 'ai-swissknife-source');
  assert.equal(payload.schemaVersion, CONFIG_TRANSFER_SCHEMA_VERSION);
  assert.deepEqual(payload.source, source);
  assert.equal(payload.global, undefined);
  assert.equal(payload.project, undefined);
});

test('parseExportedConfigFile - accepts a valid config file', () => {
  const raw = JSON.stringify({
    schemaVersion: CONFIG_TRANSFER_SCHEMA_VERSION,
    kind: 'ai-swissknife-config',
    exportedAt: new Date().toISOString(),
    global: { sources: [], desiredInstallations: [] },
  });
  const parsed = parseExportedConfigFile(raw);
  assert.equal(parsed.kind, 'ai-swissknife-config');
});

test('parseExportedConfigFile - accepts a valid single-source file', () => {
  const raw = JSON.stringify({
    schemaVersion: CONFIG_TRANSFER_SCHEMA_VERSION,
    kind: 'ai-swissknife-source',
    exportedAt: new Date().toISOString(),
    source: { id: 's1', type: 'git-custom', scope: 'global', url: 'https://example.com/repo.git' },
  });
  const parsed = parseExportedConfigFile(raw);
  assert.equal(parsed.kind, 'ai-swissknife-source');
  assert.equal(parsed.source?.id, 's1');
});

test('parseExportedConfigFile - rejects invalid JSON', () => {
  assert.throws(() => parseExportedConfigFile('{not json'), /Not valid JSON/);
});

test('parseExportedConfigFile - rejects a missing/mismatched schemaVersion', () => {
  const raw = JSON.stringify({ schemaVersion: 99, kind: 'ai-swissknife-config', global: { sources: [], desiredInstallations: [] } });
  assert.throws(() => parseExportedConfigFile(raw), /schemaVersion/);
});

test('parseExportedConfigFile - rejects an unrecognized kind', () => {
  const raw = JSON.stringify({ schemaVersion: CONFIG_TRANSFER_SCHEMA_VERSION, kind: 'something-else' });
  assert.throws(() => parseExportedConfigFile(raw), /Unrecognized file kind/);
});

test('parseExportedConfigFile - rejects a source-kind file with no source field', () => {
  const raw = JSON.stringify({ schemaVersion: CONFIG_TRANSFER_SCHEMA_VERSION, kind: 'ai-swissknife-source' });
  assert.throws(() => parseExportedConfigFile(raw), /Missing "source"/);
});

test('parseExportedConfigFile - rejects a config-kind file with neither global nor project', () => {
  const raw = JSON.stringify({ schemaVersion: CONFIG_TRANSFER_SCHEMA_VERSION, kind: 'ai-swissknife-config' });
  assert.throws(() => parseExportedConfigFile(raw), /neither "global" nor "project"/);
});

test('mergeScopeConfig - adds new sources and desiredInstallations, merging into what already exists', async () => {
  const home = tempDir('config-transfer-home-');
  const existingSource: DesiredSource = { id: 'existing', type: 'git-custom', scope: 'global', url: 'https://example.com/existing.git' };
  await writeManifest('global', { schemaVersion: 1, sources: [existingSource], desiredInstallations: [] }, undefined, home);

  const incomingSource: DesiredSource = { id: 'incoming', type: 'local-folder', scope: 'global', localPath: 'skills' };
  const incomingDesired: DesiredInstallation = { sourceId: 'incoming', artifactId: 'a1', assistant: 'kilo-code', scope: 'global' };

  const result = await mergeScopeConfig(
    'global',
    { sources: [incomingSource], desiredInstallations: [incomingDesired] },
    undefined,
    home
  );

  assert.equal(result.sourcesAdded, 1);
  assert.equal(result.sourcesUpdated, 0);
  assert.equal(result.desiredInstallationsAdded, 1);

  const manifest = await readManifest('global', undefined, home);
  assert.equal(manifest.sources.length, 2);
  assert.ok(manifest.sources.some((s) => s.id === 'existing'));
  assert.ok(manifest.sources.some((s) => s.id === 'incoming'));
  assert.equal(manifest.desiredInstallations.length, 1);
});

test('mergeScopeConfig - overwrites a source with a matching id instead of duplicating it', async () => {
  const home = tempDir('config-transfer-home-');
  const original: DesiredSource = { id: 's1', type: 'git-custom', scope: 'global', url: 'https://example.com/old.git', branch: 'main' };
  await writeManifest('global', { schemaVersion: 1, sources: [original], desiredInstallations: [] }, undefined, home);

  const updated: DesiredSource = { id: 's1', type: 'git-custom', scope: 'global', url: 'https://example.com/new.git', branch: 'dev' };
  const result = await mergeScopeConfig('global', { sources: [updated], desiredInstallations: [] }, undefined, home);

  assert.equal(result.sourcesAdded, 0);
  assert.equal(result.sourcesUpdated, 1);

  const manifest = await readManifest('global', undefined, home);
  assert.equal(manifest.sources.length, 1);
  assert.equal(manifest.sources[0].url, 'https://example.com/new.git');
  assert.equal(manifest.sources[0].branch, 'dev');
});

test('mergeScopeConfig - does not duplicate a desiredInstallation already present', async () => {
  const home = tempDir('config-transfer-home-');
  const desired: DesiredInstallation = { sourceId: 's1', artifactId: 'a1', assistant: 'claude-code', scope: 'global' };
  await writeManifest('global', { schemaVersion: 1, sources: [], desiredInstallations: [desired] }, undefined, home);

  const result = await mergeScopeConfig('global', { sources: [], desiredInstallations: [desired] }, undefined, home);

  assert.equal(result.desiredInstallationsAdded, 0);
  const manifest = await readManifest('global', undefined, home);
  assert.equal(manifest.desiredInstallations.length, 1);
});
