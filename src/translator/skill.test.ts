import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseSkillMarkdown } from '../adapters/claude';
import type { CanonicalSkill } from '../adapters/types';
import { translateSkill } from './skill';

function getRealSkillFixturePath(): string {
  const candidates = [
    '/Users/Alfredo/works/ai-coding-tools/agentic-coding-kit/plugins/common-tools/skills/gitignore/SKILL.md',
    path.resolve(process.cwd(), '../agentic-coding-kit/plugins/common-tools/skills/gitignore/SKILL.md'),
    path.resolve(process.cwd(), '../../agentic-coding-kit/plugins/common-tools/skills/gitignore/SKILL.md'),
    path.resolve(process.cwd(), '../../../agentic-coding-kit/plugins/common-tools/skills/gitignore/SKILL.md'),
    path.resolve(os.homedir(), '.claude/skills/gitignore/SKILL.md'),
    path.resolve(os.homedir(), '.kilo/skills/gitignore/SKILL.md'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Could not find real SKILL.md fixture in candidates: ${candidates.join(', ')}`);
}

describe('translateSkill', () => {
  const fixturePath = getRealSkillFixturePath();
  const rawContent = fs.readFileSync(fixturePath, 'utf-8');
  const realCanonicalSkill: CanonicalSkill = {
    ...parseSkillMarkdown(rawContent),
    files: [],
  };

  it('translates Claude -> Kilo losslessly with unchanged value using real gitignore SKILL.md', () => {
    assert.strictEqual(realCanonicalSkill.name, 'gitignore');
    assert.ok(realCanonicalSkill.description.length > 0);
    assert.ok(realCanonicalSkill.body.includes('# Skill: gitignore'));

    const result = translateSkill(realCanonicalSkill, 'claude-code', 'kilo-code');

    assert.strictEqual(result.diagnostic, 'lossless');
    assert.deepStrictEqual(result.notes, []);
    assert.deepStrictEqual(result.value, realCanonicalSkill);
  });

  it('translates Kilo -> Claude losslessly with unchanged value using real gitignore SKILL.md', () => {
    const result = translateSkill(realCanonicalSkill, 'kilo-code', 'claude-code');

    assert.strictEqual(result.diagnostic, 'lossless');
    assert.deepStrictEqual(result.notes, []);
    assert.deepStrictEqual(result.value, realCanonicalSkill);
  });

  it('preserves non-empty extraFields through translation (Claude -> Kilo and Kilo -> Claude)', () => {
    const skillWithExtra: CanonicalSkill = {
      name: realCanonicalSkill.name,
      description: realCanonicalSkill.description,
      body: realCanonicalSkill.body,
      extraFields: {
        license: 'MIT',
        version: '2.1.0',
        author: 'gCube Team',
        tags: ['git', 'ignore', 'tooling'],
        customConfig: {
          autoSync: true,
          retries: 3,
        },
      },
      files: [],
    };

    const toKiloResult = translateSkill(skillWithExtra, 'claude-code', 'kilo-code');
    assert.strictEqual(toKiloResult.diagnostic, 'lossless');
    assert.deepStrictEqual(toKiloResult.notes, []);
    assert.deepStrictEqual(toKiloResult.value, skillWithExtra);
    assert.deepStrictEqual(toKiloResult.value.extraFields, skillWithExtra.extraFields);

    const toClaudeResult = translateSkill(skillWithExtra, 'kilo-code', 'claude-code');
    assert.strictEqual(toClaudeResult.diagnostic, 'lossless');
    assert.deepStrictEqual(toClaudeResult.notes, []);
    assert.deepStrictEqual(toClaudeResult.value, skillWithExtra);
    assert.deepStrictEqual(toClaudeResult.value.extraFields, skillWithExtra.extraFields);
  });

  it('short-circuits same-assistant translation explicitly as lossless (claude-code -> claude-code and kilo-code -> kilo-code)', () => {
    const claudeToClaude = translateSkill(realCanonicalSkill, 'claude-code', 'claude-code');
    assert.strictEqual(claudeToClaude.diagnostic, 'lossless');
    assert.deepStrictEqual(claudeToClaude.notes, []);
    assert.deepStrictEqual(claudeToClaude.value, realCanonicalSkill);

    const kiloToKilo = translateSkill(realCanonicalSkill, 'kilo-code', 'kilo-code');
    assert.strictEqual(kiloToKilo.diagnostic, 'lossless');
    assert.deepStrictEqual(kiloToKilo.notes, []);
    assert.deepStrictEqual(kiloToKilo.value, realCanonicalSkill);
  });
});
