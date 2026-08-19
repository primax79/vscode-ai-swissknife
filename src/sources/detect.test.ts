import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { findSkillDirs, findAgentFiles, extractSkillFrontmatter } from './detect';

function getFixturesRoot(): string {
  const candidateOut = path.join(__dirname, '__fixtures__');
  if (fs.existsSync(candidateOut)) return candidateOut;
  return path.resolve(__dirname, '../../src/sources/__fixtures__');
}

describe('detect — extractSkillFrontmatter', () => {
  it('extracts name and description with quotes', () => {
    const raw = `---
name: "my-skill"
description: 'A test skill'
---
# Content`;
    const res = extractSkillFrontmatter(raw);
    assert.strictEqual(res.name, 'my-skill');
    assert.strictEqual(res.description, 'A test skill');
  });

  it('extracts unquoted name and description', () => {
    const raw = `---
name: unquoted-skill
description: Simple description text
---
`;
    const res = extractSkillFrontmatter(raw);
    assert.strictEqual(res.name, 'unquoted-skill');
    assert.strictEqual(res.description, 'Simple description text');
  });

  it('returns empty object when no frontmatter is present', () => {
    const raw = '# Just Markdown\nNo frontmatter';
    const res = extractSkillFrontmatter(raw);
    assert.deepStrictEqual(res, {});
  });
});

describe('detect — findSkillDirs with committed fixtures', () => {
  const fixturesRoot = getFixturesRoot();
  const rootSkillFixture = path.join(fixturesRoot, 'root-skill');
  const nestedSkillsFixture = path.join(fixturesRoot, 'nested-skills');
  const mixedFixture = path.join(fixturesRoot, 'mixed');

  it('detects single root skill', async () => {
    const { skills, diagnostics } = await findSkillDirs(rootSkillFixture);
    assert.strictEqual(skills.length, 1);
    assert.strictEqual(skills[0].name, 'root-skill');
    assert.strictEqual(skills[0].description, 'A standalone root skill fixture');
    assert.strictEqual(diagnostics.length, 0);
  });

  it('detects nested skills and ignores auxiliary directories', async () => {
    const { skills, diagnostics } = await findSkillDirs(nestedSkillsFixture);
    assert.strictEqual(skills.length, 2);

    const names = skills.map((s) => s.name).sort();
    assert.deepStrictEqual(names, ['nested-skill-a', 'nested-skill-b']);
    assert.strictEqual(diagnostics.length, 0);

    assert.strictEqual(skills.some((s) => s.path.includes('scripts')), false);
  });

  it('captures detection diagnostics for malformed skill frontmatter beside valid skills', async () => {
    const { skills, diagnostics } = await findSkillDirs(mixedFixture);
    assert.strictEqual(skills.length, 2);

    const valid = skills.find((s) => s.name === 'valid-skill');
    assert.ok(valid);
    assert.strictEqual(valid.description, 'A valid skill in mixed directory');

    const malformed = skills.find((s) => s.name === 'malformed-skill');
    assert.ok(malformed);

    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual(diagnostics[0].code, 'invalid-frontmatter');
    assert.strictEqual(diagnostics[0].severity, 'warning');
    assert.ok(diagnostics[0].path.includes('malformed-skill'));
  });

  it('throws ENOENT for non-existent directory', async () => {
    try {
      await findSkillDirs(path.join(fixturesRoot, 'does-not-exist-' + Date.now()));
      assert.fail('Should have thrown an error for unreadable root');
    } catch (err: unknown) {
      assert.strictEqual((err as NodeJS.ErrnoException).code, 'ENOENT');
    }
  });
});

describe('detect — findAgentFiles', () => {
  const fixturesRoot = getFixturesRoot();

  it('detects agent files inside agents/ directory', async () => {
    const { agents, diagnostics } = await findAgentFiles(fixturesRoot);
    const reviewer = agents.find((a) => a.name === 'code-reviewer');
    assert.ok(reviewer);
    assert.strictEqual(reviewer.description, 'Automated code reviewer agent');
    assert.strictEqual(diagnostics.length, 0);
  });
});
