import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ManagedInstallation, Source } from '../domain/types';
import { ClaudeAdapter } from '../adapters/claude';
import { KiloAdapter } from '../adapters/kilo';
import { canonicalHookHash, canonicalRuleHash } from '../adapters/codec';
import { analyzeLocalDrift, checkForUpstreamUpdate } from './drift';
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
});
