import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodexAdapter, codexAdapter } from './codex';
import type {
  CanonicalRule,
  CanonicalSkill,
  CanonicalAgent,
  CanonicalMcpServer,
} from './types';

describe('CodexAdapter', () => {
  let testTempDir: string;
  let testHomeDir: string;
  let testProjectDir: string;
  let adapter: CodexAdapter;

  beforeEach(async () => {
    testTempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codex-adapter-test-'));
    testHomeDir = path.join(testTempDir, 'home');
    testProjectDir = path.join(testTempDir, 'project');
    await fs.promises.mkdir(testHomeDir, { recursive: true });
    await fs.promises.mkdir(testProjectDir, { recursive: true });
    adapter = new CodexAdapter(() => testHomeDir);
  });

  afterEach(async () => {
    if (testTempDir) {
      await fs.promises.rm(testTempDir, { recursive: true, force: true });
    }
  });

  describe('assistant identity', () => {
    it('has assistant = codex-cli', () => {
      assert.strictEqual(adapter.assistant, 'codex-cli');
      assert.strictEqual(codexAdapter.assistant, 'codex-cli');
    });
  });

  describe('path resolution', () => {
    it('skillPath returns .codex/skills/ on project scope', () => {
      const p = adapter.skillPath('my-skill', { scope: 'project', projectRoot: testProjectDir });
      assert.strictEqual(p, path.join(testProjectDir, '.codex', 'skills', 'my-skill', 'SKILL.md'));
    });

    it('agentPath returns .codex/agents/*.toml on project scope', () => {
      const p = adapter.agentPath('tester', { scope: 'project', projectRoot: testProjectDir });
      assert.strictEqual(p, path.join(testProjectDir, '.codex', 'agents', 'tester.toml'));
    });

    it('rulePath returns AGENTS.md on project scope', () => {
      const p = adapter.rulePath({ scope: 'project', projectRoot: testProjectDir });
      assert.strictEqual(p, path.join(testProjectDir, 'AGENTS.md'));
    });
  });

  describe('skills', () => {
    it('round-trips skill under .codex/skills/', async () => {
      const skill: CanonicalSkill = {
        name: 'codex-skill',
        description: 'A skill for codex',
        body: '# Codex Skill\n',
        extraFields: {},
        files: [],
      };

      await adapter.writeSkill(skill, { scope: 'project', projectRoot: testProjectDir });
      const loaded = await adapter.readSkill(skill.name, {
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.deepStrictEqual(loaded, skill);
    });
  });

  describe('agents', () => {
    it('round-trips agent in TOML format', async () => {
      const agent: CanonicalAgent = {
        name: 'codex-agent',
        description: 'An agent in TOML',
        tools: [],
        permissions: {},
        model: 'gpt-4o',
        body: 'Follow strict instructions.',
        extraFields: {},
      };

      await adapter.writeAgent(agent, { scope: 'project', projectRoot: testProjectDir });
      const loaded = await adapter.readAgent(agent.name, {
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.ok(loaded);
      assert.strictEqual(loaded.name, 'codex-agent');
      assert.strictEqual(loaded.description, 'An agent in TOML');
      assert.strictEqual(loaded.model, 'gpt-4o');
      assert.strictEqual(loaded.body, 'Follow strict instructions.');
    });
  });

  describe('mcpServers', () => {
    it('round-trips MCP server config in .codex/config.json', async () => {
      const mcp: CanonicalMcpServer = {
        id: 'db',
        type: 'stdio',
        command: 'uvx',
        args: ['mcp-server-sqlite'],
      };

      await adapter.writeMcpServer(mcp, { scope: 'project', projectRoot: testProjectDir });
      const loaded = await adapter.readMcpServer('db', {
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.ok(loaded);
      assert.strictEqual(loaded.id, 'db');
      assert.strictEqual(loaded.command, 'uvx');
    });

    it('removeMcpServer removes only the specified server', async () => {
      const server1: CanonicalMcpServer = { id: 'db', type: 'stdio', command: 'uvx' };
      const server2: CanonicalMcpServer = { id: 'remote-docs', type: 'sse', url: 'https://docs.example.com' };

      await adapter.writeMcpServer(server1, { scope: 'project', projectRoot: testProjectDir });
      await adapter.writeMcpServer(server2, { scope: 'project', projectRoot: testProjectDir });

      await adapter.removeMcpServer('db', { scope: 'project', projectRoot: testProjectDir });

      const list = await adapter.listMcpServers({ scope: 'project', projectRoot: testProjectDir });
      assert.deepStrictEqual(list, ['remote-docs']);

      const loaded1 = await adapter.readMcpServer('db', { scope: 'project', projectRoot: testProjectDir });
      assert.strictEqual(loaded1, null);
    });

    it('removeMcpServer on nonexistent server does not throw', async () => {
      await adapter.removeMcpServer('nonexistent', { scope: 'project', projectRoot: testProjectDir });
      assert.ok(true);
    });
  });

  describe('rules', () => {
    it('round-trips AGENTS.md for codex', async () => {
      const rule: CanonicalRule = {
        content: '# Codex Guidelines\n\nFollow best practices.\n',
      };

      await adapter.writeRule(rule, { scope: 'project', projectRoot: testProjectDir });
      const loaded = await adapter.readRule({ scope: 'project', projectRoot: testProjectDir });
      assert.deepStrictEqual(loaded, rule);
    });
  });
});
