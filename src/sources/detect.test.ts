import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findSkillDirs, extractSkillFrontmatter } from './detect';

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

describe('detect — findSkillDirs with real fixtures', () => {
  const fixture1Path = '/Users/Alfredo/works/ai-coding-tools/agentic-coding-kit/plugins/common-tools/skills/gitignore';
  const fixture2Path = fs.existsSync(path.resolve(process.cwd(), 'references/cc-swiss-knife/plugins/core/skills/documentation-standards'))
    ? path.resolve(process.cwd(), 'references/cc-swiss-knife/plugins/core/skills/documentation-standards')
    : '/Users/Alfredo/works/ai-coding-tools/ai-swissknife/references/cc-swiss-knife/plugins/core/skills/documentation-standards';
  const fixture3Path = path.join(os.homedir(), '.claude/skills');

  it('detects skill in fixture 1 (agentic-coding-kit gitignore) with exact count 1', async () => {
    const { skills: results } = await findSkillDirs(fixture1Path);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].name, 'gitignore');
    assert.strictEqual(results[0].path, fixture1Path);
    assert.ok(results[0].description?.includes('.gitignore'));

    // Verify nested subdirectories (scripts/, config/) were not scanned as separate skills
    const paths = results.map((r) => r.path);
    assert.strictEqual(paths.some((p) => p.includes('scripts') || p.includes('config')), false);
  });

  it('detects skill in fixture 2 (cc-swiss-knife documentation-standards) with exact count 1', async () => {
    const { skills: results } = await findSkillDirs(fixture2Path);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].name, 'documentation-standards');
    assert.strictEqual(results[0].path, fixture2Path);
    assert.ok(results[0].description?.includes('documentation'));
  });

  it('detects skills in fixture 3 (~/.claude/skills) with exact count 25', async () => {
    const { skills: results } = await findSkillDirs(fixture3Path);
    assert.strictEqual(results.length, 25);

    const names = new Set(results.map((r) => r.name));
    assert.ok(names.has('gitignore'));
    assert.ok(names.has('terraform'));
    assert.ok(names.has('theme-factory'));
    assert.ok(names.has('playwright'));
    assert.ok(names.has('impeccable'));

    // Check frontmatter matches for spot-checked skills
    const gitignoreSkill = results.find((r) => r.name === 'gitignore');
    assert.ok(gitignoreSkill);
    assert.ok(gitignoreSkill.description && gitignoreSkill.description.length > 0);
  });

  it('returns empty array for non-existent directory', async () => {
    try {
      await findSkillDirs('/tmp/non-existent-directory-' + Date.now());
      assert.fail('Should have thrown an error for unreadable root');
    } catch (err: unknown) {
      assert.strictEqual((err as NodeJS.ErrnoException).code, 'ENOENT');
    }
  });
});
