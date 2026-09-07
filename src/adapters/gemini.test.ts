import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GeminiAdapter, geminiAdapter } from './gemini';
import type {
  CanonicalRule,
  CanonicalSkill,
  CanonicalCommand,
  CanonicalMcpServer,
} from './types';

describe('GeminiAdapter', () => {
  let testTempDir: string;
  let testHomeDir: string;
  let testProjectDir: string;
  let adapter: GeminiAdapter;

  beforeEach(async () => {
    testTempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gemini-adapter-test-'));
    testHomeDir = path.join(testTempDir, 'home');
    testProjectDir = path.join(testTempDir, 'project');
    await fs.promises.mkdir(testHomeDir, { recursive: true });
    await fs.promises.mkdir(testProjectDir, { recursive: true });
    adapter = new GeminiAdapter(() => testHomeDir);
  });

  afterEach(async () => {
    if (testTempDir) {
      await fs.promises.rm(testTempDir, { recursive: true, force: true });
    }
  });

  describe('assistant identity', () => {
    it('has assistant = gemini-cli', () => {
      assert.strictEqual(adapter.assistant, 'gemini-cli');
      assert.strictEqual(geminiAdapter.assistant, 'gemini-cli');
    });
  });

  describe('path resolution', () => {
    it('skillPath returns .gemini/skills/ on project scope', () => {
      const p = adapter.skillPath('my-skill', { scope: 'project', projectRoot: testProjectDir });
      assert.strictEqual(p, path.join(testProjectDir, '.gemini', 'skills', 'my-skill', 'SKILL.md'));
    });

    it('commandPath returns .gemini/commands/*.toml on project scope', () => {
      const p = adapter.commandPath('git/commit', { scope: 'project', projectRoot: testProjectDir });
      assert.strictEqual(p, path.join(testProjectDir, '.gemini', 'commands', 'git:commit.toml'));
    });

    it('rulePath returns GEMINI.md on project scope', () => {
      const p = adapter.rulePath({ scope: 'project', projectRoot: testProjectDir });
      assert.strictEqual(p, path.join(testProjectDir, 'GEMINI.md'));
    });
  });

  describe('skills', () => {
    it('round-trips skill under .gemini/skills/', async () => {
      const skill: CanonicalSkill = {
        name: 'gemini-skill',
        description: 'A skill for gemini',
        body: '# Gemini Skill\n',
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

  describe('commands', () => {
    it('round-trips command in TOML format', async () => {
      const cmd: CanonicalCommand = {
        name: 'git:commit',
        description: 'Create a conventional commit',
        body: 'Generate a clean commit message.',
        extraFields: {},
      };

      await adapter.writeCommand(cmd, { scope: 'project', projectRoot: testProjectDir });
      const loaded = await adapter.readCommand(cmd.name, {
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.ok(loaded);
      assert.strictEqual(loaded.name, 'git:commit');
      assert.strictEqual(loaded.description, 'Create a conventional commit');
      assert.strictEqual(loaded.body, 'Generate a clean commit message.');
    });
  });

  describe('mcpServers', () => {
    it('round-trips MCP server config in settings.json', async () => {
      const mcp: CanonicalMcpServer = {
        id: 'docs',
        type: 'sse',
        url: 'https://mcp.example.com/sse',
      };

      await adapter.writeMcpServer(mcp, { scope: 'project', projectRoot: testProjectDir });
      const loaded = await adapter.readMcpServer('docs', {
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.ok(loaded);
      assert.strictEqual(loaded.id, 'docs');
      assert.strictEqual(loaded.url, 'https://mcp.example.com/sse');
    });

    it('removeMcpServer removes only the specified server', async () => {
      const server1: CanonicalMcpServer = { id: 'docs', type: 'sse', url: 'https://mcp.example.com/sse' };
      const server2: CanonicalMcpServer = { id: 'sqlite', type: 'stdio', command: 'uvx' };

      await adapter.writeMcpServer(server1, { scope: 'project', projectRoot: testProjectDir });
      await adapter.writeMcpServer(server2, { scope: 'project', projectRoot: testProjectDir });

      await adapter.removeMcpServer('docs', { scope: 'project', projectRoot: testProjectDir });

      const list = await adapter.listMcpServers({ scope: 'project', projectRoot: testProjectDir });
      assert.deepStrictEqual(list, ['sqlite']);

      const loaded1 = await adapter.readMcpServer('docs', { scope: 'project', projectRoot: testProjectDir });
      assert.strictEqual(loaded1, null);
    });

    it('removeMcpServer on nonexistent server does not throw', async () => {
      await adapter.removeMcpServer('nonexistent', { scope: 'project', projectRoot: testProjectDir });
      assert.ok(true);
    });
  });

  describe('rules', () => {
    it('round-trips GEMINI.md', async () => {
      const rule: CanonicalRule = {
        content: '# Gemini Guidelines\n\nBe concise.\n',
      };

      await adapter.writeRule(rule, { scope: 'project', projectRoot: testProjectDir });
      const loaded = await adapter.readRule({ scope: 'project', projectRoot: testProjectDir });
      assert.deepStrictEqual(loaded, rule);
    });
  });
});
