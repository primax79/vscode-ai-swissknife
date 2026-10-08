import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'node:child_process';
import * as jsonc from 'jsonc-parser';
import { KiloAdapter, kiloAdapter } from './kilo';
import { ClaudeAdapter, claudeAdapter } from './claude';
import type {
  CanonicalRule,
  CanonicalSkill,
  CanonicalAgent,
  CanonicalCommand,
  CanonicalMcpServer,
} from './types';

describe('KiloAdapter', () => {
  let testTempDir: string;
  let testHomeDir: string;
  let testProjectDir: string;
  let adapter: KiloAdapter;

  beforeEach(async () => {
    testTempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kilo-adapter-test-'));
    testHomeDir = path.join(testTempDir, 'home');
    testProjectDir = path.join(testTempDir, 'project');
    await fs.promises.mkdir(testHomeDir, { recursive: true });
    await fs.promises.mkdir(testProjectDir, { recursive: true });
    adapter = new KiloAdapter(() => testHomeDir);
  });

  afterEach(async () => {
    if (testTempDir) {
      await fs.promises.rm(testTempDir, { recursive: true, force: true });
    }
  });

  describe('assistant identity', () => {
    it('has assistant = kilo-code', () => {
      assert.strictEqual(adapter.assistant, 'kilo-code');
      assert.strictEqual(kiloAdapter.assistant, 'kilo-code');
    });
  });

  describe('path resolution', () => {
    it('skillPath returns correct global path and throws when projectRoot is missing for project scope', () => {
      const defaultGlobalPath = kiloAdapter.skillPath('my-skill', { scope: 'global' });
      assert.strictEqual(
        defaultGlobalPath,
        path.join(os.homedir(), '.kilo', 'skills', 'my-skill', 'SKILL.md')
      );

      const customGlobalPath = adapter.skillPath('my-skill', { scope: 'global' });
      assert.strictEqual(
        customGlobalPath,
        path.join(testHomeDir, '.kilo', 'skills', 'my-skill', 'SKILL.md')
      );

      const projectPath = adapter.skillPath('my-skill', {
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.strictEqual(
        projectPath,
        path.join(testProjectDir, '.kilo', 'skills', 'my-skill', 'SKILL.md')
      );

      assert.throws(
        () => {
          adapter.skillPath('my-skill', { scope: 'project' });
        },
        {
          message: /projectRoot is required when scope is "project"/,
        }
      );
    });

    it('skillDir equals path.dirname(skillPath) for both global and project scope', () => {
      const globalLoc = { scope: 'global' as const };
      assert.strictEqual(
        adapter.skillDir('my-skill', globalLoc),
        path.dirname(adapter.skillPath('my-skill', globalLoc))
      );
      assert.strictEqual(
        kiloAdapter.skillDir('my-skill', globalLoc),
        path.dirname(kiloAdapter.skillPath('my-skill', globalLoc))
      );

      const projectLoc = {
        scope: 'project' as const,
        projectRoot: testProjectDir,
      };
      assert.strictEqual(
        adapter.skillDir('my-skill', projectLoc),
        path.dirname(adapter.skillPath('my-skill', projectLoc))
      );
      assert.strictEqual(
        kiloAdapter.skillDir('my-skill', projectLoc),
        path.dirname(kiloAdapter.skillPath('my-skill', projectLoc))
      );
    });

    it('agentPath returns correct global and project paths', () => {
      const globalPath = adapter.agentPath('tester', { scope: 'global' });
      assert.strictEqual(
        globalPath,
        path.join(testHomeDir, '.config', 'kilo', 'agents', 'tester.md')
      );

      const projectPath = adapter.agentPath('tester', {
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.strictEqual(
        projectPath,
        path.join(testProjectDir, '.kilo', 'agents', 'tester.md')
      );
    });

    it('commandPath returns correct global and project paths', () => {
      const globalPath = adapter.commandPath('build', { scope: 'global' });
      assert.strictEqual(
        globalPath,
        path.join(testHomeDir, '.config', 'kilo', 'command', 'build.md')
      );

      const projectPath = adapter.commandPath('build', {
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.strictEqual(
        projectPath,
        path.join(testProjectDir, '.kilo', 'command', 'build.md')
      );
    });

    it('mcpConfigPath returns correct default global and project paths (kilo.jsonc)', () => {
      const globalPath = adapter.mcpConfigPath({ scope: 'global' });
      assert.strictEqual(globalPath, path.join(testHomeDir, '.config', 'kilo', 'kilo.jsonc'));

      const projectPath = adapter.mcpConfigPath({
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.strictEqual(projectPath, path.join(testProjectDir, '.kilo', 'kilo.jsonc'));
    });

    it('mcpConfigPath follows global discovery order', async () => {
      const globalDir = path.join(testHomeDir, '.config', 'kilo');
      await fs.promises.mkdir(globalDir, { recursive: true });

      // config.json (least precedence)
      const configJson = path.join(globalDir, 'config.json');
      await fs.promises.writeFile(configJson, '{}');
      assert.strictEqual(adapter.mcpConfigPath({ scope: 'global' }), configJson);

      // opencode.json
      const opencodeJson = path.join(globalDir, 'opencode.json');
      await fs.promises.writeFile(opencodeJson, '{}');
      assert.strictEqual(adapter.mcpConfigPath({ scope: 'global' }), opencodeJson);

      // opencode.jsonc
      const opencodeJsonc = path.join(globalDir, 'opencode.jsonc');
      await fs.promises.writeFile(opencodeJsonc, '{}');
      assert.strictEqual(adapter.mcpConfigPath({ scope: 'global' }), opencodeJsonc);

      // kilo.json
      const kiloJson = path.join(globalDir, 'kilo.json');
      await fs.promises.writeFile(kiloJson, '{}');
      assert.strictEqual(adapter.mcpConfigPath({ scope: 'global' }), kiloJson);

      // kilo.jsonc (highest precedence)
      const kiloJsonc = path.join(globalDir, 'kilo.jsonc');
      await fs.promises.writeFile(kiloJsonc, '{}');
      assert.strictEqual(adapter.mcpConfigPath({ scope: 'global' }), kiloJsonc);
    });

    it('mcpConfigPath follows project discovery order', async () => {
      // 1. Root config file
      const rootKiloJson = path.join(testProjectDir, 'kilo.json');
      await fs.promises.writeFile(rootKiloJson, '{}');
      assert.strictEqual(
        adapter.mcpConfigPath({ scope: 'project', projectRoot: testProjectDir }),
        rootKiloJson
      );

      // 2. .kilocode takes precedence over project root
      const kilocodeDir = path.join(testProjectDir, '.kilocode');
      await fs.promises.mkdir(kilocodeDir, { recursive: true });
      const kilocodeOpencodeJson = path.join(kilocodeDir, 'opencode.json');
      await fs.promises.writeFile(kilocodeOpencodeJson, '{}');
      assert.strictEqual(
        adapter.mcpConfigPath({ scope: 'project', projectRoot: testProjectDir }),
        kilocodeOpencodeJson
      );

      // 3. .kilo takes precedence over .kilocode
      const kiloDir = path.join(testProjectDir, '.kilo');
      await fs.promises.mkdir(kiloDir, { recursive: true });
      const kiloKiloJson = path.join(kiloDir, 'kilo.json');
      await fs.promises.writeFile(kiloKiloJson, '{}');
      assert.strictEqual(
        adapter.mcpConfigPath({ scope: 'project', projectRoot: testProjectDir }),
        kiloKiloJson
      );

      // 4. .kilo/kilo.jsonc takes highest precedence
      const kiloKiloJsonc = path.join(kiloDir, 'kilo.jsonc');
      await fs.promises.writeFile(kiloKiloJsonc, '{}');
      assert.strictEqual(
        adapter.mcpConfigPath({ scope: 'project', projectRoot: testProjectDir }),
        kiloKiloJsonc
      );
    });

    it('rulePath returns correct global (~/.config/kilo/AGENTS.md) and project (<root>/CLAUDE.md) paths', () => {
      const defaultGlobalRule = kiloAdapter.rulePath({ scope: 'global' });
      assert.strictEqual(
        defaultGlobalRule,
        path.join(os.homedir(), '.config', 'kilo', 'AGENTS.md')
      );

      const customGlobalRule = adapter.rulePath({ scope: 'global' });
      assert.strictEqual(
        customGlobalRule,
        path.join(testHomeDir, '.config', 'kilo', 'AGENTS.md')
      );

      const projectRule = adapter.rulePath({
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.strictEqual(projectRule, path.join(testProjectDir, 'CLAUDE.md'));

      assert.throws(
        () => {
          adapter.rulePath({ scope: 'project' });
        },
        {
          message: /projectRoot is required when scope is "project"/,
        }
      );
    });

    it('project-scope rulePath returns identical string to ClaudeAdapter project-scope rulePath for the same projectRoot', () => {
      const location = { scope: 'project' as const, projectRoot: testProjectDir };
      assert.strictEqual(
        kiloAdapter.rulePath(location),
        claudeAdapter.rulePath(location)
      );

      const customClaudeAdapter = new ClaudeAdapter(() => testHomeDir);
      assert.strictEqual(
        adapter.rulePath(location),
        customClaudeAdapter.rulePath(location)
      );
    });
  });

  describe('skills', () => {
    it('Round-trip: writeSkill then readSkill returns the same name/description/body and extraFields', async () => {
      const skill: CanonicalSkill = {
        name: 'full-feature-skill',
        description: 'A skill with many fields',
        body: 'This is the skill body.\nIt spans multiple lines.\n',
        extraFields: {
          license: 'MIT',
          version: '1.0.0',
          enabled: true,
          priority: 10,
          metadata: {
            category: 'test',
            author: 'Alfredo',
          },
          tags: ['typescript', 'node'],
        },
        files: [],
      };

      await adapter.writeSkill(skill, { scope: 'project', projectRoot: testProjectDir });
      const loadedProjectSkill = await adapter.readSkill(skill.name, {
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.deepStrictEqual(loadedProjectSkill, skill);

      await adapter.writeSkill(skill, { scope: 'global' });
      const loadedGlobalSkill = await adapter.readSkill(skill.name, { scope: 'global' });
      assert.deepStrictEqual(loadedGlobalSkill, skill);
    });

    it('readSkill on a nonexistent skill returns null, not a throw', async () => {
      const resultProject = await adapter.readSkill('nonexistent-skill', {
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.strictEqual(resultProject, null);

      const resultGlobal = await adapter.readSkill('nonexistent-skill', { scope: 'global' });
      assert.strictEqual(resultGlobal, null);
    });

    it('listSkills returns only directories containing SKILL.md, given a fixture directory with one valid skill dir and one dir without SKILL.md', async () => {
      const skillsDir = path.join(testProjectDir, '.kilo', 'skills');
      const validSkillDir = path.join(skillsDir, 'valid-skill');
      const invalidDir = path.join(skillsDir, 'not-a-skill');
      const strayFile = path.join(skillsDir, 'stray.txt');

      await fs.promises.mkdir(validSkillDir, { recursive: true });
      await fs.promises.mkdir(invalidDir, { recursive: true });

      await fs.promises.writeFile(
        path.join(validSkillDir, 'SKILL.md'),
        '---\nname: valid-skill\ndescription: A valid skill\n---\n# Body\n',
        'utf-8'
      );

      await fs.promises.writeFile(
        path.join(invalidDir, 'OTHER.md'),
        '# Not a skill',
        'utf-8'
      );

      await fs.promises.writeFile(strayFile, 'some text', 'utf-8');

      const listed = await adapter.listSkills({
        scope: 'project',
        projectRoot: testProjectDir,
      });

      assert.deepStrictEqual(listed, ['valid-skill']);
    });

    it('listSkills returns empty array when .kilo/skills does not exist', async () => {
      const listed = await adapter.listSkills({
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.deepStrictEqual(listed, []);
    });
  });

  describe('agents', () => {
    it('Round-trip: writeAgent then readAgent preserves permissions and mode', async () => {
      const agent: CanonicalAgent = {
        name: 'kilo-expert',
        description: 'An expert Kilo agent',
        mode: 'subagent',
        tools: [],
        permissions: {
          read: 'allow',
          edit: 'allow',
          bash: 'deny',
        },
        model: 'gemini-3.7-flash',
        variant: 'high',
        body: '# Kilo Expert\n\nHandles execution.\n',
        extraFields: {
          customOption: true,
        },
      };

      await adapter.writeAgent(agent, { scope: 'project', projectRoot: testProjectDir });
      const loaded = await adapter.readAgent(agent.name, {
        scope: 'project',
        projectRoot: testProjectDir,
      });

      assert.deepStrictEqual(loaded, agent);

      const list = await adapter.listAgents({ scope: 'project', projectRoot: testProjectDir });
      assert.deepStrictEqual(list, ['kilo-expert']);
    });

    it('reads agent from singular .kilo/agent/ fallback directory', async () => {
      const singularDir = path.join(testProjectDir, '.kilo', 'agent');
      await fs.promises.mkdir(singularDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(singularDir, 'legacy-agent.md'),
        '---\nname: legacy-agent\ndescription: A legacy agent\nmode: primary\npermission:\n  read: allow\n---\n# Prompt\n',
        'utf-8'
      );

      const loaded = await adapter.readAgent('legacy-agent', {
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.ok(loaded);
      assert.strictEqual(loaded.name, 'legacy-agent');
      assert.strictEqual(loaded.mode, 'primary');
      assert.strictEqual(loaded.permissions.read, 'allow');

      const list = await adapter.listAgents({ scope: 'project', projectRoot: testProjectDir });
      assert.ok(list.includes('legacy-agent'));
    });
  });

  describe('commands', () => {
    it('Round-trip: writeCommand then readCommand strictly enforces Kilo E77 schema', async () => {
      const cmd: CanonicalCommand = {
        name: 'build-project',
        description: 'Build project bundle',
        agent: 'kilo-expert',
        model: 'gemini-3.7-flash',
        subtask: true,
        body: 'npm run build\n',
        extraFields: {
          invalidKey: 'forbidden',
        },
      };

      await adapter.writeCommand(cmd, { scope: 'project', projectRoot: testProjectDir });
      const filePath = adapter.commandPath(cmd.name, { scope: 'project', projectRoot: testProjectDir });
      const rawContent = await fs.promises.readFile(filePath, 'utf-8');

      assert.strictEqual(rawContent.includes('invalidKey:'), false);
      assert.strictEqual(rawContent.includes('name:'), false);
      assert.ok(rawContent.includes('Build project bundle'));
      assert.ok(rawContent.includes('kilo-expert'));
      assert.ok(rawContent.includes('subtask: true'));

      const loaded = await adapter.readCommand(cmd.name, {
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.ok(loaded);
      assert.strictEqual(loaded.name, 'build-project');
      assert.strictEqual(loaded.description, 'Build project bundle');
      assert.strictEqual(loaded.agent, 'kilo-expert');
      assert.strictEqual(loaded.subtask, true);

      const list = await adapter.listCommands({ scope: 'project', projectRoot: testProjectDir });
      assert.deepStrictEqual(list, ['build-project']);
    });
  });

  describe('mcpServers', () => {
    it('Round-trip: writeMcpServer writes exact Kilo local shape to kilo.jsonc and reads back', async () => {
      const server1: CanonicalMcpServer = {
        id: 'sqlite',
        type: 'stdio',
        command: 'uvx',
        args: ['mcp-server-sqlite', '--db-path', 'test.db'],
        env: { DB_DIR: '/tmp/db' },
      };

      await adapter.writeMcpServer(server1, { scope: 'project', projectRoot: testProjectDir });
      const configPath = adapter.mcpConfigPath({ scope: 'project', projectRoot: testProjectDir });
      assert.strictEqual(configPath, path.join(testProjectDir, '.kilo', 'kilo.jsonc'));

      // Verify exact on-disk shape
      const rawContent = await fs.promises.readFile(configPath, 'utf-8');
      const parsed = jsonc.parse(rawContent);
      assert.ok(parsed.mcp);
      assert.deepStrictEqual(parsed.mcp.sqlite, {
        type: 'local',
        command: ['uvx', 'mcp-server-sqlite', '--db-path', 'test.db'],
        environment: { DB_DIR: '/tmp/db' },
      });
      // Ensure "enabled" is not injected by default
      assert.strictEqual('enabled' in parsed.mcp.sqlite, false);

      // Verify legacy mcp.json was NOT written
      assert.strictEqual(fs.existsSync(path.join(testProjectDir, '.kilo', 'mcp.json')), false);

      // Verify readMcpServer maps back to canonical
      const loaded = await adapter.readMcpServer('sqlite', {
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.ok(loaded);
      assert.strictEqual(loaded.id, 'sqlite');
      assert.strictEqual(loaded.type, 'stdio');
      assert.strictEqual(loaded.command, 'uvx');
      assert.deepStrictEqual(loaded.args, ['mcp-server-sqlite', '--db-path', 'test.db']);
      assert.deepStrictEqual(loaded.env, { DB_DIR: '/tmp/db' });

      const list = await adapter.listMcpServers({ scope: 'project', projectRoot: testProjectDir });
      assert.deepStrictEqual(list, ['sqlite']);
    });

    it('Round-trip: writeMcpServer writes remote shape and preserves extraFields (global scope)', async () => {
      const server: CanonicalMcpServer = {
        id: 'remote-api',
        type: 'http',
        url: 'https://api.example.com/mcp',
        headers: { Authorization: 'Bearer test-token' },
        extraFields: {
          oauth: false,
          timeout: 10000,
          enabled: true,
        },
      };

      await adapter.writeMcpServer(server, { scope: 'global' });
      const globalConfigPath = adapter.mcpConfigPath({ scope: 'global' });
      assert.strictEqual(globalConfigPath, path.join(testHomeDir, '.config', 'kilo', 'kilo.jsonc'));

      // Verify exact on-disk shape
      const rawContent = await fs.promises.readFile(globalConfigPath, 'utf-8');
      const parsed = jsonc.parse(rawContent);
      assert.deepStrictEqual(parsed.mcp['remote-api'], {
        type: 'remote',
        url: 'https://api.example.com/mcp',
        headers: { Authorization: 'Bearer test-token' },
        oauth: false,
        timeout: 10000,
        enabled: true,
      });

      // Verify legacy mcp.json was NOT written in global scope
      assert.strictEqual(fs.existsSync(path.join(testHomeDir, '.config', 'kilo', 'mcp.json')), false);

      // Verify readMcpServer maps remote back to http and restores extraFields
      const loaded = await adapter.readMcpServer('remote-api', { scope: 'global' });
      assert.ok(loaded);
      assert.strictEqual(loaded.id, 'remote-api');
      assert.strictEqual(loaded.type, 'http');
      assert.strictEqual(loaded.url, 'https://api.example.com/mcp');
      assert.deepStrictEqual(loaded.headers, { Authorization: 'Bearer test-token' });
      assert.deepStrictEqual(loaded.extraFields, {
        oauth: false,
        timeout: 10000,
        enabled: true,
      });

      const list = await adapter.listMcpServers({ scope: 'global' });
      assert.deepStrictEqual(list, ['remote-api']);
    });

    it('Comments and trailing commas survive byte-for-byte except the changed key', async () => {
      const kiloDir = path.join(testProjectDir, '.kilo');
      await fs.promises.mkdir(kiloDir, { recursive: true });
      const configPath = path.join(kiloDir, 'kilo.jsonc');

      const initialContent = `// Top-level comment
{
  // Model settings
  "model": "claude-3-7-sonnet",
  /* Provider block */
  "provider": {
    "anthropic": {},
  },
  "tools": [
    "bash",
    "edit",
  ],
}
`;
      await fs.promises.writeFile(configPath, initialContent, 'utf-8');

      // Install server
      const server: CanonicalMcpServer = {
        id: 'test-server',
        type: 'stdio',
        command: 'node',
        args: ['index.js'],
      };
      await adapter.writeMcpServer(server, { scope: 'project', projectRoot: testProjectDir });

      const updatedContent = await fs.promises.readFile(configPath, 'utf-8');
      assert.ok(updatedContent.includes('// Top-level comment'));
      assert.ok(updatedContent.includes('// Model settings'));
      assert.ok(updatedContent.includes('/* Provider block */'));
      assert.ok(updatedContent.includes('"anthropic": {},'));
      assert.ok(updatedContent.includes('"edit",'));
      assert.ok(updatedContent.includes('"test-server"'));

      // Remove server
      await adapter.removeMcpServer('test-server', { scope: 'project', projectRoot: testProjectDir });
      const contentAfterRemoval = await fs.promises.readFile(configPath, 'utf-8');
      assert.ok(contentAfterRemoval.includes('// Top-level comment'));
      assert.ok(contentAfterRemoval.includes('// Model settings'));
      assert.ok(contentAfterRemoval.includes('/* Provider block */'));
      assert.ok(contentAfterRemoval.includes('"anthropic": {},'));
      assert.ok(contentAfterRemoval.includes('"edit",'));
      assert.strictEqual(contentAfterRemoval.includes('"test-server"'), false);
    });

    it('Legacy mcp.json entries are discoverable and removable, but new installs never write mcp.json', async () => {
      const kiloDir = path.join(testProjectDir, '.kilo');
      await fs.promises.mkdir(kiloDir, { recursive: true });
      const legacyPath = path.join(kiloDir, 'mcp.json');

      await fs.promises.writeFile(
        legacyPath,
        JSON.stringify({
          mcpServers: {
            'legacy-sqlite': {
              command: 'uvx',
              args: ['mcp-server-sqlite'],
              env: { LEGACY_FLAG: '1' },
            },
          },
        }, null, 2),
        'utf-8'
      );

      // Discovery finds legacy entry
      const listBefore = await adapter.listMcpServers({ scope: 'project', projectRoot: testProjectDir });
      assert.ok(listBefore.includes('legacy-sqlite'));

      // Reading maps legacy entry back
      const readLegacy = await adapter.readMcpServer('legacy-sqlite', {
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.ok(readLegacy);
      assert.strictEqual(readLegacy.id, 'legacy-sqlite');
      assert.strictEqual(readLegacy.type, 'stdio');
      assert.strictEqual(readLegacy.command, 'uvx');
      assert.deepStrictEqual(readLegacy.args, ['mcp-server-sqlite']);
      assert.deepStrictEqual(readLegacy.env, { LEGACY_FLAG: '1' });

      // Installing a new server writes kilo.jsonc, not mcp.json
      const newServer: CanonicalMcpServer = {
        id: 'new-server',
        type: 'stdio',
        command: 'echo',
        args: ['hello'],
      };
      await adapter.writeMcpServer(newServer, { scope: 'project', projectRoot: testProjectDir });
      assert.ok(fs.existsSync(path.join(kiloDir, 'kilo.jsonc')));

      // Legacy file still only contains legacy-sqlite, not new-server
      const legacyRaw = await fs.promises.readFile(legacyPath, 'utf-8');
      assert.strictEqual(legacyRaw.includes('new-server'), false);

      // Removing legacy entry cleans it from legacy mcp.json
      await adapter.removeMcpServer('legacy-sqlite', { scope: 'project', projectRoot: testProjectDir });
      const readLegacyAfter = await adapter.readMcpServer('legacy-sqlite', {
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.strictEqual(readLegacyAfter, null);

      const listAfter = await adapter.listMcpServers({ scope: 'project', projectRoot: testProjectDir });
      assert.deepStrictEqual(listAfter, ['new-server']);
    });

    it('removeMcpServer removes only the specified server from kilo.jsonc', async () => {
      const server1: CanonicalMcpServer = { id: 'sqlite', type: 'stdio', command: 'uvx' };
      const server2: CanonicalMcpServer = { id: 'remote-docs', type: 'sse', url: 'https://docs.example.com' };

      await adapter.writeMcpServer(server1, { scope: 'project', projectRoot: testProjectDir });
      await adapter.writeMcpServer(server2, { scope: 'project', projectRoot: testProjectDir });

      await adapter.removeMcpServer('sqlite', { scope: 'project', projectRoot: testProjectDir });

      const list = await adapter.listMcpServers({ scope: 'project', projectRoot: testProjectDir });
      assert.deepStrictEqual(list, ['remote-docs']);

      const loaded1 = await adapter.readMcpServer('sqlite', { scope: 'project', projectRoot: testProjectDir });
      assert.strictEqual(loaded1, null);
    });

    it('removeMcpServer on nonexistent server does not throw', async () => {
      await adapter.removeMcpServer('nonexistent', { scope: 'project', projectRoot: testProjectDir });
      assert.ok(true);
    });
  });

  describe('Real Kilo smoke test (opt-in)', () => {
    it('installs through adapter and kilo mcp list lists the server', async (t) => {
      if (!process.env.AISK_REAL_KILO) {
        t.skip('Skipped: AISK_REAL_KILO is not set');
        return;
      }

      const isolatedHome = path.join(testTempDir, 'real-kilo-home');
      const isolatedProject = path.join(testTempDir, 'real-kilo-project');
      await fs.promises.mkdir(isolatedHome, { recursive: true });
      await fs.promises.mkdir(isolatedProject, { recursive: true });

      const realAdapter = new KiloAdapter(() => isolatedHome);

      // Global scope install
      await realAdapter.writeMcpServer(
        {
          id: 'swk-global-smoke',
          type: 'stdio',
          command: 'echo',
          args: ['global-smoke'],
        },
        { scope: 'global' }
      );

      // Project scope install
      await realAdapter.writeMcpServer(
        {
          id: 'swk-proj-smoke',
          type: 'stdio',
          command: 'echo',
          args: ['proj-smoke'],
        },
        { scope: 'project', projectRoot: isolatedProject }
      );

      const env = {
        ...process.env,
        HOME: isolatedHome,
        XDG_CONFIG_HOME: path.join(isolatedHome, '.config'),
      };

      // Check global listing from Kilo CLI
      const globalOutput = execSync('kilo mcp list', {
        env,
        cwd: isolatedHome,
        encoding: 'utf-8',
      });
      assert.ok(
        globalOutput.includes('swk-global-smoke'),
        `Expected "swk-global-smoke" in kilo mcp list output:\n${globalOutput}`
      );

      // Check project listing from Kilo CLI
      const projectOutput = execSync('kilo mcp list', {
        env,
        cwd: isolatedProject,
        encoding: 'utf-8',
      });
      assert.ok(
        projectOutput.includes('swk-proj-smoke'),
        `Expected "swk-proj-smoke" in project kilo mcp list output:\n${projectOutput}`
      );
    });
  });

  describe('rules', () => {
    it('rulePath/readRule/writeRule round-trip for both scopes', async () => {
      const projectRule: CanonicalRule = {
        content: '# Project Rules\n\n- Follow TypeScript strict guidelines\n- Run tests before commit\n',
      };

      const globalRule: CanonicalRule = {
        content: '# Global Rules\n\n- Global user preferences\n',
      };

      const projectRuleLocation = { scope: 'project' as const, projectRoot: testProjectDir };
      assert.strictEqual(adapter.rulePath(projectRuleLocation), path.join(testProjectDir, 'CLAUDE.md'));
      const initialProjectRule = await adapter.readRule(projectRuleLocation);
      assert.strictEqual(initialProjectRule, null);

      await adapter.writeRule(projectRule, projectRuleLocation);
      const readProjectRule = await adapter.readRule(projectRuleLocation);
      assert.deepStrictEqual(readProjectRule, projectRule);

      const globalRuleLocation = { scope: 'global' as const };
      assert.strictEqual(
        adapter.rulePath(globalRuleLocation),
        path.join(testHomeDir, '.config', 'kilo', 'AGENTS.md')
      );
      const initialGlobalRule = await adapter.readRule(globalRuleLocation);
      assert.strictEqual(initialGlobalRule, null);

      await adapter.writeRule(globalRule, globalRuleLocation);
      const readGlobalRule = await adapter.readRule(globalRuleLocation);
      assert.deepStrictEqual(readGlobalRule, globalRule);
    });
  });
});
