import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CanonicalRule } from '../adapters/types';
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

  it('translates Claude -> Kilo losslessly with unchanged content using real rule fixture', () => {
    assert.ok(realCanonicalRule.content.length > 0);

    const result = translateRule(realCanonicalRule, 'claude-code', 'kilo-code');

    assert.strictEqual(result.diagnostic, 'lossless');
    assert.deepStrictEqual(result.notes, []);
    assert.deepStrictEqual(result.value, realCanonicalRule);
  });

  it('translates Kilo -> Claude losslessly with unchanged content using real rule fixture', () => {
    const result = translateRule(realCanonicalRule, 'kilo-code', 'claude-code');

    assert.strictEqual(result.diagnostic, 'lossless');
    assert.deepStrictEqual(result.notes, []);
    assert.deepStrictEqual(result.value, realCanonicalRule);
  });

  it('short-circuits same-assistant translation explicitly as lossless (claude-code -> claude-code and kilo-code -> kilo-code)', () => {
    const claudeToClaude = translateRule(realCanonicalRule, 'claude-code', 'claude-code');
    assert.strictEqual(claudeToClaude.diagnostic, 'lossless');
    assert.deepStrictEqual(claudeToClaude.notes, []);
    assert.deepStrictEqual(claudeToClaude.value, realCanonicalRule);

    const kiloToKilo = translateRule(realCanonicalRule, 'kilo-code', 'kilo-code');
    assert.strictEqual(kiloToKilo.diagnostic, 'lossless');
    assert.deepStrictEqual(kiloToKilo.notes, []);
    assert.deepStrictEqual(kiloToKilo.value, realCanonicalRule);
  });
});
