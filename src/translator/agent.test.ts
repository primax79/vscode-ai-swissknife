import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import type { CanonicalAgent } from '../adapters/types';
import type { AssistantId } from '../domain/types';
import { translateAgent } from './agent';

describe('translateAgent', () => {
  const claudeAgent: CanonicalAgent = {
    name: 'researcher',
    description: 'Codebase researcher',
    tools: ['read', 'bash', 'webfetch'],
    permissions: {},
    model: 'claude-3-5-sonnet',
    body: '# Researcher\n\nInvestigates issues.\n',
    extraFields: {
      tags: ['research', 'ai'],
    },
  };

  const kiloAgent: CanonicalAgent = {
    name: 'kilo-executor',
    description: 'Executor agent for Kilo',
    mode: 'subagent',
    tools: [],
    permissions: {
      read: 'allow',
      edit: 'allow',
      bash: 'deny',
    },
    model: 'gemini-3.7-flash',
    variant: 'high',
    body: '# Executor\n\nRuns tasks.\n',
    extraFields: {
      customOpt: 123,
    },
  };

  it('translates Claude agent to Kilo agent mapping tools to permissions', () => {
    const result = translateAgent(claudeAgent, 'kilo-code');
    assert.strictEqual(result.overall, 'lossless');
    assert.strictEqual(result.value.name, 'researcher');
    assert.strictEqual(result.value.mode, 'primary');
    assert.strictEqual(result.value.permissions.read, 'allow');
    assert.strictEqual(result.value.permissions.bash, 'allow');
    assert.strictEqual(result.value.permissions.webfetch, 'allow');
    assert.deepStrictEqual(result.value.extraFields, { tags: ['research', 'ai'] });
  });

  it('translates Kilo agent to Claude agent mapping permissions to tools', () => {
    const result = translateAgent(kiloAgent, 'claude-code');
    assert.strictEqual(result.overall, 'lossless');
    assert.strictEqual(result.value.name, 'kilo-executor');
    assert.ok(result.value.tools.includes('read'));
    assert.ok(result.value.tools.includes('edit'));
    assert.strictEqual(result.value.tools.includes('bash'), false);
    assert.deepStrictEqual(result.value.extraFields, { customOpt: 123 });
  });

  it('translates Kilo agent to Copilot agent losslessly', () => {
    const result = translateAgent(kiloAgent, 'github-copilot');
    assert.strictEqual(result.overall, 'lossless');
    assert.strictEqual(result.value.name, 'kilo-executor');
    assert.ok(result.value.tools.includes('read'));
  });

  it('returns unsupported for non-supported targets', () => {
    const result = translateAgent(claudeAgent, 'cursor' as unknown as AssistantId);
    assert.strictEqual(result.overall, 'unsupported');
    assert.strictEqual(result.diagnostics.length, 1);
    assert.strictEqual(result.diagnostics[0].code, 'unsupported-target');
  });
});
