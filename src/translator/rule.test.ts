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

  it('returns unsupported for non-Phase-1 target assistants', () => {
    const unsupportedTargets: AssistantId[] = ['github-copilot', 'codex-cli', 'gemini-cli'];

    for (const target of unsupportedTargets) {
      const result = translateRule(realCanonicalRule, target);
      assert.strictEqual(result.overall, 'unsupported');
      assert.strictEqual(result.diagnostics.length, 1);
      assert.strictEqual(result.diagnostics[0].code, 'unsupported-target');
      assert.strictEqual(result.diagnostics[0].severity, 'error');
    }
  });
});
