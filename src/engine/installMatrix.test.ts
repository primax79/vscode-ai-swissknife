import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Source, Package, Artifact, ItemKind } from '../domain/types';
import { ClaudeAdapter, claudeAdapter } from '../adapters/claude';
import { KiloAdapter, kiloAdapter } from '../adapters/kilo';
import { planInstallMatrix, applyInstallMatrix, type MatrixItem } from './installMatrix';

function getFixturesRoot(): string {
  const candidateOut = path.join(__dirname, '../sources/__fixtures__');
  if (fs.existsSync(candidateOut)) return candidateOut;
  return path.resolve(__dirname, '../../src/sources/__fixtures__');
}

// File-wide HOME sandbox to ensure no tests touch ~/.ai-swissknife or real assistant config
const realHome = process.env.HOME;
const realUserProfile = process.env.USERPROFILE;
let sandboxHome: string;

before(async () => {
  sandboxHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-swissknife-matrix-sandbox-'));
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

describe('installMatrix — planInstallMatrix and applyInstallMatrix', () => {
  let testTempDir: string;
  let testHomeDir: string;
  let fixturesRoot: string;

  beforeEach(async () => {
    testTempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-swissknife-matrix-ws-'));
    testHomeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-swissknife-matrix-home-'));
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

  function createSkillItem(dirName = 'skill-b', skillName = 'nested-skill-b'): MatrixItem {
    const source: Source = {
      id: 'src-nested',
      type: 'local-folder',
      scope: 'project',
      localPath: path.join(fixturesRoot, 'nested-skills'),
    };
    const pkg: Package = {
      id: `src-nested:${dirName}`,
      sourceId: 'src-nested',
      nativeFormat: 'claude-skill',
      artifacts: [],
    };
    const artifact: Artifact = {
      id: `src-nested:${dirName}:${skillName}`,
      packageId: `src-nested:${dirName}`,
      kind: 'skill',
      name: skillName,
      nativeFormat: 'claude-skill',
    };
    return { source, pkg, artifact };
  }

  describe('planInstallMatrix', () => {
    it('plans 2 assistants × 2 scopes for one skill → 4 planned targets', async () => {
      const item = createSkillItem();
      const result = await planInstallMatrix({
        items: [item],
        assistants: ['claude-code', 'kilo-code'],
        scopes: ['project', 'global'],
        projectRoot: testTempDir,
        homeRoot: testHomeDir,
      });

      assert.strictEqual(result.targets.length, 4);
      assert.strictEqual(result.summary.counts.new, 4);
      assert.strictEqual(result.summary.counts.conflict, 0);
      assert.strictEqual(result.summary.counts.unsupported, 0);
      assert.strictEqual(result.summary.new.length, 4);

      const targetKeys = result.targets.map((t) => `${t.assistant}:${t.scope}`);
      assert.deepStrictEqual(targetKeys, [
        'claude-code:project',
        'claude-code:global',
        'kilo-code:project',
        'kilo-code:global',
      ]);

      for (const target of result.targets) {
        assert.strictEqual(target.prepared.supported, true);
        if (target.prepared.supported) {
          assert.strictEqual(target.prepared.plan.conflict, false);
          assert.ok(target.prepared.plan.proposedFiles.length > 0);
        }
      }
    });

    it('accepts adapter instances as well as assistant IDs in assistants array', async () => {
      const item = createSkillItem();
      const claude = new ClaudeAdapter(() => testHomeDir);
      const kilo = new KiloAdapter(() => testHomeDir);

      const result = await planInstallMatrix({
        items: [item],
        assistants: [claude, kilo],
        scopes: ['project'],
        projectRoot: testTempDir,
        homeRoot: testHomeDir,
      });

      assert.strictEqual(result.targets.length, 2);
      assert.strictEqual(result.targets[0].assistant, 'claude-code');
      assert.strictEqual(result.targets[1].assistant, 'kilo-code');
      assert.strictEqual(result.summary.counts.new, 2);
    });

    it('project scope without root does not throw and yields unsupported with reason "no workspace open"', async () => {
      const item = createSkillItem();
      const result = await planInstallMatrix({
        items: [item],
        assistants: ['claude-code'],
        scopes: ['project', 'global'],
        // projectRoot intentionally omitted
        homeRoot: testHomeDir,
      });

      assert.strictEqual(result.targets.length, 2);

      const projectTarget = result.targets.find((t) => t.scope === 'project');
      assert.ok(projectTarget);
      assert.strictEqual(projectTarget.prepared.supported, false);
      assert.strictEqual(projectTarget.prepared.plan.reason, 'no workspace open');

      const globalTarget = result.targets.find((t) => t.scope === 'global');
      assert.ok(globalTarget);
      assert.strictEqual(globalTarget.prepared.supported, true);

      assert.strictEqual(result.summary.counts.unsupported, 1);
      assert.strictEqual(result.summary.counts.new, 1);
      assert.strictEqual(result.summary.unsupported.length, 1);
      const unsupportedTarget = result.summary.unsupported[0];
      assert.strictEqual(unsupportedTarget.prepared.supported, false);
      if (!unsupportedTarget.prepared.supported) {
        assert.strictEqual(unsupportedTarget.prepared.plan.reason, 'no workspace open');
      }
    });

    it('assistant that does not support the kind is unsupported with a reason', async () => {
      const hookFolder = path.join(testTempDir, 'src-hook-folder');
      await fs.promises.mkdir(hookFolder, { recursive: true });
      await fs.promises.writeFile(
        path.join(hookFolder, 'on-prompt.json'),
        JSON.stringify({
          event: 'UserPromptSubmit',
          command: 'echo "hello"',
        }),
        'utf-8'
      );

      const hookItem: MatrixItem = {
        source: {
          id: 'src-hook',
          type: 'local-folder',
          scope: 'project',
          localPath: hookFolder,
        },
        pkg: {
          id: 'src-hook:on-prompt',
          sourceId: 'src-hook',
          nativeFormat: 'claude-hook',
          artifacts: [],
        },
        artifact: {
          id: 'src-hook:on-prompt:on-prompt',
          packageId: 'src-hook:on-prompt',
          kind: 'hook',
          name: 'on-prompt',
          nativeFormat: 'claude-hook',
        },
      };

      const adapterWithoutHook = {
        assistant: 'kilo-code' as const,
        skillDir: () => path.join(testTempDir, 'skills'),
        // hookPath is omitted so this adapter does not support hook installation
      };

      const result = await planInstallMatrix({
        items: [hookItem],
        assistants: ['claude-code', adapterWithoutHook],
        scopes: ['project'],
        projectRoot: testTempDir,
        homeRoot: testHomeDir,
      });

      assert.strictEqual(result.targets.length, 2);
      assert.strictEqual(result.summary.counts.new, 1);
      assert.strictEqual(result.summary.counts.unsupported, 1);

      const unsupportedTarget = result.summary.unsupported[0];
      assert.strictEqual(unsupportedTarget.assistant, 'kilo-code');
      assert.strictEqual(unsupportedTarget.prepared.supported, false);
      if (!unsupportedTarget.prepared.supported) {
        assert.ok(unsupportedTarget.prepared.plan.reason.includes('does not support hook installation'));
      }
    });

    it('unsupported artifact kind carries reason', async () => {
      const unknownItem: MatrixItem = {
        source: { id: 'src-1', type: 'local-folder', scope: 'project' },
        pkg: { id: 'src-1:pkg', sourceId: 'src-1', nativeFormat: 'raw', artifacts: [] },
        artifact: {
          id: 'art-1',
          packageId: 'src-1:pkg',
          kind: 'unknown-kind' as unknown as ItemKind,
          name: 'test-unknown',
          nativeFormat: 'raw',
        },
      };

      const result = await planInstallMatrix({
        items: [unknownItem],
        assistants: ['claude-code'],
        scopes: ['project'],
        projectRoot: testTempDir,
        homeRoot: testHomeDir,
      });

      assert.strictEqual(result.targets.length, 1);
      assert.strictEqual(result.summary.counts.unsupported, 1);
      assert.strictEqual(result.targets[0].prepared.supported, false);
      assert.ok(result.targets[0].prepared.plan.reason.includes('Artifact kind "unknown-kind" is not supported'));
    });
  });

  describe('applyInstallMatrix', () => {
    it('applies new targets end-to-end and returns per-target outcome', async () => {
      const item = createSkillItem();
      const plan = await planInstallMatrix({
        items: [item],
        assistants: ['claude-code', 'kilo-code'],
        scopes: ['project'],
        projectRoot: testTempDir,
        homeRoot: testHomeDir,
      });

      const outcomes = await applyInstallMatrix(plan.targets, {
        overwrite: false,
        homeRoot: testHomeDir,
      });

      assert.strictEqual(outcomes.length, 2);
      assert.strictEqual(outcomes[0].status, 'applied');
      assert.strictEqual(outcomes[1].status, 'applied');
      assert.strictEqual(outcomes[0].target.assistant, 'claude-code');
      assert.strictEqual(outcomes[1].target.assistant, 'kilo-code');
      assert.strictEqual(outcomes[0].outcome.status, 'applied');
      assert.strictEqual(outcomes[1].outcome.status, 'applied');

      assert.ok(fs.existsSync(path.join(testTempDir, '.claude', 'skills', 'nested-skill-b', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(testTempDir, '.kilo', 'skills', 'nested-skill-b', 'SKILL.md')));
    });

    it('conflict skipped without overwrite and replaced with it', async () => {
      const item = createSkillItem();

      // 1. Initial install
      const initialPlan = await planInstallMatrix({
        items: [item],
        assistants: ['claude-code'],
        scopes: ['project'],
        projectRoot: testTempDir,
        homeRoot: testHomeDir,
      });
      const initialOutcomes = await applyInstallMatrix(initialPlan.targets, {
        overwrite: false,
        homeRoot: testHomeDir,
      });
      assert.strictEqual(initialOutcomes[0].status, 'applied');

      // 2. Re-plan: pre-existing install shows as conflict
      const secondPlan = await planInstallMatrix({
        items: [item],
        assistants: ['claude-code'],
        scopes: ['project'],
        projectRoot: testTempDir,
        homeRoot: testHomeDir,
      });
      assert.strictEqual(secondPlan.summary.counts.conflict, 1);
      assert.strictEqual(secondPlan.summary.counts.new, 0);
      assert.strictEqual(secondPlan.summary.conflict.length, 1);
      assert.strictEqual(secondPlan.targets[0].prepared.supported, true);
      if (secondPlan.targets[0].prepared.supported) {
        assert.strictEqual(secondPlan.targets[0].prepared.plan.conflict, true);
      }

      // 3. Apply without overwrite -> skipped (refused)
      const skippedOutcomes = await applyInstallMatrix(secondPlan.targets, {
        overwrite: false,
        homeRoot: testHomeDir,
      });
      assert.strictEqual(skippedOutcomes.length, 1);
      assert.strictEqual(skippedOutcomes[0].status, 'refused');
      assert.ok(skippedOutcomes[0].reason.includes('conflict') || skippedOutcomes[0].reason.includes('already exists'));

      // 4. Apply with overwrite -> replaced (applied)
      const overwrittenOutcomes = await applyInstallMatrix(secondPlan.targets, {
        overwrite: true,
        homeRoot: testHomeDir,
      });
      assert.strictEqual(overwrittenOutcomes.length, 1);
      assert.strictEqual(overwrittenOutcomes[0].status, 'applied');
    });

    it('unsupported targets are never applied and keep the reason from prepared.plan.reason', async () => {
      const item = createSkillItem();
      // project scope with no projectRoot -> unsupported with reason "no workspace open"
      const plan = await planInstallMatrix({
        items: [item],
        assistants: ['claude-code'],
        scopes: ['project'],
        // projectRoot omitted
        homeRoot: testHomeDir,
      });

      assert.strictEqual(plan.summary.counts.unsupported, 1);

      const outcomes = await applyInstallMatrix(plan.targets, {
        overwrite: true,
        homeRoot: testHomeDir,
      });

      assert.strictEqual(outcomes.length, 1);
      assert.strictEqual(outcomes[0].status, 'refused');
      assert.strictEqual(outcomes[0].reason, 'no workspace open');
      assert.strictEqual(outcomes[0].outcome.status, 'refused');
      if (outcomes[0].outcome.status === 'refused') {
        assert.strictEqual(outcomes[0].outcome.reason, 'no workspace open');
      }
    });

    it('failure injected in 2nd target leaves 1st applied and 3rd attempted', async () => {
      const itemA = createSkillItem('skill-a', 'nested-skill-a');
      const itemB = createSkillItem('skill-b', 'nested-skill-b');

      const planA = await planInstallMatrix({
        items: [itemA],
        assistants: ['claude-code'],
        scopes: ['project'],
        projectRoot: testTempDir,
        homeRoot: testHomeDir,
      });

      const planB = await planInstallMatrix({
        items: [itemB],
        assistants: ['claude-code'],
        scopes: ['project'],
        projectRoot: testTempDir,
        homeRoot: testHomeDir,
      });

      const planC = await planInstallMatrix({
        items: [itemA],
        assistants: ['kilo-code'],
        scopes: ['project'],
        projectRoot: testTempDir,
        homeRoot: testHomeDir,
      });

      const target1 = planA.targets[0];
      const target2 = planB.targets[0];
      const target3 = planC.targets[0];

      // Inject failure in target 2 by mutating contentHash so applyInstall refuses with hash mismatch
      if (target2.prepared.supported) {
        target2.prepared.contentHash = 'corrupted-hash-forcing-apply-failure';
      }

      const outcomes = await applyInstallMatrix([target1, target2, target3], {
        overwrite: true,
        homeRoot: testHomeDir,
      });

      assert.strictEqual(outcomes.length, 3);

      // Target 1: applied
      assert.strictEqual(outcomes[0].status, 'applied');
      assert.strictEqual(outcomes[0].target.item.artifact.name, 'nested-skill-a');
      assert.strictEqual(outcomes[0].target.assistant, 'claude-code');

      // Target 2: failed/refused due to injected failure
      assert.strictEqual(outcomes[1].status, 'refused');
      assert.ok(outcomes[1].reason.includes('hash mismatch'));

      // Target 3: attempted and applied despite target 2 failure
      assert.strictEqual(outcomes[2].status, 'applied');
      assert.strictEqual(outcomes[2].target.item.artifact.name, 'nested-skill-a');
      assert.strictEqual(outcomes[2].target.assistant, 'kilo-code');

      // Verify on disk: target 1 and 3 are present, target 2 is not
      assert.ok(fs.existsSync(path.join(testTempDir, '.claude', 'skills', 'nested-skill-a', 'SKILL.md')));
      assert.strictEqual(fs.existsSync(path.join(testTempDir, '.claude', 'skills', 'nested-skill-b', 'SKILL.md')), false);
      assert.ok(fs.existsSync(path.join(testTempDir, '.kilo', 'skills', 'nested-skill-a', 'SKILL.md')));
    });

    it('applies sequential targets sharing configuration files (MCP server)', async () => {
      const mcpFolder = path.join(testTempDir, 'src-mcp-folder');
      await fs.promises.mkdir(mcpFolder, { recursive: true });
      await fs.promises.writeFile(
        path.join(mcpFolder, 'mcp.json'),
        JSON.stringify({
          mcpServers: {
            server1: { command: 'node', args: ['server1.js'] },
            server2: { command: 'node', args: ['server2.js'] },
          },
        }),
        'utf-8'
      );

      const item1: MatrixItem = {
        source: { id: 'src-mcp', type: 'local-folder', scope: 'project', localPath: mcpFolder },
        pkg: { id: 'src-mcp:server1', sourceId: 'src-mcp', nativeFormat: 'mcp-config', artifacts: [] },
        artifact: { id: 'src-mcp:server1:server1', packageId: 'src-mcp:server1', kind: 'mcp-server', name: 'server1', nativeFormat: 'mcp-config' },
      };
      const item2: MatrixItem = {
        source: { id: 'src-mcp', type: 'local-folder', scope: 'project', localPath: mcpFolder },
        pkg: { id: 'src-mcp:server2', sourceId: 'src-mcp', nativeFormat: 'mcp-config', artifacts: [] },
        artifact: { id: 'src-mcp:server2:server2', packageId: 'src-mcp:server2', kind: 'mcp-server', name: 'server2', nativeFormat: 'mcp-config' },
      };

      const plan = await planInstallMatrix({
        items: [item1, item2],
        assistants: ['claude-code'],
        scopes: ['project'],
        projectRoot: testTempDir,
        homeRoot: testHomeDir,
      });

      assert.strictEqual(plan.targets.length, 2);

      const outcomes = await applyInstallMatrix(plan, {
        overwrite: true,
        homeRoot: testHomeDir,
      });

      assert.strictEqual(outcomes.length, 2);
      assert.strictEqual(outcomes[0].status, 'applied');
      assert.strictEqual(outcomes[1].status, 'applied');

      const claude = new ClaudeAdapter();
      const s1 = await claude.readMcpServer('server1', { scope: 'project', projectRoot: testTempDir });
      const s2 = await claude.readMcpServer('server2', { scope: 'project', projectRoot: testTempDir });
      assert.ok(s1);
      assert.ok(s2);
      assert.strictEqual(s1.command, 'node');
      assert.strictEqual(s2.command, 'node');
    });
  });
});
