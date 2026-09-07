import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  SCHEMA_VERSION,
  emptyManifest,
  emptyState,
  manifestPath,
  statePath,
  toDesiredSource,
  fromDesiredSource,
  readManifest,
  writeManifest,
  readState,
  writeState,
  type ManifestFile,
  type StateFile,
  type DesiredSource,
} from './registry';
import type { Source, ManagedInstallation } from './types';

describe('registry store (manifest & state)', () => {
  let testTempDir: string;
  let testHomeDir: string;

  beforeEach(async () => {
    testTempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-swissknife-test-ws-'));
    testHomeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-swissknife-test-home-'));
  });

  afterEach(async () => {
    if (testTempDir && fs.existsSync(testTempDir)) {
      await fs.promises.rm(testTempDir, { recursive: true, force: true });
    }
    if (testHomeDir && fs.existsSync(testHomeDir)) {
      await fs.promises.rm(testHomeDir, { recursive: true, force: true });
    }
  });

  describe('path resolution', () => {
    it('manifestPath and statePath throw when scope is project and projectRoot is missing', () => {
      assert.throws(() => manifestPath('project'), /projectRoot is required when scope is "project"/);
      assert.throws(() => statePath('project'), /projectRoot is required when scope is "project"/);
    });

    it('manifestPath and statePath return correct paths for global and project scopes', async () => {
      const globalManifest = manifestPath('global', undefined, testHomeDir);
      assert.strictEqual(globalManifest, path.join(testHomeDir, '.ai-swissknife', 'manifest.json'));

      const projectManifest = manifestPath('project', testTempDir);
      assert.strictEqual(projectManifest, path.join(testTempDir, '.vscode', 'ai-swissknife', 'manifest.json'));

      const globalState = statePath('global', undefined, testHomeDir);
      assert.strictEqual(globalState, path.join(testHomeDir, '.ai-swissknife', 'state.json'));

      const projectState = statePath('project', testTempDir);
      assert.strictEqual(projectState, path.join(testTempDir, '.vscode', 'ai-swissknife', 'state.json'));

      // Test backward-compat fallback when .ai-swissknife/ exists
      const legacyDir = path.join(testTempDir, 'legacy-ws');
      const legacyManifestFile = path.join(legacyDir, '.ai-swissknife', 'manifest.json');
      await fs.promises.mkdir(path.dirname(legacyManifestFile), { recursive: true });
      await fs.promises.writeFile(legacyManifestFile, '{}', 'utf-8');
      assert.strictEqual(manifestPath('project', legacyDir), legacyManifestFile);
    });
  });

  describe('toDesiredSource & fromDesiredSource', () => {
    it('round-trips project DesiredSource with relative localPath without leaking absolute path or projectPath', () => {
      const source: Source = {
        id: 'local-src-1',
        type: 'local-folder',
        scope: 'project',
        projectPath: testTempDir,
        localPath: path.join(testTempDir, 'packages', 'skills'),
        name: 'Local Skills',
      };

      const desired = toDesiredSource(source, testTempDir);
      assert.strictEqual(desired.localPath, path.join('packages', 'skills'));
      assert.strictEqual((desired as unknown as Record<string, unknown>).projectPath, undefined);

      // Verify reading with a different workspace root resolves relative to the new root
      const newWorkspaceRoot = '/some/other/workspace';
      const reconstructed = fromDesiredSource(desired, newWorkspaceRoot);
      assert.strictEqual(reconstructed.id, 'local-src-1');
      assert.strictEqual(reconstructed.scope, 'project');
      assert.strictEqual(reconstructed.projectPath, newWorkspaceRoot);
      assert.strictEqual(reconstructed.localPath, path.resolve(newWorkspaceRoot, 'packages/skills'));
    });

    it('refuses project path outside workspace root and global path outside home root', () => {
      const outsideProjectSource: Source = {
        id: 'bad-project-src',
        type: 'local-folder',
        scope: 'project',
        localPath: '/outside/workspace/skills',
      };

      assert.throws(
        () => toDesiredSource(outsideProjectSource, testTempDir),
        /lies outside workspace root/
      );

      const outsideGlobalSource: Source = {
        id: 'bad-global-src',
        type: 'local-folder',
        scope: 'global',
        localPath: '/outside/home/skills',
      };

      assert.throws(
        () => toDesiredSource(outsideGlobalSource, undefined, testHomeDir),
        /lies outside home root/
      );
    });
  });

  describe('readManifest & writeManifest', () => {
    it('readManifest on non-existent path returns emptyManifest()', async () => {
      const manifest = await readManifest('project', testTempDir);
      assert.deepStrictEqual(manifest, emptyManifest());
      assert.strictEqual(manifest.schemaVersion, SCHEMA_VERSION);
      assert.deepStrictEqual(manifest.sources, []);
      assert.deepStrictEqual(manifest.desiredInstallations, []);
    });

    it('writeManifest and readManifest round-trip data atomically', async () => {
      const desiredSource: DesiredSource = {
        id: 'git-src-1',
        type: 'git-custom',
        scope: 'project',
        url: 'https://github.com/example/skills.git',
        branch: 'main',
      };

      const manifestData: ManifestFile = {
        schemaVersion: SCHEMA_VERSION,
        sources: [desiredSource],
        desiredInstallations: [
          {
            sourceId: 'git-src-1',
            artifactId: 'git-src-1:skill-1:skill-1',
            assistant: 'claude-code',
            scope: 'project',
            requestedRef: 'main',
          },
        ],
      };

      await writeManifest('project', manifestData, testTempDir);
      const loaded = await readManifest('project', testTempDir);
      assert.deepStrictEqual(loaded, manifestData);
    });

    it('writeManifest appends state.json to .gitignore for project scope', async () => {
      const gitignorePath = path.join(testTempDir, '.gitignore');
      const initialContent = 'node_modules/\n';
      await fs.promises.writeFile(gitignorePath, initialContent, 'utf-8');

      const manifestData: ManifestFile = emptyManifest();
      await writeManifest('project', manifestData, testTempDir);

      const gitignoreContent = await fs.promises.readFile(gitignorePath, 'utf-8');
      assert.strictEqual(
        gitignoreContent,
        initialContent + '.vscode/ai-swissknife/state.json\n'
      );
    });

    it('writeManifest for global scope never touches .gitignore', async () => {
      const gitignorePath = path.join(testTempDir, '.gitignore');
      const initialContent = 'node_modules/\n';
      await fs.promises.writeFile(gitignorePath, initialContent, 'utf-8');

      const manifestData: ManifestFile = emptyManifest();
      await writeManifest('global', manifestData, undefined, testHomeDir);

      // Project gitignore remains untouched
      const gitignoreContent = await fs.promises.readFile(gitignorePath, 'utf-8');
      assert.strictEqual(gitignoreContent, initialContent);

      // No gitignore created in homeDir
      assert.strictEqual(fs.existsSync(path.join(testHomeDir, '.gitignore')), false);
    });

    it('readManifest fails closed on corrupt JSON or schemaVersion mismatch', async () => {
      const filePath = manifestPath('project', testTempDir);
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

      // Corrupt JSON
      await fs.promises.writeFile(filePath, 'not json', 'utf-8');
      await assert.rejects(
        () => readManifest('project', testTempDir),
        /Failed to parse manifest JSON at/
      );

      // Schema mismatch
      await fs.promises.writeFile(filePath, JSON.stringify({ schemaVersion: 999 }), 'utf-8');
      await assert.rejects(
        () => readManifest('project', testTempDir),
        /Unsupported manifest schemaVersion: 999/
      );
    });
  });

  describe('readState & writeState', () => {
    it('readState on non-existent path returns emptyState()', async () => {
      const state = await readState('project', testTempDir);
      assert.deepStrictEqual(state, emptyState());
      assert.strictEqual(state.schemaVersion, SCHEMA_VERSION);
      assert.deepStrictEqual(state.installations, []);
    });

    it('writeState and readState round-trip installations atomically', async () => {
      const installation: ManagedInstallation = {
        assistant: 'claude-code',
        scope: 'project',
        projectPath: testTempDir,
        kind: 'skill',
        name: 'test-skill',
        path: path.join(testTempDir, '.claude', 'skills', 'test-skill'),
        sourceId: 'git-src-1',
        sourceRevision: {
          commit: 'abcdef1234567890abcdef1234567890abcdef12',
          requestedRef: 'v1.0.0',
        },
        installedAt: '2026-08-19T10:00:00.000Z',
        contentHash: 'hash123',
      };

      const stateData: StateFile = {
        schemaVersion: SCHEMA_VERSION,
        installations: [installation],
      };

      await writeState('project', stateData, testTempDir);
      const loaded = await readState('project', testTempDir);
      assert.deepStrictEqual(loaded, stateData);
    });

    it('readState fails closed on corrupt JSON or schemaVersion mismatch', async () => {
      const filePath = statePath('project', testTempDir);
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

      // Corrupt JSON
      await fs.promises.writeFile(filePath, 'invalid json', 'utf-8');
      await assert.rejects(
        () => readState('project', testTempDir),
        /Failed to parse state JSON at/
      );

      // Schema mismatch
      await fs.promises.writeFile(filePath, JSON.stringify({ schemaVersion: 2 }), 'utf-8');
      await assert.rejects(
        () => readState('project', testTempDir),
        /Unsupported state schemaVersion: 2/
      );
    });
  });
});
