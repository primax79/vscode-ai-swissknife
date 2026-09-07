import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CopilotAdapter, copilotAdapter } from './copilot';
import type {
  CanonicalRule,
  CanonicalSkill,
  CanonicalAgent,
  CanonicalCommand,
  CanonicalMcpServer,
} from './types';

describe('CopilotAdapter', () => {
  let testTempDir: string;
  let testHomeDir: string;
  let testProjectDir: string;
  let adapter: CopilotAdapter;

  beforeEach(async () => {
    testTempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'copilot-adapter-test-'));
    testHomeDir = path.join(testTempDir, 'home');
    testProjectDir = path.join(testTempDir, 'project');
    await fs.promises.mkdir(testHomeDir, { recursive: true });
    await fs.promises.mkdir(testProjectDir, { recursive: true });
    adapter = new CopilotAdapter(() => testHomeDir);
  });

  afterEach(async () => {
    if (testTempDir) {
      await fs.promises.rm(testTempDir, { recursive: true, force: true });
    }
  });

  describe('assistant identity', () => {
    it('has assistant = github-copilot', () => {
      assert.strictEqual(adapter.assistant, 'github-copilot');
      assert.strictEqual(copilotAdapter.assistant, 'github-copilot');
    });
  });

  describe('path resolution', () => {
    it('skillPath returns .github/skills on project scope', () => {
      const projectPath = adapter.skillPath('my-skill', {
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.strictEqual(
        projectPath,
        path.join(testProjectDir, '.github', 'skills', 'my-skill', 'SKILL.md')
      );
    });

    it('agentPath returns .github/agents/*.agent.md on project scope', () => {
      const projectPath = adapter.agentPath('tester', {
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.strictEqual(
        projectPath,
        path.join(testProjectDir, '.github', 'agents', 'tester.agent.md')
      );
    });

    it('commandPath returns .github/prompts/*.prompt.md on project scope', () => {
      const projectPath = adapter.commandPath('review', {
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.strictEqual(
        projectPath,
        path.join(testProjectDir, '.github', 'prompts', 'review.prompt.md')
      );
    });

    it('mcpConfigPath returns .vscode/mcp.json on project scope', () => {
      const projectPath = adapter.mcpConfigPath({
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.strictEqual(projectPath, path.join(testProjectDir, '.vscode', 'mcp.json'));
    });

    it('rulePath returns .github/copilot-instructions.md on project scope', () => {
      const projectPath = adapter.rulePath({
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.strictEqual(
        projectPath,
        path.join(testProjectDir, '.github', 'copilot-instructions.md')
      );
    });
  });

  describe('skills', () => {
    it('round-trips skill under .github/skills/', async () => {
      const skill: CanonicalSkill = {
        name: 'test-copilot-skill',
        description: 'A test skill for Copilot',
        body: '# Copilot Skill\nContent here.\n',
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
    it('round-trips agent under .github/agents/*.agent.md', async () => {
      const agent: CanonicalAgent = {
        name: 'qa-tester',
        description: 'QA Agent for Copilot',
        tools: ['read', 'edit'],
        permissions: {},
        model: 'gpt-4o',
        body: '# QA Tester\nVerify code.\n',
        extraFields: {},
      };

      await adapter.writeAgent(agent, { scope: 'project', projectRoot: testProjectDir });
      const loaded = await adapter.readAgent(agent.name, {
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.deepStrictEqual(loaded, agent);

      const list = await adapter.listAgents({ scope: 'project', projectRoot: testProjectDir });
      assert.deepStrictEqual(list, ['qa-tester']);
    });
  });

  describe('commands / prompts', () => {
    it('round-trips prompt command under .github/prompts/*.prompt.md', async () => {
      const cmd: CanonicalCommand = {
        name: 'explain-code',
        description: 'Explain selected code',
        body: 'Explain how this code works.\n',
        extraFields: {},
      };

      await adapter.writeCommand(cmd, { scope: 'project', projectRoot: testProjectDir });
      const loaded = await adapter.readCommand(cmd.name, {
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.deepStrictEqual(loaded, cmd);

      const list = await adapter.listCommands({ scope: 'project', projectRoot: testProjectDir });
      assert.deepStrictEqual(list, ['explain-code']);
    });
  });

  describe('mcpServers', () => {
    it('round-trips MCP server under .vscode/mcp.json', async () => {
      const server: CanonicalMcpServer = {
        id: 'github',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
      };

      await adapter.writeMcpServer(server, { scope: 'project', projectRoot: testProjectDir });
      const loaded = await adapter.readMcpServer('github', {
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.ok(loaded);
      assert.strictEqual(loaded.id, 'github');
      assert.strictEqual(loaded.command, 'npx');
    });

    it('removeMcpServer removes only the specified server', async () => {
      const server1: CanonicalMcpServer = { id: 'github', type: 'stdio', command: 'npx' };
      const server2: CanonicalMcpServer = { id: 'remote-docs', type: 'sse', url: 'https://docs.example.com' };

      await adapter.writeMcpServer(server1, { scope: 'project', projectRoot: testProjectDir });
      await adapter.writeMcpServer(server2, { scope: 'project', projectRoot: testProjectDir });

      await adapter.removeMcpServer('github', { scope: 'project', projectRoot: testProjectDir });

      const list = await adapter.listMcpServers({ scope: 'project', projectRoot: testProjectDir });
      assert.deepStrictEqual(list, ['remote-docs']);

      const loaded1 = await adapter.readMcpServer('github', { scope: 'project', projectRoot: testProjectDir });
      assert.strictEqual(loaded1, null);
    });

    it('removeMcpServer on nonexistent server does not throw', async () => {
      await adapter.removeMcpServer('nonexistent', { scope: 'project', projectRoot: testProjectDir });
      assert.ok(true);
    });
  });

  describe('rules / instructions', () => {
    it('round-trips copilot-instructions.md', async () => {
      const rule: CanonicalRule = {
        content: '# Copilot Instructions\n\nAlways use TypeScript.\n',
      };

      await adapter.writeRule(rule, { scope: 'project', projectRoot: testProjectDir });
      const loaded = await adapter.readRule({ scope: 'project', projectRoot: testProjectDir });
      assert.deepStrictEqual(loaded, rule);
    });
  });
});
