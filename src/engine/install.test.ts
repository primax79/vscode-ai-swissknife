import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Source, Package, Artifact } from '../domain/types';
import { ClaudeAdapter } from '../adapters/claude';
import { KiloAdapter } from '../adapters/kilo';
import { readState } from '../domain/registry';
import { readSkill } from '../adapters/codec';
import { planInstall } from './plan';
import { applyInstall } from './apply';
import type { PreparedInstall } from './types';

function getFixturesRoot(): string {
  const candidateOut = path.join(__dirname, '../sources/__fixtures__');
  if (fs.existsSync(candidateOut)) return candidateOut;
  return path.resolve(__dirname, '../../src/sources/__fixtures__');
}

describe('Install Engine — planInstall and applyInstall', () => {
  let testTempDir: string;
  let testHomeDir: string;
  let fixturesRoot: string;
  const claudeAdapter = new ClaudeAdapter();
  const kiloAdapter = new KiloAdapter();

  beforeEach(async () => {
    testTempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-swissknife-engine-ws-'));
    testHomeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-swissknife-engine-home-'));
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

  describe('planInstall', () => {
    it('refuses unsupported artifact kind', async () => {
      const source: Source = { id: 'src-1', type: 'local-folder', scope: 'project' };
      const pkg: Package = { id: 'src-1:pkg', sourceId: 'src-1', nativeFormat: 'raw', artifacts: [] };
      const artifact: Artifact = {
        id: 'art-1',
        packageId: 'src-1:pkg',
        kind: 'command',
        name: 'test-cmd',
        nativeFormat: 'raw',
      };

      const prepared = await planInstall({
        source,
        pkg,
        artifact,
        targetAdapter: claudeAdapter,
        targetScope: 'project',
        projectRoot: testTempDir,
      });

      assert.strictEqual(prepared.supported, false);
      assert.ok(prepared.plan.reason.includes('Artifact kind "command" is not supported'));
    });

    it('refuses unsupported target assistant', async () => {
      const source: Source = {
        id: 'src-root',
        type: 'local-folder',
        scope: 'project',
        localPath: path.join(fixturesRoot, 'root-skill'),
      };
      const pkg: Package = { id: 'src-root:root-skill', sourceId: 'src-root', nativeFormat: 'claude-skill', artifacts: [] };
      const artifact: Artifact = {
        id: 'src-root:root-skill:root-skill',
        packageId: 'src-root:root-skill',
        kind: 'skill',
        name: 'root-skill',
        nativeFormat: 'claude-skill',
      };

      const fakeAdapter = {
        assistant: 'github-copilot' as const,
        skillDir: () => path.join(testTempDir, '.github', 'skills', 'root-skill'),
      };

      const prepared = await planInstall({
        source,
        pkg,
        artifact,
        targetAdapter: fakeAdapter,
        targetScope: 'project',
        projectRoot: testTempDir,
      });

      assert.strictEqual(prepared.supported, false);
      assert.ok(prepared.plan.reason.includes('Target assistant "github-copilot" is not supported'));
      assert.ok(prepared.plan.diagnostics && prepared.plan.diagnostics.length > 0);
    });

    it('plans fresh skill install correctly with proposed files and zero conflict', async () => {
      const source: Source = {
        id: 'src-nested',
        type: 'local-folder',
        scope: 'project',
        localPath: path.join(fixturesRoot, 'nested-skills'),
      };
      const pkg: Package = { id: 'src-nested:skill-b', sourceId: 'src-nested', nativeFormat: 'claude-skill', artifacts: [] };
      const artifact: Artifact = {
        id: 'src-nested:skill-b:nested-skill-b',
        packageId: 'src-nested:skill-b',
        kind: 'skill',
        name: 'nested-skill-b',
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

      assert.strictEqual(prepared.supported, true);
      if (prepared.supported) {
        assert.strictEqual(prepared.plan.conflict, false);
        assert.strictEqual(prepared.plan.existingFiles.length, 0);
        assert.strictEqual(prepared.plan.proposedFiles.length, 2); // SKILL.md + scripts/helper.sh
        assert.strictEqual(prepared.content.name, 'nested-skill-b');
        assert.ok(prepared.contentHash.length > 0);
      }
    });

    it('plans agent install translating tools to permissions for Kilo', async () => {
      const agentFolder = path.join(testTempDir, 'src-agent-folder');
      await fs.promises.mkdir(agentFolder, { recursive: true });
      await fs.promises.writeFile(
        path.join(agentFolder, 'architect.md'),
        '---\nname: architect\ndescription: Software Architect\ntools: ["read", "edit", "bash"]\nmodel: claude-3-5-sonnet\n---\n# Architect\nDesign first.\n',
        'utf-8'
      );

      const source: Source = {
        id: 'src-agent',
        type: 'local-folder',
        scope: 'project',
        localPath: agentFolder,
      };
      const pkg: Package = { id: 'src-agent:architect', sourceId: 'src-agent', nativeFormat: 'claude-agent', artifacts: [] };
      const artifact: Artifact = {
        id: 'src-agent:architect:architect',
        packageId: 'src-agent:architect',
        kind: 'agent',
        name: 'architect',
        nativeFormat: 'claude-agent',
      };

      const prepared = await planInstall({
        source,
        pkg,
        artifact,
        targetAdapter: kiloAdapter,
        targetScope: 'project',
        projectRoot: testTempDir,
      });

      assert.strictEqual(prepared.supported, true);
      if (prepared.supported && prepared.kind === 'agent') {
        assert.strictEqual(prepared.content.name, 'architect');
        assert.strictEqual(prepared.content.permissions.read, 'allow');
        assert.strictEqual(prepared.content.permissions.bash, 'allow');
        assert.strictEqual(prepared.plan.proposedFiles.length, 1);
        assert.strictEqual(prepared.plan.proposedFiles[0].path, 'architect.md');
      }
    });

    it('refuses symlink target directory', async () => {
      const source: Source = {
        id: 'src-root',
        type: 'local-folder',
        scope: 'project',
        localPath: path.join(fixturesRoot, 'root-skill'),
      };
      const pkg: Package = { id: 'src-root:root-skill', sourceId: 'src-root', nativeFormat: 'claude-skill', artifacts: [] };
      const artifact: Artifact = {
        id: 'src-root:root-skill:root-skill',
        packageId: 'src-root:root-skill',
        kind: 'skill',
        name: 'root-skill',
        nativeFormat: 'claude-skill',
      };

      const targetPath = path.join(testTempDir, '.claude', 'skills', 'root-skill');
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
      const realDir = path.join(testTempDir, 'real-dir');
      await fs.promises.mkdir(realDir);
      await fs.promises.symlink(realDir, targetPath);

      const prepared = await planInstall({
        source,
        pkg,
        artifact,
        targetAdapter: claudeAdapter,
        targetScope: 'project',
        projectRoot: testTempDir,
      });

      assert.strictEqual(prepared.supported, false);
      assert.ok(prepared.plan.reason.includes('symlink'));
    });
  });

  describe('applyInstall', () => {
    it('applies fresh skill install end-to-end, sets file mode, and updates state', async () => {
      const source: Source = {
        id: 'src-nested',
        type: 'local-folder',
        scope: 'project',
        localPath: path.join(fixturesRoot, 'nested-skills'),
      };
      const pkg: Package = { id: 'src-nested:skill-b', sourceId: 'src-nested', nativeFormat: 'claude-skill', artifacts: [] };
      const artifact: Artifact = {
        id: 'src-nested:skill-b:nested-skill-b',
        packageId: 'src-nested:skill-b',
        kind: 'skill',
        name: 'nested-skill-b',
        nativeFormat: 'claude-skill',
      };

      const prepared: PreparedInstall = await planInstall({
        source,
        pkg,
        artifact,
        targetAdapter: kiloAdapter,
        targetScope: 'project',
        projectRoot: testTempDir,
      });

      assert.strictEqual(prepared.supported, true);

      const outcome = await applyInstall(prepared, testHomeDir);
      assert.strictEqual(outcome.status, 'applied');

      if (outcome.status === 'applied') {
        assert.strictEqual(outcome.installation.name, 'nested-skill-b');
        assert.strictEqual(outcome.installation.assistant, 'kilo-code');
        assert.strictEqual(outcome.installation.scope, 'project');

        const targetDir = outcome.installation.path;
        assert.ok(fs.existsSync(path.join(targetDir, 'SKILL.md')));
        const installedSkill = await readSkill(targetDir);
        assert.strictEqual(installedSkill.name, 'nested-skill-b');
        assert.strictEqual(installedSkill.files.length, 1);

        const state = await readState('project', testTempDir, testHomeDir);
        assert.strictEqual(state.installations.length, 1);
        assert.strictEqual(state.installations[0].name, 'nested-skill-b');
        assert.strictEqual(state.installations[0].contentHash, prepared.supported ? prepared.contentHash : '');
      }
    });

    it('applies fresh agent install end-to-end and updates state', async () => {
      const agentFolder = path.join(testTempDir, 'src-agent-folder');
      await fs.promises.mkdir(agentFolder, { recursive: true });
      await fs.promises.writeFile(
        path.join(agentFolder, 'architect.md'),
        '---\nname: architect\ndescription: Software Architect\ntools: ["read", "edit", "bash"]\n---\n# Architect\nDesign first.\n',
        'utf-8'
      );

      const source: Source = {
        id: 'src-agent',
        type: 'local-folder',
        scope: 'project',
        localPath: agentFolder,
      };
      const pkg: Package = { id: 'src-agent:architect', sourceId: 'src-agent', nativeFormat: 'claude-agent', artifacts: [] };
      const artifact: Artifact = {
        id: 'src-agent:architect:architect',
        packageId: 'src-agent:architect',
        kind: 'agent',
        name: 'architect',
        nativeFormat: 'claude-agent',
      };

      const prepared: PreparedInstall = await planInstall({
        source,
        pkg,
        artifact,
        targetAdapter: kiloAdapter,
        targetScope: 'project',
        projectRoot: testTempDir,
      });

      assert.strictEqual(prepared.supported, true);

      const outcome = await applyInstall(prepared, testHomeDir);
      assert.strictEqual(outcome.status, 'applied');

      if (outcome.status === 'applied') {
        assert.strictEqual(outcome.installation.name, 'architect');
        assert.strictEqual(outcome.installation.kind, 'agent');
        assert.strictEqual(outcome.installation.assistant, 'kilo-code');

        const targetFile = outcome.installation.path;
        assert.ok(fs.existsSync(targetFile));

        const state = await readState('project', testTempDir, testHomeDir);
        assert.strictEqual(state.installations.length, 1);
        assert.strictEqual(state.installations[0].name, 'architect');
        assert.strictEqual(state.installations[0].kind, 'agent');
      }
    });

    it('refuses apply when content was mutated after preview (hash mismatch)', async () => {
      const source: Source = {
        id: 'src-root',
        type: 'local-folder',
        scope: 'project',
        localPath: path.join(fixturesRoot, 'root-skill'),
      };
      const pkg: Package = { id: 'src-root:root-skill', sourceId: 'src-root', nativeFormat: 'claude-skill', artifacts: [] };
      const artifact: Artifact = {
        id: 'src-root:root-skill:root-skill',
        packageId: 'src-root:root-skill',
        kind: 'skill',
        name: 'root-skill',
        nativeFormat: 'claude-skill',
      };

      const prepared: PreparedInstall = await planInstall({
        source,
        pkg,
        artifact,
        targetAdapter: claudeAdapter,
        targetScope: 'project',
        projectRoot: testTempDir,
      });

      assert.strictEqual(prepared.supported, true);
      if (prepared.supported && prepared.kind === 'skill') {
        prepared.content.description = 'Mutated after preview';

        const outcome = await applyInstall(prepared, testHomeDir);
        assert.strictEqual(outcome.status, 'refused');
        assert.ok(outcome.reason.includes('hash mismatch'));
      }
    });

    it('refuses apply when target directory changed after preview was computed', async () => {
      const source: Source = {
        id: 'src-root',
        type: 'local-folder',
        scope: 'project',
        localPath: path.join(fixturesRoot, 'root-skill'),
      };
      const pkg: Package = { id: 'src-root:root-skill', sourceId: 'src-root', nativeFormat: 'claude-skill', artifacts: [] };
      const artifact: Artifact = {
        id: 'src-root:root-skill:root-skill',
        packageId: 'src-root:root-skill',
        kind: 'skill',
        name: 'root-skill',
        nativeFormat: 'claude-skill',
      };

      const prepared: PreparedInstall = await planInstall({
        source,
        pkg,
        artifact,
        targetAdapter: claudeAdapter,
        targetScope: 'project',
        projectRoot: testTempDir,
      });

      assert.strictEqual(prepared.supported, true);
      if (prepared.supported) {
        const targetDir = prepared.plan.targetDir;
        await fs.promises.mkdir(targetDir, { recursive: true });
        await fs.promises.writeFile(path.join(targetDir, 'unexpected.txt'), 'surprised', 'utf-8');

        const outcome = await applyInstall(prepared, testHomeDir);
        assert.strictEqual(outcome.status, 'refused');
        assert.ok(outcome.reason.includes('changed after preview'));
      }
    });

    it('replaces existing installation cleanly without losing unrelated records in state', async () => {
      const source: Source = {
        id: 'src-root',
        type: 'local-folder',
        scope: 'project',
        localPath: path.join(fixturesRoot, 'root-skill'),
      };
      const pkg: Package = { id: 'src-root:root-skill', sourceId: 'src-root', nativeFormat: 'claude-skill', artifacts: [] };
      const artifact: Artifact = {
        id: 'src-root:root-skill:root-skill',
        packageId: 'src-root:root-skill',
        kind: 'skill',
        name: 'root-skill',
        nativeFormat: 'claude-skill',
      };

      // 1. Install first skill
      const prepared1 = await planInstall({
        source,
        pkg,
        artifact,
        targetAdapter: claudeAdapter,
        targetScope: 'project',
        projectRoot: testTempDir,
      });
      const outcome1 = await applyInstall(prepared1, testHomeDir);
      assert.strictEqual(outcome1.status, 'applied');

      // 2. Install second skill (nested-skill-a)
      const source2: Source = {
        id: 'src-nested',
        type: 'local-folder',
        scope: 'project',
        localPath: path.join(fixturesRoot, 'nested-skills'),
      };
      const pkg2: Package = { id: 'src-nested:skill-a', sourceId: 'src-nested', nativeFormat: 'claude-skill', artifacts: [] };
      const artifact2: Artifact = {
        id: 'src-nested:skill-a:nested-skill-a',
        packageId: 'src-nested:skill-a',
        kind: 'skill',
        name: 'nested-skill-a',
        nativeFormat: 'claude-skill',
      };

      const prepared2 = await planInstall({
        source: source2,
        pkg: pkg2,
        artifact: artifact2,
        targetAdapter: claudeAdapter,
        targetScope: 'project',
        projectRoot: testTempDir,
      });
      const outcome2 = await applyInstall(prepared2, testHomeDir);
      assert.strictEqual(outcome2.status, 'applied');

      const state2 = await readState('project', testTempDir, testHomeDir);
      assert.strictEqual(state2.installations.length, 2);

      // 3. Reinstall first skill (update/overwrite)
      const prepared1Reinstall = await planInstall({
        source,
        pkg,
        artifact,
        targetAdapter: claudeAdapter,
        targetScope: 'project',
        projectRoot: testTempDir,
      });
      const outcome3 = await applyInstall(prepared1Reinstall, testHomeDir);
      assert.strictEqual(outcome3.status, 'applied');

      const state3 = await readState('project', testTempDir, testHomeDir);
      assert.strictEqual(state3.installations.length, 2);
    });
  });
});
