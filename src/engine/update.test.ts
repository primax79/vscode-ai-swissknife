import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  Source,
  Package,
  Artifact,
  ManagedInstallation,
  AssistantId,
  Scope,
  ItemKind,
} from '../domain/types';
import { getAdapterWithHomeRoot } from '../adapters/registry';
import { getSourceResolver } from '../sources/registry';
import { planInstall } from './plan';
import { applyInstall } from './apply';
import { checkForUpstreamUpdate } from './drift';
import {
  planUpdate,
  planUpdateAll,
  applyUpdateAll,
  setHeld,
  type DriftReport,
  type PreparedInstall,
} from './update';
import { readState } from '../domain/registry';

// File-wide HOME sandbox to ensure no tests touch ~/.ai-swissknife or real assistant config
const realHome = process.env.HOME;
const realUserProfile = process.env.USERPROFILE;
let sandboxHome: string;

before(async () => {
  sandboxHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-swissknife-update-sandbox-'));
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
});

after(async () => {
  for (const [key, value] of [
    ['HOME', realHome],
    ['USERPROFILE', realUserProfile],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (sandboxHome && fs.existsSync(sandboxHome)) {
    await fs.promises.rm(sandboxHome, { recursive: true, force: true });
  }
});

describe('update engine — planUpdate, planUpdateAll, applyUpdateAll', () => {
  let testTempDir: string;
  let testHomeDir: string;

  beforeEach(async () => {
    testTempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-swissknife-update-ws-'));
    testHomeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-swissknife-update-home-'));
  });

  afterEach(async () => {
    if (testTempDir && fs.existsSync(testTempDir)) {
      await fs.promises.rm(testTempDir, { recursive: true, force: true });
    }
    if (testHomeDir && fs.existsSync(testHomeDir)) {
      await fs.promises.rm(testHomeDir, { recursive: true, force: true });
    }
  });

  async function createLocalSource(
    sourceId: string,
    items: Array<{ name: string; kind: 'skill' | 'agent'; content: string }>
  ): Promise<Source> {
    const sourcePath = path.join(testTempDir, 'sources', sourceId);
    await fs.promises.mkdir(sourcePath, { recursive: true });

    for (const item of items) {
      if (item.kind === 'skill') {
        const skillDir = path.join(sourcePath, item.name);
        await fs.promises.mkdir(skillDir, { recursive: true });
        await fs.promises.writeFile(
          path.join(skillDir, 'SKILL.md'),
          `---\nname: ${item.name}\ndescription: test skill\n---\n${item.content}`,
          'utf-8'
        );
      } else if (item.kind === 'agent') {
        const agentsDir = path.join(sourcePath, 'agents');
        await fs.promises.mkdir(agentsDir, { recursive: true });
        await fs.promises.writeFile(
          path.join(agentsDir, `${item.name}.md`),
          `---\nname: ${item.name}\ndescription: test agent\n---\n${item.content}`,
          'utf-8'
        );
      }
    }

    return {
      id: sourceId,
      type: 'local-folder',
      scope: 'project',
      localPath: sourcePath,
    };
  }

  async function installItem(
    source: Source,
    name: string,
    kind: 'skill' | 'agent',
    assistant: AssistantId = 'claude-code',
    scope: Scope = 'project'
  ): Promise<ManagedInstallation> {
    const pkg: Package = {
      id: `${source.id}:${name}`,
      sourceId: source.id,
      nativeFormat: kind === 'skill' ? 'claude-skill' : 'claude-agent',
      artifacts: [],
    };
    const artifact: Artifact = {
      id: `${source.id}:${name}:${name}`,
      packageId: pkg.id,
      kind,
      name,
      nativeFormat: kind === 'skill' ? 'claude-skill' : 'claude-agent',
    };
    const adapter = getAdapterWithHomeRoot(assistant, testHomeDir);
    const prepared = await planInstall({
      source,
      pkg,
      artifact,
      targetAdapter: adapter,
      targetScope: scope,
      projectRoot: testTempDir,
    });
    assert.strictEqual(prepared.supported, true);
    const outcome = await applyInstall(prepared, testHomeDir);
    assert.strictEqual(outcome.status, 'applied');
    if (outcome.status !== 'applied') throw new Error('Setup install failed');
    return outcome.installation;
  }

  describe('planUpdate', () => {
    it('plans an update for an existing installation and returns PreparedInstall', async () => {
      const source = await createLocalSource('src-single', [
        { name: 'skill-alpha', kind: 'skill', content: 'Initial alpha content' },
      ]);
      const inst = await installItem(source, 'skill-alpha', 'skill');

      // Update upstream source
      await fs.promises.writeFile(
        path.join(source.localPath!, 'skill-alpha', 'SKILL.md'),
        '---\nname: skill-alpha\ndescription: test skill\n---\nUpdated alpha content',
        'utf-8'
      );

      const prepared = await planUpdate(inst, source, { homeRoot: testHomeDir, projectRoot: testTempDir });
      assert.strictEqual(prepared.supported, true);
      if (prepared.supported) {
        assert.strictEqual(prepared.kind, 'skill');
        assert.strictEqual(prepared.plan.sourceId, 'src-single');
      }
    });
  });

  describe('planUpdateAll and applyUpdateAll', () => {
    it('two outdated items + one up to date -> only two updated', async () => {
      const source = await createLocalSource('src-batch', [
        { name: 'skill-1', kind: 'skill', content: 'Initial content 1' },
        { name: 'skill-2', kind: 'skill', content: 'Initial content 2' },
        { name: 'skill-3', kind: 'skill', content: 'Initial content 3' },
      ]);

      const inst1 = await installItem(source, 'skill-1', 'skill');
      const inst2 = await installItem(source, 'skill-2', 'skill');
      const inst3 = await installItem(source, 'skill-3', 'skill');

      // Update upstream content for skill-1 and skill-2, leave skill-3 untouched
      await fs.promises.writeFile(
        path.join(source.localPath!, 'skill-1', 'SKILL.md'),
        '---\nname: skill-1\ndescription: updated skill 1\n---\nUpdated v2 content 1',
        'utf-8'
      );
      await fs.promises.writeFile(
        path.join(source.localPath!, 'skill-2', 'SKILL.md'),
        '---\nname: skill-2\ndescription: updated skill 2\n---\nUpdated v2 content 2',
        'utf-8'
      );

      // Drift reports: skill-1 & skill-2 are outdated, skill-3 is up to date
      const report1 = await checkForUpstreamUpdate(inst1, source, testHomeDir);
      const report2 = await checkForUpstreamUpdate(inst2, source, testHomeDir);
      const report3 = await checkForUpstreamUpdate(inst3, source, testHomeDir);

      assert.strictEqual(report1.status, 'update-available');
      assert.strictEqual(report2.status, 'update-available');
      assert.strictEqual(report3.status, 'up-to-date');

      const plan = await planUpdateAll({
        installations: [inst1, inst2, inst3],
        sources: [source],
        reports: [report1, report2, report3],
        homeRoot: testHomeDir,
        projectRoot: testTempDir,
      });

      assert.strictEqual(plan.toUpdate.length, 2);
      assert.strictEqual(plan.upToDate.length, 1);
      assert.strictEqual(plan.skippedModified.length, 0);
      assert.strictEqual(plan.cannotUpdate.length, 0);

      const toUpdateNames = plan.toUpdate.map((t) => t.installation.name).sort();
      assert.deepStrictEqual(toUpdateNames, ['skill-1', 'skill-2']);
      assert.strictEqual(plan.upToDate[0].installation.name, 'skill-3');

      // Apply updates
      const outcomes = await applyUpdateAll(plan, { homeRoot: testHomeDir });
      assert.strictEqual(outcomes.length, 2);
      assert.strictEqual(outcomes[0].status, 'applied');
      assert.strictEqual(outcomes[1].status, 'applied');

      // Verify that skill-1 and skill-2 files on disk were updated
      const content1 = await fs.promises.readFile(path.join(inst1.path, 'SKILL.md'), 'utf-8');
      const content2 = await fs.promises.readFile(path.join(inst2.path, 'SKILL.md'), 'utf-8');
      const content3 = await fs.promises.readFile(path.join(inst3.path, 'SKILL.md'), 'utf-8');

      assert.ok(content1.includes('Updated v2 content 1'));
      assert.ok(content2.includes('Updated v2 content 2'));
      assert.ok(content3.includes('Initial content 3'));
    });

    it('a locally modified outdated item is in skippedModified by default and updated with includeModified after its previous version is saved under _deleted/', async () => {
      const source = await createLocalSource('src-modified', [
        { name: 'skill-mod', kind: 'skill', content: 'Initial upstream content' },
      ]);
      const inst = await installItem(source, 'skill-mod', 'skill');

      // Locally modify the file on disk
      const localFile = path.join(inst.path, 'SKILL.md');
      const preUpdateContent = '---\nname: skill-mod\ndescription: test\n---\nLocally edited by user';
      await fs.promises.writeFile(localFile, preUpdateContent, 'utf-8');

      // Also update upstream source
      await fs.promises.writeFile(
        path.join(source.localPath!, 'skill-mod', 'SKILL.md'),
        '---\nname: skill-mod\ndescription: test\n---\nUpstream version 2.0',
        'utf-8'
      );

      const report = await checkForUpstreamUpdate(inst, source, testHomeDir);
      assert.strictEqual(report.status, 'modified-and-update-available');

      // 1. By default: item is in skippedModified
      const planDefault = await planUpdateAll({
        installations: [inst],
        sources: [source],
        reports: [report],
        includeModified: false,
        homeRoot: testHomeDir,
        projectRoot: testTempDir,
      });

      assert.strictEqual(planDefault.toUpdate.length, 0);
      assert.strictEqual(planDefault.skippedModified.length, 1);
      assert.strictEqual(planDefault.skippedModified[0].installation.name, 'skill-mod');
      assert.strictEqual(planDefault.skippedModified[0].status, 'modified-and-update-available');

      // 2. With includeModified: item is in toUpdate
      const planOptIn = await planUpdateAll({
        installations: [inst],
        sources: [source],
        reports: [report],
        includeModified: true,
        homeRoot: testHomeDir,
        projectRoot: testTempDir,
      });

      assert.strictEqual(planOptIn.toUpdate.length, 1);
      assert.strictEqual(planOptIn.skippedModified.length, 0);

      // Apply the update
      const outcomes = await applyUpdateAll(planOptIn, { homeRoot: testHomeDir, backupModified: true });
      assert.strictEqual(outcomes.length, 1);
      assert.strictEqual(outcomes[0].status, 'applied');
      assert.ok(outcomes[0].backupPath, 'backupPath must be returned for modified item');
      assert.ok(outcomes[0].backupPath.includes('_deleted'), 'backupPath must be inside _deleted');
      assert.ok(fs.existsSync(outcomes[0].backupPath), 'backup directory must exist');

      // Assert backup content equals pre-update content
      const backupSkillFile = path.join(outcomes[0].backupPath, 'SKILL.md');
      assert.ok(fs.existsSync(backupSkillFile), 'backup file must exist');
      const backupContent = await fs.promises.readFile(backupSkillFile, 'utf-8');
      assert.strictEqual(backupContent, preUpdateContent);

      // Assert the current installed file is updated with upstream content
      const postUpdateContent = await fs.promises.readFile(localFile, 'utf-8');
      assert.ok(postUpdateContent.includes('Upstream version 2.0'));
      assert.notStrictEqual(postUpdateContent, preUpdateContent);
    });

    it('item with deleted source -> cannotUpdate with reason', async () => {
      const source = await createLocalSource('src-will-delete', [
        { name: 'skill-orphan', kind: 'skill', content: 'Orphan content' },
      ]);
      const inst = await installItem(source, 'skill-orphan', 'skill');

      // Pass an empty sources list (simulating deleted source from manifest)
      const plan = await planUpdateAll({
        installations: [inst],
        sources: [], // source deleted
        homeRoot: testHomeDir,
        projectRoot: testTempDir,
      });

      assert.strictEqual(plan.toUpdate.length, 0);
      assert.strictEqual(plan.cannotUpdate.length, 1);
      assert.strictEqual(plan.cannotUpdate[0].installation.name, 'skill-orphan');
      assert.ok(
        plan.cannotUpdate[0].reason.includes('src-will-delete') ||
          plan.cannotUpdate[0].reason.includes('not found in manifest'),
        `Expected cannotUpdate reason to mention source not found, got: ${plan.cannotUpdate[0].reason}`
      );
    });

    it('a failure injected in the 2nd of 3 items leaves 1st and 3rd applied', async () => {
      const source = await createLocalSource('src-failure-test', [
        { name: 'item-1', kind: 'skill', content: 'Content 1' },
        { name: 'item-2', kind: 'skill', content: 'Content 2' },
        { name: 'item-3', kind: 'skill', content: 'Content 3' },
      ]);

      const inst1 = await installItem(source, 'item-1', 'skill');
      const inst2 = await installItem(source, 'item-2', 'skill');
      const inst3 = await installItem(source, 'item-3', 'skill');

      // Update upstream source
      for (const name of ['item-1', 'item-2', 'item-3']) {
        await fs.promises.writeFile(
          path.join(source.localPath!, name, 'SKILL.md'),
          `---\nname: ${name}\ndescription: test\n---\nUpdated ${name}`,
          'utf-8'
        );
      }

      const plan = await planUpdateAll({
        installations: [inst1, inst2, inst3],
        sources: [source],
        homeRoot: testHomeDir,
        projectRoot: testTempDir,
      });

      assert.strictEqual(plan.toUpdate.length, 3);

      // Inject a failure in the 2nd item by corrupting its prepared install plan
      plan.toUpdate[1].prepared = {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: 'fake-pkg',
          artifactId: 'fake-art',
          reason: 'Injected failure for testing',
        },
      };

      const outcomes = await applyUpdateAll(plan, { homeRoot: testHomeDir });
      assert.strictEqual(outcomes.length, 3);

      assert.strictEqual(outcomes[0].status, 'applied');
      assert.strictEqual(outcomes[0].installation.name, 'item-1');

      assert.strictEqual(outcomes[1].status, 'refused');
      assert.strictEqual(outcomes[1].installation.name, 'item-2');
      assert.ok(outcomes[1].reason?.includes('Injected failure for testing'));

      assert.strictEqual(outcomes[2].status, 'applied');
      assert.strictEqual(outcomes[2].installation.name, 'item-3');

      // Verify files: item-1 and item-3 were updated, item-2 was not
      const content1 = await fs.promises.readFile(path.join(inst1.path, 'SKILL.md'), 'utf-8');
      const content2 = await fs.promises.readFile(path.join(inst2.path, 'SKILL.md'), 'utf-8');
      const content3 = await fs.promises.readFile(path.join(inst3.path, 'SKILL.md'), 'utf-8');

      assert.ok(content1.includes('Updated item-1'));
      assert.ok(content2.includes('Content 2')); // not updated
      assert.ok(content3.includes('Updated item-3'));
    });

    it('two items of one source resolve the source once (resolver spy called once)', async () => {
      const source = await createLocalSource('src-shared', [
        { name: 'skill-a', kind: 'skill', content: 'Content A' },
        { name: 'skill-b', kind: 'skill', content: 'Content B' },
      ]);

      const instA = await installItem(source, 'skill-a', 'skill');
      const instB = await installItem(source, 'skill-b', 'skill');

      // Spy on localFolderResolver.resolve
      const resolver = getSourceResolver('local-folder');
      const originalResolve = resolver.resolve;
      let resolveCallCount = 0;

      resolver.resolve = async function (src, opts) {
        if (src.id === 'src-shared') {
          resolveCallCount++;
        }
        return originalResolve.call(resolver, src, opts);
      };

      try {
        const reports: DriftReport[] = [
          { installation: instA, status: 'update-available' },
          { installation: instB, status: 'update-available' },
        ];

        const plan = await planUpdateAll({
          installations: [instA, instB],
          sources: [source],
          reports,
          homeRoot: testHomeDir,
          projectRoot: testTempDir,
        });

        assert.strictEqual(plan.toUpdate.length, 2);
        assert.strictEqual(resolveCallCount, 1, 'Source resolver should be called exactly once for shared source');
      } finally {
        resolver.resolve = originalResolve;
      }
    });

    it('planUpdateAll without reports resolves the shared source once across drift check and planning', async () => {
      const source = await createLocalSource('src-shared-noreports', [
        { name: 'skill-x', kind: 'skill', content: 'Content X' },
        { name: 'skill-y', kind: 'skill', content: 'Content Y' },
      ]);

      const instX = await installItem(source, 'skill-x', 'skill');
      const instY = await installItem(source, 'skill-y', 'skill');

      // Update upstream source
      await fs.promises.writeFile(
        path.join(source.localPath!, 'skill-x', 'SKILL.md'),
        '---\nname: skill-x\ndescription: v2\n---\n# Updated X',
        'utf-8'
      );
      await fs.promises.writeFile(
        path.join(source.localPath!, 'skill-y', 'SKILL.md'),
        '---\nname: skill-y\ndescription: v2\n---\n# Updated Y',
        'utf-8'
      );

      // Spy on localFolderResolver.resolve
      const resolver = getSourceResolver('local-folder');
      const originalResolve = resolver.resolve;
      let resolveCallCount = 0;

      resolver.resolve = async function (src, opts) {
        if (src.id === 'src-shared-noreports') {
          resolveCallCount++;
        }
        return originalResolve.call(resolver, src, opts);
      };

      try {
        const plan = await planUpdateAll({
          installations: [instX, instY],
          sources: [source],
          homeRoot: testHomeDir,
          projectRoot: testTempDir,
        });

        assert.strictEqual(plan.toUpdate.length, 2);
        assert.strictEqual(resolveCallCount, 1, 'Source resolver should be called exactly once across drift check and planUpdateAll');
      } finally {
        resolver.resolve = originalResolve;
      }
    });

    it('filter by scope, assistant, sourceId, and kind works', async () => {
      const source1 = await createLocalSource('src-filter-1', [
        { name: 'skill-one', kind: 'skill', content: 'Skill One' },
        { name: 'agent-one', kind: 'agent', content: 'Agent One' },
      ]);
      const source2 = await createLocalSource('src-filter-2', [
        { name: 'skill-two', kind: 'skill', content: 'Skill Two' },
      ]);

      const instSkill1 = await installItem(source1, 'skill-one', 'skill', 'claude-code', 'project');
      const instAgent1 = await installItem(source1, 'agent-one', 'agent', 'claude-code', 'project');
      const instSkill2 = await installItem(source2, 'skill-two', 'skill', 'kilo-code', 'global');

      const allInst = [instSkill1, instAgent1, instSkill2];
      const allSources = [source1, source2];
      const reports: DriftReport[] = [
        { installation: instSkill1, status: 'update-available' },
        { installation: instAgent1, status: 'update-available' },
        { installation: instSkill2, status: 'update-available' },
      ];

      // Filter by scope: project
      const planScope = await planUpdateAll({
        installations: allInst,
        sources: allSources,
        reports,
        filter: { scope: 'project' },
        homeRoot: testHomeDir,
        projectRoot: testTempDir,
      });
      assert.strictEqual(planScope.toUpdate.length, 2);
      assert.ok(planScope.toUpdate.every((t) => t.installation.scope === 'project'));

      // Filter by assistant: kilo-code
      const planAssistant = await planUpdateAll({
        installations: allInst,
        sources: allSources,
        reports,
        filter: { assistant: 'kilo-code' },
        homeRoot: testHomeDir,
        projectRoot: testTempDir,
      });
      assert.strictEqual(planAssistant.toUpdate.length, 1);
      assert.strictEqual(planAssistant.toUpdate[0].installation.name, 'skill-two');

      // Filter by sourceId: src-filter-2
      const planSource = await planUpdateAll({
        installations: allInst,
        sources: allSources,
        reports,
        filter: { sourceId: 'src-filter-2' },
        homeRoot: testHomeDir,
        projectRoot: testTempDir,
      });
      assert.strictEqual(planSource.toUpdate.length, 1);
      assert.strictEqual(planSource.toUpdate[0].installation.name, 'skill-two');

      // Filter by kind: agent
      const planKind = await planUpdateAll({
        installations: allInst,
        sources: allSources,
        reports,
        filter: { kind: 'agent' },
        homeRoot: testHomeDir,
        projectRoot: testTempDir,
      });
      assert.strictEqual(planKind.toUpdate.length, 1);
      assert.strictEqual(planKind.toUpdate[0].installation.name, 'agent-one');
    });

    it('reports missing-on-disk in cannotUpdate', async () => {
      const source = await createLocalSource('src-missing', [
        { name: 'skill-ghost', kind: 'skill', content: 'Ghost content' },
      ]);
      const inst = await installItem(source, 'skill-ghost', 'skill');

      // Remove the item from disk
      await fs.promises.rm(inst.path, { recursive: true, force: true });

      const plan = await planUpdateAll({
        installations: [inst],
        sources: [source],
        homeRoot: testHomeDir,
        projectRoot: testTempDir,
      });

      assert.strictEqual(plan.toUpdate.length, 0);
      assert.strictEqual(plan.cannotUpdate.length, 1);
      assert.ok(plan.cannotUpdate[0].reason.includes('missing on disk') || plan.cannotUpdate[0].reason.includes('not found'));
    });
  });

  describe('hold item out of update all (47.3)', () => {
    it('held outdated item never in toUpdate (also with includeModified) and present in held', async () => {
      const source = await createLocalSource('src-hold', [
        { name: 'skill-hold', kind: 'skill', content: 'Initial version' },
      ]);
      const inst = await installItem(source, 'skill-hold', 'skill');

      // Update source content so upstream update becomes available
      const skillFile = path.join(testTempDir, 'sources', 'src-hold', 'skill-hold', 'SKILL.md');
      await fs.promises.writeFile(
        skillFile,
        '---\nname: skill-hold\ndescription: updated skill\n---\nUpstream updated content',
        'utf-8'
      );

      // Verify it would update when not held
      const planBefore = await planUpdateAll({
        installations: [inst],
        sources: [source],
        homeRoot: testHomeDir,
        projectRoot: testTempDir,
      });
      assert.strictEqual(planBefore.toUpdate.length, 1);
      assert.strictEqual(planBefore.held.length, 0);

      // Now hold the item
      inst.held = true;

      // Plan without includeModified
      const planHeld = await planUpdateAll({
        installations: [inst],
        sources: [source],
        homeRoot: testHomeDir,
        projectRoot: testTempDir,
      });
      assert.strictEqual(planHeld.toUpdate.length, 0, 'held item must never be in toUpdate');
      assert.strictEqual(planHeld.held.length, 1, 'held item must be in held bucket');
      assert.strictEqual(planHeld.buckets.held.length, 1);
      assert.strictEqual(planHeld.counts.held, 1);
      assert.strictEqual(planHeld.held[0].installation.name, 'skill-hold');

      // Plan with includeModified
      const planHeldIncludeMod = await planUpdateAll({
        installations: [inst],
        sources: [source],
        includeModified: true,
        homeRoot: testHomeDir,
        projectRoot: testTempDir,
      });
      assert.strictEqual(planHeldIncludeMod.toUpdate.length, 0, 'held item must never be in toUpdate even with includeModified');
      assert.strictEqual(planHeldIncludeMod.held.length, 1);
      assert.strictEqual(planHeldIncludeMod.counts.held, 1);
    });

    it('toggle persists across a state reload', async () => {
      const source = await createLocalSource('src-toggle', [
        { name: 'skill-toggle', kind: 'skill', content: 'Toggle skill content' },
      ]);
      const inst = await installItem(source, 'skill-toggle', 'skill');

      // Ensure initial state has no held or false
      let state = await readState('project', testTempDir, testHomeDir);
      let found = state.installations.find((i) => i.name === 'skill-toggle');
      assert.ok(found);
      assert.strictEqual(Boolean(found.held), false);

      // Set held = true
      await setHeld(inst, true, { homeRoot: testHomeDir, projectRoot: testTempDir });
      assert.strictEqual(inst.held, true);

      // Reload state from disk and verify
      state = await readState('project', testTempDir, testHomeDir);
      found = state.installations.find((i) => i.name === 'skill-toggle');
      assert.ok(found);
      assert.strictEqual(found.held, true);

      // Set held = false
      await setHeld(inst, false, { homeRoot: testHomeDir, projectRoot: testTempDir });
      assert.strictEqual(inst.held, false);

      // Reload state from disk and verify
      state = await readState('project', testTempDir, testHomeDir);
      found = state.installations.find((i) => i.name === 'skill-toggle');
      assert.ok(found);
      assert.strictEqual(found.held, false);
    });

    it('missing field behaves as not held', async () => {
      const source = await createLocalSource('src-missing-held', [
        { name: 'skill-missing-held', kind: 'skill', content: 'Missing held v1' },
      ]);
      const inst = await installItem(source, 'skill-missing-held', 'skill');

      // Ensure held field is undefined / omitted
      delete inst.held;

      // Update source
      const skillFile = path.join(testTempDir, 'sources', 'src-missing-held', 'skill-missing-held', 'SKILL.md');
      await fs.promises.writeFile(
        skillFile,
        '---\nname: skill-missing-held\ndescription: updated\n---\nMissing held v2',
        'utf-8'
      );

      const plan = await planUpdateAll({
        installations: [inst],
        sources: [source],
        homeRoot: testHomeDir,
        projectRoot: testTempDir,
      });

      assert.strictEqual(plan.toUpdate.length, 1);
      assert.strictEqual(plan.held.length, 0);
      assert.strictEqual(plan.counts.held, 0);
    });
  });
});
