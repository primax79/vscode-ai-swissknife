import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import type { CanonicalMcpServer } from '../adapters/types';
import { translateMcpServer } from './mcp';

describe('translateMcpServer', () => {
  const mcp: CanonicalMcpServer = {
    id: 'sqlite',
    type: 'stdio',
    command: 'uvx',
    args: ['mcp-server-sqlite', '--db-path', 'app.db'],
    env: {
      DEBUG: '1',
    },
  };

  it('translates MCP server to claude-code, kilo-code, and github-copilot losslessly', () => {
    const resClaude = translateMcpServer(mcp, 'claude-code');
    assert.strictEqual(resClaude.overall, 'lossless');
    assert.strictEqual(resClaude.value.id, 'sqlite');
    assert.strictEqual(resClaude.value.command, 'uvx');
    assert.deepStrictEqual(resClaude.value.args, ['mcp-server-sqlite', '--db-path', 'app.db']);

    const resKilo = translateMcpServer(mcp, 'kilo-code');
    assert.strictEqual(resKilo.overall, 'lossless');
    assert.strictEqual(resKilo.value.id, 'sqlite');

    const resCopilot = translateMcpServer(mcp, 'github-copilot');
    assert.strictEqual(resCopilot.overall, 'lossless');
    assert.strictEqual(resCopilot.value.id, 'sqlite');
  });

  it('returns unsupported for non-Phase-2 target assistants', () => {
    const res = translateMcpServer(mcp, 'codex-cli');
    assert.strictEqual(res.overall, 'unsupported');
    assert.strictEqual(res.diagnostics.length, 1);
    assert.strictEqual(res.diagnostics[0].code, 'unsupported-target');
  });
});
