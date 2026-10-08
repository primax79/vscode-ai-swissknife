import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ManagedInstallation, Scope, ItemKind, Source } from '../domain/types';
import { readState, writeState } from '../domain/registry';
import { getAdapterWithHomeRoot } from '../adapters/registry';
import { planDisable, applyDisable, applyEnable } from './disable';
import { analyzeLocalDrift } from './drift';
import { planUpdate, planUpdateAll } from './update';

describe('disable and enable engine', () => {
  let testTempDir: string;
  let testHomeDir: string;
  let testProjectDir: string;

  beforeEach(async () => {
    testTempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'disable-test-'));
    testHomeDir = path.join(testTempDir, 'home');
    testProjectDir = path.join(testTempDir, 'project');
    await fs.promises.mkdir(testHomeDir, { recursive: true });
    await fs.promises.mkdir(testProjectDir, { recursive: true });
  });

  afterEach(async () => {
    if (testTempDir) {
      await fs.promises.rm(testTempDir, { recursive: true, force: true });
    }
  });

  async function setupInstallation(
    kind: 'skill' | 'agent' | 'command',
    name: string,
    scope: Scope,
    assistant: 'kilo-code' | 'claude-code' = 'kilo-code'
  ): Promise<{ installation: ManagedInstallation; originalFiles: Map<string, Buffer> }> {
    const adapter = getAdapterWithHomeRoot(assistant, testHomeDir);
    const loc = { scope, projectRoot: testProjectDir };
    const originalFiles = new Map<string, Buffer>();

    let itemPath: string;

    if (kind === 'skill') {
      const activeFile = adapter.skillPath(name, loc);
      const skillDir = path.dirname(activeFile);
      await fs.promises.mkdir(skillDir, { recursive: true });

      const skillContent = Buffer.from(`---\nname: ${name}\ndescription: test skill\n---\nSkill body content\n`, 'utf-8');
      const helperContent = Buffer.from('#!/bin/bash\necho "hello"\n', 'utf-8');

      await fs.promises.writeFile(path.join(skillDir, 'SKILL.md'), skillContent);
      await fs.promises.mkdir(path.join(skillDir, 'scripts'), { recursive: true });
      await fs.promises.writeFile(path.join(skillDir, 'scripts', 'run.sh'), helperContent);

      originalFiles.set('SKILL.md', skillContent);
      originalFiles.set('scripts/run.sh', helperContent);
      itemPath = skillDir;
    } else if (kind === 'agent') {
      itemPath = adapter.agentPath(name, loc);
      await fs.promises.mkdir(path.dirname(itemPath), { recursive: true });
      const content = Buffer.from(`---\nname: ${name}\ndescription: test agent\n---\nAgent instructions\n`, 'utf-8');
      await fs.promises.writeFile(itemPath, content);
      originalFiles.set(path.basename(itemPath), content);
    } else {
      itemPath = adapter.commandPath(name, loc);
      await fs.promises.mkdir(path.dirname(itemPath), { recursive: true });
      const content = Buffer.from(`---\ndescription: test command\n---\nCommand body\n`, 'utf-8');
      await fs.promises.writeFile(itemPath, content);
      originalFiles.set(path.basename(itemPath), content);
    }

    const installation: ManagedInstallation = {
      assistant,
      scope,
      projectPath: scope === 'project' ? testProjectDir : undefined,
      kind,
      name,
      path: itemPath,
      sourceId: 'src-1',
      packageId: `src-1:${name}`,
      artifactId: `src-1:${name}:${name}`,
      installedAt: new Date().toISOString(),
    };

    // Save initial state
    const state = await readState(scope, testProjectDir, testHomeDir);
    state.installations.push(installation);
    await writeState(scope, state, testProjectDir, testHomeDir);

    return { installation, originalFiles };
  }

  // Helper to read all files in a directory or single file
  async function readAllFiles(itemPath: string): Promise<Map<string, Buffer>> {
    const files = new Map<string, Buffer>();
    const stat = await fs.promises.stat(itemPath);
    if (!stat.isDirectory()) {
      files.set(path.basename(itemPath), await fs.promises.readFile(itemPath));
      return files;
    }

    async function walk(dir: string, rel: string) {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(full, relPath);
        } else if (entry.isFile()) {
          files.set(relPath, await fs.promises.readFile(full));
        }
      }
    }
    await walk(itemPath, '');
    return files;
  }

  // 1. Round trip for all kinds and scopes
  for (const scope of ['global', 'project'] as Scope[]) {
    for (const kind of ['skill', 'agent', 'command'] as ('skill' | 'agent' | 'command')[]) {
      it(`round trip: disable then enable restores byte-identical files for ${kind} at ${scope} scope`, async () => {
        const name = `test-${kind}-${scope}`;
        const { installation, originalFiles } = await setupInstallation(kind, name, scope, 'kilo-code');

        const originalPath = installation.path;
        assert.strictEqual(fs.existsSync(originalPath), true);

        // 1. Plan disable
        const plan = await planDisable(installation, { homeRoot: testHomeDir });
        assert.strictEqual(plan.status, 'ready');
        if (plan.status !== 'ready') return;

        const disabledPath = plan.targetPath;
        assert.notStrictEqual(disabledPath, originalPath);
        assert.ok(disabledPath.includes('_disabled'));

        // 2. Apply disable
        const disableOutcome = await applyDisable(plan, { homeRoot: testHomeDir });
        assert.strictEqual(disableOutcome.status, 'applied');
        if (disableOutcome.status !== 'applied') return;

        // Verify disk after disable
        assert.strictEqual(fs.existsSync(originalPath), false);
        assert.strictEqual(fs.existsSync(disabledPath), true);

        // Verify state flag and path after disable
        const disabledInst = disableOutcome.installation;
        assert.strictEqual(disabledInst.disabled, true);
        assert.strictEqual(disabledInst.path, disabledPath);

        const stateAfterDisable = await readState(scope, testProjectDir, testHomeDir);
        const recordAfterDisable = stateAfterDisable.installations.find((i) => i.name === name);
        assert.ok(recordAfterDisable);
        assert.strictEqual(recordAfterDisable.disabled, true);
        assert.strictEqual(recordAfterDisable.path, disabledPath);

        // 3. Apply enable
        const enableOutcome = await applyEnable(disabledInst, { homeRoot: testHomeDir });
        assert.strictEqual(enableOutcome.status, 'applied');
        if (enableOutcome.status !== 'applied') return;

        // Verify disk after enable
        assert.strictEqual(fs.existsSync(disabledPath), false);
        assert.strictEqual(fs.existsSync(originalPath), true);

        // Verify state flag and path after enable
        const enabledInst = enableOutcome.installation;
        assert.strictEqual(enabledInst.disabled, undefined);
        assert.strictEqual(enabledInst.path, originalPath);

        const stateAfterEnable = await readState(scope, testProjectDir, testHomeDir);
        const recordAfterEnable = stateAfterEnable.installations.find((i) => i.name === name);
        assert.ok(recordAfterEnable);
        assert.strictEqual(recordAfterEnable.disabled, undefined);
        assert.strictEqual(recordAfterEnable.path, originalPath);

        // Verify files are byte-identical
        const restoredFiles = await readAllFiles(originalPath);
        assert.strictEqual(restoredFiles.size, originalFiles.size);
        for (const [relPath, content] of originalFiles) {
          assert.ok(restoredFiles.has(relPath), `Restored files missing ${relPath}`);
          assert.deepStrictEqual(restoredFiles.get(relPath), content, `File ${relPath} differs byte-for-byte`);
        }
      });
    }
  }

  // 2. Conflict on enable when same-name active item exists
  it('enable with a same-name active item present returns conflict and changes nothing', async () => {
    const { installation } = await setupInstallation('skill', 'conflicting-skill', 'project', 'kilo-code');
    const originalPath = installation.path;

    const plan = await planDisable(installation, { homeRoot: testHomeDir });
    assert.strictEqual(plan.status, 'ready');
    if (plan.status !== 'ready') return;
    const disabledPath = plan.targetPath;

    const disableRes = await applyDisable(plan, { homeRoot: testHomeDir });
    assert.strictEqual(disableRes.status, 'applied');
    if (disableRes.status !== 'applied') return;

    // Simulate an active item with the same name being created while disabled
    await fs.promises.mkdir(originalPath, { recursive: true });
    await fs.promises.writeFile(path.join(originalPath, 'SKILL.md'), 'new active skill content', 'utf-8');

    // Attempt enable
    const enableRes = await applyEnable(disableRes.installation, { homeRoot: testHomeDir });
    assert.strictEqual(enableRes.status, 'conflict');
    if (enableRes.status === 'conflict') {
      assert.strictEqual(enableRes.existingPath, originalPath);
    }

    // Ensure nothing was overwritten or moved
    assert.strictEqual(fs.existsSync(disabledPath), true);
    assert.strictEqual(fs.existsSync(originalPath), true);
    const activeContent = await fs.promises.readFile(path.join(originalPath, 'SKILL.md'), 'utf-8');
    assert.strictEqual(activeContent, 'new active skill content');

    // Ensure state remains disabled
    const state = await readState('project', testProjectDir, testHomeDir);
    const rec = state.installations.find((i) => i.name === 'conflicting-skill');
    assert.ok(rec);
    assert.strictEqual(rec.disabled, true);
    assert.strictEqual(rec.path, disabledPath);
  });

  // 3. Conflict on disable when disabled path already exists
  it('disable when disabled destination already exists returns conflict and changes nothing', async () => {
    const { installation } = await setupInstallation('agent', 'my-agent', 'global', 'kilo-code');
    const originalPath = installation.path;

    const adapter = getAdapterWithHomeRoot('kilo-code', testHomeDir);
    const disabledPath = adapter.getDisabledPath('agent', 'my-agent', { scope: 'global' });
    assert.ok(disabledPath);

    // Pre-create conflict at disabledPath
    await fs.promises.mkdir(path.dirname(disabledPath), { recursive: true });
    await fs.promises.writeFile(disabledPath, 'pre-existing disabled agent', 'utf-8');

    // planDisable detects conflict
    const plan = await planDisable(installation, { homeRoot: testHomeDir });
    assert.strictEqual(plan.status, 'conflict');
    if (plan.status === 'conflict') {
      assert.strictEqual(plan.existingPath, disabledPath);
    }

    // applyDisable returns conflict and touches nothing
    const outcome = await applyDisable(plan, { homeRoot: testHomeDir });
    assert.strictEqual(outcome.status, 'conflict');
    if (outcome.status === 'conflict') {
      assert.strictEqual(outcome.existingPath, disabledPath);
    }

    // Original file intact
    assert.strictEqual(fs.existsSync(originalPath), true);
    // Destination intact
    const destContent = await fs.promises.readFile(disabledPath, 'utf-8');
    assert.strictEqual(destContent, 'pre-existing disabled agent');
  });

  // 4. Unsupported kind
  it('unsupported kind (mcp-server, hook, rule) returns unsupported', async () => {
    for (const kind of ['mcp-server', 'hook', 'rule'] as ItemKind[]) {
      const inst: ManagedInstallation = {
        assistant: 'kilo-code',
        scope: 'project',
        projectPath: testProjectDir,
        kind,
        name: `my-${kind}`,
        path: path.join(testProjectDir, `my-${kind}`),
        installedAt: new Date().toISOString(),
      };

      const plan = await planDisable(inst, { homeRoot: testHomeDir });
      assert.strictEqual(plan.status, 'unsupported');
      assert.ok(plan.reason.includes('unsupported'));

      const enableRes = await applyEnable(inst, { homeRoot: testHomeDir });
      assert.strictEqual(enableRes.status, 'unsupported');
      assert.ok(enableRes.reason.includes('unsupported'));
    }
  });

  // 5. Unsupported adapter
  it('unsupported adapter (github-copilot, codex-cli, gemini-cli) returns unsupported', async () => {
    for (const assistant of ['github-copilot', 'codex-cli', 'gemini-cli'] as const) {
      const inst: ManagedInstallation = {
        assistant,
        scope: 'project',
        projectPath: testProjectDir,
        kind: 'skill',
        name: 'test-skill',
        path: path.join(testProjectDir, 'test-skill'),
        installedAt: new Date().toISOString(),
      };

      const plan = await planDisable(inst, { homeRoot: testHomeDir });
      assert.strictEqual(plan.status, 'unsupported');
      assert.ok(plan.reason.includes('unsupported'));

      const enableRes = await applyEnable(inst, { homeRoot: testHomeDir });
      assert.strictEqual(enableRes.status, 'unsupported');
      assert.ok(enableRes.reason.includes('unsupported'));
    }
  });

  // 6. Rollback on injected state-write failure
  it('failure injected in the state write rolls the move back on disable', async () => {
    const { installation } = await setupInstallation('command', 'failing-cmd', 'project', 'kilo-code');
    const originalPath = installation.path;

    const plan = await planDisable(installation, { homeRoot: testHomeDir });
    assert.strictEqual(plan.status, 'ready');
    if (plan.status !== 'ready') return;
    const disabledPath = plan.targetPath;

    // Inject state write failure
    const injectedError = new Error('Injected state.json write disk full error');
    await assert.rejects(
      async () => {
        await applyDisable(plan, { homeRoot: testHomeDir, _injectStateWriteError: injectedError });
      },
      (err: Error) => err.message.includes('Injected state.json write')
    );

    // Rollback verification: original path exists, disabled path does NOT exist
    assert.strictEqual(fs.existsSync(originalPath), true, 'Original path must exist after rollback');
    assert.strictEqual(fs.existsSync(disabledPath), false, 'Disabled path must not exist after rollback');

    // State is untouched
    const state = await readState('project', testProjectDir, testHomeDir);
    const rec = state.installations.find((i) => i.name === 'failing-cmd');
    assert.ok(rec);
    assert.strictEqual(rec.disabled, undefined);
    assert.strictEqual(rec.path, originalPath);
  });

  it('failure injected in the state write rolls the move back on enable', async () => {
    const { installation } = await setupInstallation('command', 'failing-enable-cmd', 'project', 'kilo-code');
    const originalPath = installation.path;

    // First disable cleanly
    const disableOutcome = await applyDisable(installation, { homeRoot: testHomeDir });
    assert.strictEqual(disableOutcome.status, 'applied');
    if (disableOutcome.status !== 'applied') return;

    const disabledInst = disableOutcome.installation;
    const disabledPath = disabledInst.path;
    assert.strictEqual(fs.existsSync(disabledPath), true);
    assert.strictEqual(fs.existsSync(originalPath), false);

    // Now inject error on enable
    const injectedError = new Error('Injected error during enable writeState');
    await assert.rejects(
      async () => {
        await applyEnable(disabledInst, { homeRoot: testHomeDir, _injectStateWriteError: injectedError });
      },
      (err: Error) => err.message.includes('Injected error during enable')
    );

    // Rollback verification: disabled path still exists, original path does NOT exist
    assert.strictEqual(fs.existsSync(disabledPath), true, 'Disabled path must exist after enable rollback');
    assert.strictEqual(fs.existsSync(originalPath), false, 'Original path must not exist after enable rollback');

    // State still records disabled
    const state = await readState('project', testProjectDir, testHomeDir);
    const rec = state.installations.find((i) => i.name === 'failing-enable-cmd');
    assert.ok(rec);
    assert.strictEqual(rec.disabled, true);
    assert.strictEqual(rec.path, disabledPath);
  });

  // 7. Drift on disabled item does not report missing-on-disk
  it('drift on a disabled item does not report missing-on-disk', async () => {
    for (const kind of ['skill', 'agent', 'command'] as const) {
      const { installation } = await setupInstallation(kind, `drift-${kind}`, 'global', 'kilo-code');

      // Check initial drift: up-to-date
      const initialReport = await analyzeLocalDrift(installation, testHomeDir);
      assert.strictEqual(initialReport.status, 'up-to-date');

      // Disable item
      const disableRes = await applyDisable(installation, { homeRoot: testHomeDir });
      assert.strictEqual(disableRes.status, 'applied');
      if (disableRes.status !== 'applied') return;

      const disabledInst = disableRes.installation;
      assert.strictEqual(disabledInst.disabled, true);

      // Check drift on disabled item: must NOT report missing-on-disk!
      const disabledReport = await analyzeLocalDrift(disabledInst, testHomeDir);
      assert.notStrictEqual(disabledReport.status, 'missing-on-disk');
      assert.strictEqual(disabledReport.status, 'up-to-date');

      // Now if we genuinely delete the disabled file from disk:
      await fs.promises.rm(disabledInst.path, { recursive: true, force: true });
      const deletedReport = await analyzeLocalDrift(disabledInst, testHomeDir);
      assert.strictEqual(deletedReport.status, 'missing-on-disk');
    }
  });

  // 8. Kilo fixture proves disabled path is outside scanned dirs
  it('Kilo fixture proves the disabled path is outside scanned dirs for all kinds and scopes', () => {
    const adapter = getAdapterWithHomeRoot('kilo-code', testHomeDir);

    for (const scope of ['global', 'project'] as Scope[]) {
      const loc = { scope, projectRoot: testProjectDir };

      // Skill
      const skillPath = adapter.skillPath('my-skill', loc);
      const skillActiveDir = path.dirname(path.dirname(skillPath)); // e.g. ~/.kilo/skills
      const disabledSkill = adapter.getDisabledPath('skill', 'my-skill', loc);
      assert.ok(disabledSkill);
      assert.strictEqual(disabledSkill.startsWith(skillActiveDir), false, 'Disabled skill must not start with active skills dir');
      assert.ok(disabledSkill.includes('/_disabled/skills/'));

      // Agent
      const agentPath = adapter.agentPath('my-agent', loc);
      const agentActiveDir = path.dirname(agentPath); // e.g. ~/.config/kilo/agents or .kilo/agents
      const disabledAgent = adapter.getDisabledPath('agent', 'my-agent', loc);
      assert.ok(disabledAgent);
      assert.strictEqual(disabledAgent.startsWith(agentActiveDir), false, 'Disabled agent must not start with active agents dir');
      assert.ok(disabledAgent.includes('/_disabled/agents/'));

      // Command
      const cmdPath = adapter.commandPath('my-cmd', loc);
      const cmdActiveDir = path.dirname(cmdPath); // e.g. ~/.config/kilo/command or .kilo/command
      const disabledCmd = adapter.getDisabledPath('command', 'my-cmd', loc);
      assert.ok(disabledCmd);
      assert.strictEqual(disabledCmd.startsWith(cmdActiveDir), false, 'Disabled command must not start with active command dir');
      assert.ok(disabledCmd.includes('/_disabled/command/'));
    }
  });

  // 9. Claude adapter support
  it('Claude adapter exposes disableSupport as unverified and computes valid disabled paths', () => {
    const adapter = getAdapterWithHomeRoot('claude-code', testHomeDir);
    assert.strictEqual(adapter.disableSupport, 'unverified');

    const loc = { scope: 'project' as Scope, projectRoot: testProjectDir };
    const disabledSkill = adapter.getDisabledPath('skill', 'claude-skill', loc);
    assert.strictEqual(disabledSkill, path.join(testProjectDir, '.claude', '_disabled', 'skills', 'claude-skill'));

    const disabledAgent = adapter.getDisabledPath('agent', 'claude-agent', loc);
    assert.strictEqual(disabledAgent, path.join(testProjectDir, '.claude', '_disabled', 'agents', 'claude-agent.md'));

    const disabledCmd = adapter.getDisabledPath('command', 'claude-cmd', loc);
    assert.strictEqual(disabledCmd, path.join(testProjectDir, '.claude', '_disabled', 'commands', 'claude-cmd.md'));
  });

  // 10. Update on a disabled item is refused with a clear reason
  it('update on a disabled item is refused by planUpdate and planUpdateAll with a clear reason', async () => {
    const { installation } = await setupInstallation('skill', 'update-disabled-skill', 'project', 'kilo-code');
    const disableOutcome = await applyDisable(installation, { homeRoot: testHomeDir });
    assert.strictEqual(disableOutcome.status, 'applied');
    if (disableOutcome.status !== 'applied') return;

    const disabledInst = disableOutcome.installation;
    const fakeSource: Source = {
      id: 'src-1',
      type: 'local-folder',
      scope: 'project',
      localPath: testProjectDir,
    };

    // planUpdate
    const prepared = await planUpdate(disabledInst, fakeSource, { homeRoot: testHomeDir });
    assert.strictEqual(prepared.supported, false);
    if (!prepared.supported) {
      assert.ok(prepared.plan.reason.includes('disabled'));
    }

    // planUpdateAll
    const batchResult = await planUpdateAll({
      installations: [disabledInst],
      sources: [fakeSource],
      homeRoot: testHomeDir,
    });
    assert.strictEqual(batchResult.cannotUpdate.length, 1);
    assert.strictEqual(batchResult.cannotUpdate[0].installation.name, 'update-disabled-skill');
    assert.ok(batchResult.cannotUpdate[0].reason.includes('disabled'));
  });
});
