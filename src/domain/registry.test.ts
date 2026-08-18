import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  emptyRegistry,
  registryPath,
  readRegistry,
  writeRegistry,
  type RegistryFile,
} from './registry';
import type { Source, ManagedInstallation } from './types';

describe('registry store', () => {
  let testTempDir: string;

  beforeEach(async () => {
    testTempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-swissknife-test-'));
  });

  afterEach(async () => {
    if (testTempDir) {
      await fs.promises.rm(testTempDir, { recursive: true, force: true });
    }
  });

  it('registryPath throws when scope is project and projectRoot is missing', () => {
    assert.throws(
      () => {
        registryPath('project');
      },
      {
        message: /projectRoot is required when scope is "project"/,
      }
    );
  });

  it('registryPath returns correct path for global and project scopes', () => {
    const globalPath = registryPath('global');
    assert.strictEqual(globalPath, path.join(os.homedir(), '.ai-toolkit', 'registry.json'));

    const projectPath = registryPath('project', testTempDir);
    assert.strictEqual(projectPath, path.join(testTempDir, '.ai-toolkit', 'registry.json'));
  });

  it('readRegistry on a non-existent path returns emptyRegistry()', async () => {
    const registry = await readRegistry('project', testTempDir);
    assert.deepStrictEqual(registry, emptyRegistry());
    assert.deepStrictEqual(registry, { sources: [], installations: [] });
  });

  it('writeRegistry then readRegistry round-trips the same data', async () => {
    const sampleSource: Source = {
      id: 'source-1',
      type: 'git-custom',
      scope: 'project',
      url: 'https://github.com/example/skills.git',
      name: 'Example Skills',
    };

    const sampleInstallation: ManagedInstallation = {
      assistant: 'claude-code',
      scope: 'project',
      kind: 'skill',
      name: 'test-skill',
      path: path.join(testTempDir, '.claude', 'skills', 'test-skill'),
      sourceId: 'source-1',
      installedAt: '2026-08-18T18:00:00.000Z',
    };

    const initialData: RegistryFile = {
      sources: [sampleSource],
      installations: [sampleInstallation],
    };

    await writeRegistry('project', initialData, testTempDir);
    const loadedData = await readRegistry('project', testTempDir);

    assert.deepStrictEqual(loadedData, initialData);
  });

  it('readRegistry on a file containing invalid JSON throws with message including file path', async () => {
    const registryDir = path.join(testTempDir, '.ai-toolkit');
    await fs.promises.mkdir(registryDir, { recursive: true });
    const targetPath = path.join(registryDir, 'registry.json');
    await fs.promises.writeFile(targetPath, '{ corrupt json content ...', 'utf-8');

    await assert.rejects(
      async () => {
        await readRegistry('project', testTempDir);
      },
      (err: Error) => {
        assert.match(err.message, /Failed to parse registry JSON at/);
        assert.ok(
          err.message.includes(targetPath),
          `Expected error message to include file path "${targetPath}", got: "${err.message}"`
        );
        return true;
      }
    );
  });
});
