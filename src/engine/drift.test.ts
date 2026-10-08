import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ManagedInstallation, Source } from '../domain/types';
import { ClaudeAdapter } from '../adapters/claude';
import { KiloAdapter } from '../adapters/kilo';
import { canonicalHookHash, canonicalRuleHash } from '../adapters/codec';
import { analyzeLocalDrift, checkForUpstreamUpdate, checkDriftForAll } from './drift';
import { getSourceResolver } from '../sources/registry';
import { planInstall } from './plan';
import { applyInstall } from './apply';

function getFixturesRoot(): string {
  const candidateOut = path.join(__dirname, '../sources/__fixtures__');
  if (fs.existsSync(candidateOut)) return candidateOut;
  return path.resolve(__dirname, '../../src/sources/__fixtures__');
}

describe('drift analyzer — analyzeLocalDrift & checkForUpstreamUpdate', () => {
  let testTempDir: string;
  let testHomeDir: string;
  let fixturesRoot: string;
  const claudeAdapter = new ClaudeAdapter();
  const kiloAdapter = new KiloAdapter();

  beforeEach(async () => {
    testTempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'drift-test-ws-'));
    testHomeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'drift-test-home-'));
    fixturesRoot = getFixturesRoot();
  });

  afterEach(async () => {
    if (testTempDir && fs.existsSync(testTempDir)) {
      await fs.promises.rm(testTempDir, { recursive: true, force: true });
    }
    if (testHomeDir && fs.existsSync(testHomeDir)) {
      await fs.promises.rm(testHomeDir, { recursive: true, force: true });
    }
  });

  it('detects up-to-date, modified-locally, and missing-on-disk for an installed skill', async () => {
    const source: Source = {
      id: 'src-root',
      type: 'local-folder',
      scope: 'project',
      localPath: path.join(fixturesRoot, 'root-skill'),
    };
    const pkg = { id: 'src-root:root-skill', sourceId: 'src-root', nativeFormat: 'claude-skill', artifacts: [] };
    const artifact = {
      id: 'src-root:root-skill:root-skill',
      packageId: 'src-root:root-skill',
      kind: 'skill' as const,
      name: 'root-skill',
      nativeFormat: 'claude-skill',
    };

    const prepared = await planInstall({
      source,
      pkg,
      artifact,
      targetAdapter: claudeAdapter,
      targetScope: 'project',
      projectRoot: testTempDir,
    });

    const applied = await applyInstall(prepared, testHomeDir);
    assert.strictEqual(applied.status, 'applied');
    if (applied.status !== 'applied') return;

    const inst: ManagedInstallation = applied.installation;

    // 1. Up-to-date check
    const report1 = await analyzeLocalDrift(inst, testHomeDir);
    assert.strictEqual(report1.status, 'up-to-date');

    // 2. Modify file locally
    const skillMd = path.join(inst.path, 'SKILL.md');
    await fs.promises.writeFile(skillMd, '---\nname: root-skill\ndescription: edited\n---\n# Edited\n', 'utf-8');

    const report2 = await analyzeLocalDrift(inst, testHomeDir);
    assert.strictEqual(report2.status, 'modified-locally');

    // 3. Delete directory
    await fs.promises.rm(inst.path, { recursive: true, force: true });
    const report3 = await analyzeLocalDrift(inst, testHomeDir);
    assert.strictEqual(report3.status, 'missing-on-disk');
  });

  it('detects update-available when upstream source has a modified version', async () => {
    // Dynamic upstream folder
    const upstreamFolder = path.join(testTempDir, 'upstream-skills');
    const skillDir = path.join(upstreamFolder, 'dynamic-skill');
    await fs.promises.mkdir(skillDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: dynamic-skill\ndescription: v1\n---\n# v1\n',
      'utf-8'
    );

    const source: Source = {
      id: 'src-dynamic',
      type: 'local-folder',
      scope: 'project',
      localPath: upstreamFolder,
    };
    const pkg = { id: 'src-dynamic:dynamic-skill', sourceId: 'src-dynamic', nativeFormat: 'claude-skill', artifacts: [] };
    const artifact = {
      id: 'src-dynamic:dynamic-skill:dynamic-skill',
      packageId: 'src-dynamic:dynamic-skill',
      kind: 'skill' as const,
      name: 'dynamic-skill',
      nativeFormat: 'claude-skill',
    };

    const prepared = await planInstall({
      source,
      pkg,
      artifact,
      targetAdapter: kiloAdapter,
      targetScope: 'project',
      projectRoot: testTempDir,
    });

    const applied = await applyInstall(prepared, testHomeDir);
    assert.strictEqual(applied.status, 'applied');
    if (applied.status !== 'applied') return;

    const inst = applied.installation;

    // Initially up-to-date
    const check1 = await checkForUpstreamUpdate(inst, source, testHomeDir);
    assert.strictEqual(check1.status, 'up-to-date');

    // Update upstream source to v2
    await fs.promises.writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: dynamic-skill\ndescription: v2 with new features\n---\n# v2\n',
      'utf-8'
    );

    const check2 = await checkForUpstreamUpdate(inst, source, testHomeDir);
    assert.strictEqual(check2.status, 'update-available');
  });

  it('reports up-to-date for hook and rule installations instead of modified-locally', async () => {
    // 1. Hook
    const hook = {
      name: 'test-hook',
      event: 'PreToolUse' as const,
      command: 'echo "hello"',
      extraFields: {},
    };
    await kiloAdapter.writeHook(hook, { scope: 'project', projectRoot: testTempDir });
    const readH = await kiloAdapter.readHook('test-hook', { scope: 'project', projectRoot: testTempDir });
    const instHook: ManagedInstallation = {
      assistant: 'kilo-code',
      scope: 'project',
      projectPath: testTempDir,
      kind: 'hook',
      name: 'test-hook',
      path: kiloAdapter.hookPath('test-hook', { scope: 'project', projectRoot: testTempDir }),
      installedAt: new Date().toISOString(),
      contentHash: canonicalHookHash(readH!),
    };
    const reportHook = await analyzeLocalDrift(instHook, testHomeDir);
    assert.strictEqual(reportHook.status, 'up-to-date');

    // 2. Rule
    const rule = {
      content: 'test rule content',
    };
    await kiloAdapter.writeRule(rule, { scope: 'project', projectRoot: testTempDir });
    const instRule: ManagedInstallation = {
      assistant: 'kilo-code',
      scope: 'project',
      projectPath: testTempDir,
      kind: 'rule',
      name: 'default',
      path: kiloAdapter.rulePath({ scope: 'project', projectRoot: testTempDir }),
      installedAt: new Date().toISOString(),
      contentHash: canonicalRuleHash(rule),
    };
    const reportRule = await analyzeLocalDrift(instRule, testHomeDir);
    assert.strictEqual(reportRule.status, 'up-to-date');
  });

  describe('checkDriftForAll & resolution deduplication', () => {
    async function createLocalSource(
      sourceId: string,
      skills: { name: string; content?: string }[]
    ): Promise<Source> {
      const sourcePath = path.join(testTempDir, 'sources', sourceId);
      for (const skill of skills) {
        const skillDir = path.join(sourcePath, skill.name);
        await fs.promises.mkdir(skillDir, { recursive: true });
        await fs.promises.writeFile(
          path.join(skillDir, 'SKILL.md'),
          `---\nname: ${skill.name}\ndescription: test skill\n---\n${skill.content ?? '# Content'}`,
          'utf-8'
        );
      }
      return {
        id: sourceId,
        type: 'local-folder',
        scope: 'project',
        localPath: sourcePath,
      };
    }

    async function installSkill(
      source: Source,
      name: string,
      assistant: 'claude-code' | 'kilo-code' = 'claude-code'
    ): Promise<ManagedInstallation> {
      const pkg = {
        id: `${source.id}:${name}`,
        sourceId: source.id,
        nativeFormat: 'claude-skill' as const,
        artifacts: [],
      };
      const artifact = {
        id: `${source.id}:${name}:${name}`,
        packageId: pkg.id,
        kind: 'skill' as const,
        name,
        nativeFormat: 'claude-skill' as const,
      };
      const adapter = assistant === 'claude-code' ? claudeAdapter : kiloAdapter;
      const prepared = await planInstall({
        source,
        pkg,
        artifact,
        targetAdapter: adapter,
        targetScope: 'project',
        projectRoot: testTempDir,
      });
      const outcome = await applyInstall(prepared, testHomeDir);
      if (outcome.status !== 'applied') throw new Error(`Install failed: ${outcome.status}`);
      return outcome.installation;
    }

    it('5 installations of one source -> resolver spy called ONCE (was 5)', async () => {
      const source = await createLocalSource('src-single', [
        { name: 'skill-1' },
        { name: 'skill-2' },
        { name: 'skill-3' },
        { name: 'skill-4' },
        { name: 'skill-5' },
      ]);

      const insts = [
        await installSkill(source, 'skill-1'),
        await installSkill(source, 'skill-2'),
        await installSkill(source, 'skill-3'),
        await installSkill(source, 'skill-4'),
        await installSkill(source, 'skill-5'),
      ];

      const resolver = getSourceResolver('local-folder');
      const originalResolve = resolver.resolve;
      let resolveCallCount = 0;
      resolver.resolve = async (src, opts) => {
        resolveCallCount++;
        return originalResolve.call(resolver, src, opts);
      };

      try {
        const reports = await checkDriftForAll(insts, [source], testHomeDir);
        assert.strictEqual(reports.length, 5);
        assert.strictEqual(resolveCallCount, 1, 'Resolver should be called exactly once for 5 installations of the same source');
        assert.ok(reports.every((r) => r.status === 'up-to-date'));
      } finally {
        resolver.resolve = originalResolve;
      }
    });

    it('two sources -> resolver spy called twice (once per source)', async () => {
      const source1 = await createLocalSource('src-first', [
        { name: 'skill-a1' },
        { name: 'skill-a2' },
        { name: 'skill-a3' },
      ]);
      const source2 = await createLocalSource('src-second', [
        { name: 'skill-b1' },
        { name: 'skill-b2' },
      ]);

      const insts = [
        await installSkill(source1, 'skill-a1'),
        await installSkill(source1, 'skill-a2'),
        await installSkill(source1, 'skill-a3'),
        await installSkill(source2, 'skill-b1'),
        await installSkill(source2, 'skill-b2'),
      ];

      const resolver = getSourceResolver('local-folder');
      const originalResolve = resolver.resolve;
      let resolveCallCount = 0;
      resolver.resolve = async (src, opts) => {
        resolveCallCount++;
        return originalResolve.call(resolver, src, opts);
      };

      try {
        const reports = await checkDriftForAll(insts, [source1, source2], testHomeDir);
        assert.strictEqual(reports.length, 5);
        assert.strictEqual(resolveCallCount, 2, 'Resolver should be called exactly twice (once per distinct source)');
        assert.ok(reports.every((r) => r.status === 'up-to-date'));
      } finally {
        resolver.resolve = originalResolve;
      }
    });

    it('one failing source does not stop the other and its items report the failure', async () => {
      const sourceGood = await createLocalSource('src-good', [{ name: 'good-skill' }]);
      const sourceBad = await createLocalSource('src-bad', [{ name: 'bad-skill' }]);

      const instGood = await installSkill(sourceGood, 'good-skill');
      const instBad = await installSkill(sourceBad, 'bad-skill');

      const resolver = getSourceResolver('local-folder');
      const originalResolve = resolver.resolve;
      resolver.resolve = async (src, opts) => {
        if (src.id === sourceBad.id) {
          throw new Error('Network error connecting to git upstream');
        }
        return originalResolve.call(resolver, src, opts);
      };

      try {
        const reports = await checkDriftForAll([instGood, instBad], [sourceGood, sourceBad], testHomeDir);
        assert.strictEqual(reports.length, 2);

        const goodReport = reports.find((r) => r.installation.name === 'good-skill');
        const badReport = reports.find((r) => r.installation.name === 'bad-skill');

        assert.ok(goodReport, 'Report for good-skill should exist');
        assert.strictEqual(goodReport.status, 'up-to-date');

        assert.ok(badReport, 'Report for bad-skill should exist');
        assert.ok(
          badReport.details?.includes('Failed to resolve upstream source: Network error connecting to git upstream'),
          `bad-skill should report failure details, got: ${badReport.details}`
        );
      } finally {
        resolver.resolve = originalResolve;
      }
    });

    it('checkForUpstreamUpdate accepts optional pre-resolved SourceResolution or cache object', async () => {
      const source = await createLocalSource('src-preresolved', [{ name: 'cached-skill' }]);
      const inst = await installSkill(source, 'cached-skill');

      const resolver = getSourceResolver('local-folder');
      const originalResolve = resolver.resolve;
      const resolution = await resolver.resolve(source, { homeRoot: testHomeDir });

      let resolveCount = 0;
      resolver.resolve = async (src, opts) => {
        resolveCount++;
        return originalResolve.call(resolver, src, opts);
      };

      try {
        // 1. Direct SourceResolution
        const report1 = await checkForUpstreamUpdate(inst, source, testHomeDir, resolution);
        assert.strictEqual(resolveCount, 0, 'Should not call resolver when resolution is passed');
        assert.strictEqual(report1.status, 'up-to-date');

        // 2. Options object with resolution
        const report2 = await checkForUpstreamUpdate(inst, source, testHomeDir, { resolution });
        assert.strictEqual(resolveCount, 0, 'Should not call resolver when { resolution } is passed');
        assert.strictEqual(report2.status, 'up-to-date');

        // 3. Cache object with get(source)
        const cache = {
          get: (src: Source | string) => {
            const id = typeof src === 'string' ? src : src.id;
            return id === source.id ? resolution : undefined;
          },
        };
        const report3 = await checkForUpstreamUpdate(inst, source, testHomeDir, cache);
        assert.strictEqual(resolveCount, 0, 'Should not call resolver when cache hit occurs');
        assert.strictEqual(report3.status, 'up-to-date');

        // 4. Cache miss calls resolver and sets cache
        let setCalled = false;
        const cacheWithSet = {
          get: () => undefined,
          set: () => {
            setCalled = true;
          },
        };
        const report4 = await checkForUpstreamUpdate(inst, source, testHomeDir, cacheWithSet);
        assert.strictEqual(resolveCount, 1, 'Should call resolver on cache miss');
        assert.strictEqual(setCalled, true, 'Should call cache.set on cache miss resolution');
        assert.strictEqual(report4.status, 'up-to-date');
      } finally {
        resolver.resolve = originalResolve;
      }
    });
  });
});
