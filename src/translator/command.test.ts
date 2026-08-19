import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import type { CanonicalCommand } from '../adapters/types';
import { translateCommand } from './command';

describe('translateCommand', () => {
  const cmd: CanonicalCommand = {
    name: 'review',
    description: 'Review PR code',
    agent: 'qa-engineer',
    model: 'claude-3-5-sonnet',
    subtask: true,
    body: 'Please review current git diff.\n',
    extraFields: {
      tags: ['git', 'review'],
    },
  };

  it('translates command to claude-code losslessly', () => {
    const result = translateCommand(cmd, 'claude-code');
    assert.strictEqual(result.overall, 'lossless');
    assert.strictEqual(result.value.name, 'review');
    assert.strictEqual(result.value.agent, 'qa-engineer');
    assert.strictEqual(result.value.subtask, true);
    assert.deepStrictEqual(result.value.extraFields, { tags: ['git', 'review'] });
  });

  it('translates command to kilo-code losslessly', () => {
    const result = translateCommand(cmd, 'kilo-code');
    assert.strictEqual(result.overall, 'lossless');
    assert.strictEqual(result.value.name, 'review');
    assert.strictEqual(result.value.description, 'Review PR code');
    assert.strictEqual(result.value.agent, 'qa-engineer');
  });

  it('translates command to github-copilot losslessly', () => {
    const result = translateCommand(cmd, 'github-copilot');
    assert.strictEqual(result.overall, 'lossless');
    assert.strictEqual(result.value.name, 'review');
    assert.strictEqual(result.value.description, 'Review PR code');
  });

  it('returns unsupported for non-Phase-2 target assistants', () => {
    const result = translateCommand(cmd, 'gemini-cli');
    assert.strictEqual(result.overall, 'unsupported');
    assert.strictEqual(result.diagnostics.length, 1);
    assert.strictEqual(result.diagnostics[0].code, 'unsupported-target');
  });
});
