import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CanonicalRule } from '../adapters/types';
import type { AssistantId } from '../domain/types';
import { translateRule } from './rule';

function getRealRuleFixturePath(): string {
  const candidates = [
    path.resolve(process.cwd(), 'tasks/AGENTS.md'),
    path.resolve(process.cwd(), '../tasks/AGENTS.md'),
    path.resolve(os.homedir(), '.claude/CLAUDE.md'),
    path.resolve(os.homedir(), '.config/kilo/AGENTS.md'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Could not find real rule fixture in candidates: ${candidates.join(', ')}`);
}

describe('translateRule', () => {
  const fixturePath = getRealRuleFixturePath();
  const rawContent = fs.readFileSync(fixturePath, 'utf-8');
  const realCanonicalRule: CanonicalRule = { content: rawContent };

  it('translates to claude-code and kilo-code losslessly with unchanged content', () => {
    assert.ok(realCanonicalRule.content.length > 0);

    const claudeResult = translateRule(realCanonicalRule, 'claude-code');
    assert.strictEqual(claudeResult.overall, 'lossless');
    assert.deepStrictEqual(claudeResult.diagnostics, []);
    assert.deepStrictEqual(claudeResult.value, realCanonicalRule);

    const kiloResult = translateRule(realCanonicalRule, 'kilo-code');
    assert.strictEqual(kiloResult.overall, 'lossless');
    assert.deepStrictEqual(kiloResult.diagnostics, []);
    assert.deepStrictEqual(kiloResult.value, realCanonicalRule);
  });

  it('returns unsupported for non-supported target assistants', () => {
    const res = translateRule(realCanonicalRule, 'cursor' as unknown as AssistantId);
    assert.strictEqual(res.overall, 'unsupported');
    assert.strictEqual(res.diagnostics.length, 1);
    assert.strictEqual(res.diagnostics[0].code, 'unsupported-target');
  });
});
