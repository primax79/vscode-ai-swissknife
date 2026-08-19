import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseSkillMarkdown } from '../adapters/claude';
import type { CanonicalSkill } from '../adapters/types';
import type { AssistantId } from '../domain/types';
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
    files: [
      {
        path: 'scripts/helper.sh',
        content: new Uint8Array([0x23, 0x21, 0x2f, 0x62, 0x69, 0x6e, 0x2f, 0x73, 0x68]),
        mode: 0o755,
      },
      {
        path: 'assets/image.png',
        content: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      },
    ],
  };

  it('translates to claude-code losslessly with preserved files, binary content, and modes', () => {
    assert.strictEqual(realCanonicalSkill.name, 'gitignore');
    assert.ok(realCanonicalSkill.description.length > 0);
    assert.ok(realCanonicalSkill.body.includes('# Skill: gitignore'));

    const result = translateSkill(realCanonicalSkill, 'claude-code');

    assert.strictEqual(result.overall, 'lossless');
    assert.deepStrictEqual(result.diagnostics, []);
    assert.deepStrictEqual(result.value, realCanonicalSkill);
    assert.strictEqual(result.value.files[0].mode, 0o755);
    assert.deepStrictEqual(result.value.files[1].content, realCanonicalSkill.files[1].content);
  });

  it('translates to kilo-code losslessly with preserved files, binary content, and modes', () => {
    const result = translateSkill(realCanonicalSkill, 'kilo-code');

    assert.strictEqual(result.overall, 'lossless');
    assert.deepStrictEqual(result.diagnostics, []);
    assert.deepStrictEqual(result.value, realCanonicalSkill);
    assert.strictEqual(result.value.files[0].mode, 0o755);
  });

  it('preserves non-empty extraFields through translation', () => {
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

    const toKiloResult = translateSkill(skillWithExtra, 'kilo-code');
    assert.strictEqual(toKiloResult.overall, 'lossless');
    assert.deepStrictEqual(toKiloResult.diagnostics, []);
    assert.deepStrictEqual(toKiloResult.value, skillWithExtra);
    assert.deepStrictEqual(toKiloResult.value.extraFields, skillWithExtra.extraFields);

    const toClaudeResult = translateSkill(skillWithExtra, 'claude-code');
    assert.strictEqual(toClaudeResult.overall, 'lossless');
    assert.deepStrictEqual(toClaudeResult.diagnostics, []);
    assert.deepStrictEqual(toClaudeResult.value, skillWithExtra);
    assert.deepStrictEqual(toClaudeResult.value.extraFields, skillWithExtra.extraFields);
    const toCopilotResult = translateSkill(skillWithExtra, 'github-copilot');
    assert.strictEqual(toCopilotResult.overall, 'lossless');
    assert.deepStrictEqual(toCopilotResult.diagnostics, []);
    assert.deepStrictEqual(toCopilotResult.value, skillWithExtra);
  });

  it('returns overall: unsupported for non-Phase-2 assistants with target diagnostic and no exception', () => {
    const unsupportedTargets: AssistantId[] = ['codex-cli', 'gemini-cli'];

    for (const target of unsupportedTargets) {
      const result = translateSkill(realCanonicalSkill, target);
      assert.strictEqual(result.overall, 'unsupported');
      assert.strictEqual(result.diagnostics.length, 1);
      assert.strictEqual(result.diagnostics[0].code, 'unsupported-target');
      assert.strictEqual(result.diagnostics[0].severity, 'error');
      assert.strictEqual(result.diagnostics[0].impact, 'unsupported');
      assert.strictEqual(result.diagnostics[0].field, 'target');
      assert.ok(result.diagnostics[0].message.includes(target));
      // Content is preserved for inspection
      assert.strictEqual(result.value.name, realCanonicalSkill.name);
    }
  });

  it('proves caller receives translation.value as the mutated/translated object', () => {
    const customSkill: CanonicalSkill = {
      name: 'test-skill',
      description: 'Original desc',
      body: 'Original body',
      extraFields: {},
      files: [],
    };

    const translation = translateSkill(customSkill, 'kilo-code');
    // Ensure translation.value is used and distinct copy
    assert.notStrictEqual(translation.value, customSkill);
    assert.deepStrictEqual(translation.value, customSkill);
  });
});
