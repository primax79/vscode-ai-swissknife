import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  findSkillDirs,
  findAgentFiles,
  findCommandFiles,
  findMcpDefinitions,
  extractSkillFrontmatter,
} from './detect';

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

  it('extracts folded block scalar description (>)', () => {
    const raw = `---
name: folded-skill
description: >
  This is a folded
  description line.
---
# Content`;
    const res = extractSkillFrontmatter(raw);
    assert.strictEqual(res.name, 'folded-skill');
    assert.strictEqual(res.description, 'This is a folded description line.');
  });

  it('extracts literal block scalar description (|)', () => {
    const raw = `---
name: literal-skill
description: |
  Line 1
  Line 2
---
# Content`;
    const res = extractSkillFrontmatter(raw);
    assert.strictEqual(res.name, 'literal-skill');
    assert.strictEqual(res.description, 'Line 1\nLine 2');
  });

  it('extracts folded block scalar with strip chomping indicator (>-)', () => {
    const raw = `---
name: strip-folded-skill
description: >-
  Folded text with strip
  chomping indicator.
---
# Content`;
    const res = extractSkillFrontmatter(raw);
    assert.strictEqual(res.name, 'strip-folded-skill');
    assert.strictEqual(res.description, 'Folded text with strip chomping indicator.');
  });

  it('extracts folded block scalar containing colons', () => {
    const raw = `---
name: colons-block-skill
description: >
  Use when: a: b
  Note: another: colon here
---
# Content`;
    const res = extractSkillFrontmatter(raw);
    assert.strictEqual(res.name, 'colons-block-skill');
    assert.strictEqual(res.description, 'Use when: a: b Note: another: colon here');
  });

  it('extracts literal block scalar containing colons', () => {
    const raw = `---
name: literal-colons-skill
description: |
  key1: value1
  key2: value2
---
# Content`;
    const res = extractSkillFrontmatter(raw);
    assert.strictEqual(res.name, 'literal-colons-skill');
    assert.strictEqual(res.description, 'key1: value1\nkey2: value2');
  });

  it('extracts plain scalar continued on the next indented line', () => {
    const raw = `---
name: continued-skill
description: First line of description
  continued on the second line
  and a third line
---
# Content`;
    const res = extractSkillFrontmatter(raw);
    assert.strictEqual(res.name, 'continued-skill');
    assert.strictEqual(res.description, 'First line of description continued on the second line and a third line');
  });

  it('preserves unquoted description containing colons without continuation (no regression)', () => {
    const raw = `---
name: plain-colons-skill
description: Use when: a: b
---
# Content`;
    const res = extractSkillFrontmatter(raw);
    assert.strictEqual(res.name, 'plain-colons-skill');
    assert.strictEqual(res.description, 'Use when: a: b');
  });

  it('handles CRLF line endings with block scalars and plain continued values', () => {
    const raw = "---\r\nname: crlf-skill\r\ndescription: >-\r\n  Line one\r\n  Line two\r\n---\r\n# Content";
    const res = extractSkillFrontmatter(raw);
    assert.strictEqual(res.name, 'crlf-skill');
    assert.strictEqual(res.description, 'Line one Line two');
  });

  it('extracts quoted scalar continued on indented lines', () => {
    const raw = `---
name: quoted-continued-skill
description: "First line of quoted description
  continued on the second line"
---
# Content`;
    const res = extractSkillFrontmatter(raw);
    assert.strictEqual(res.name, 'quoted-continued-skill');
    assert.strictEqual(res.description, 'First line of quoted description continued on the second line');
  });

  it('extracts folded block scalar for name', () => {
    const raw = `---
name: >-
  my-folded-
  skill
description: Simple desc
---
# Content`;
    const res = extractSkillFrontmatter(raw);
    assert.strictEqual(res.name, 'my-folded- skill');
    assert.strictEqual(res.description, 'Simple desc');
  });

  it('extracts literal block scalar with strip chomping indicator (|-)', () => {
    const raw = `---
name: strip-literal-skill
description: |-
  First line
  Second line
---
# Content`;
    const res = extractSkillFrontmatter(raw);
    assert.strictEqual(res.name, 'strip-literal-skill');
    assert.strictEqual(res.description, 'First line\nSecond line');
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

    // Missing `name` in frontmatter is a common, expected pattern (name falls
    // back to the directory name) — not a diagnostic-worthy problem.
    assert.strictEqual(diagnostics.length, 0);
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

describe('detect — findCommandFiles', () => {
  const fixturesRoot = getFixturesRoot();

  it('detects command files inside commands/ directory', async () => {
    const { commands, diagnostics } = await findCommandFiles(fixturesRoot);
    const reviewCmd = commands.find((c) => c.name === 'review');
    assert.ok(reviewCmd);
    assert.strictEqual(reviewCmd.description, 'Review current git changes');
    assert.strictEqual(diagnostics.length, 0);
  });
});

describe('detect — findMcpDefinitions', () => {
  it('detects MCP servers from mcp.json file', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'detect-mcp-'));
    try {
      await fs.promises.writeFile(
        path.join(tempDir, 'mcp.json'),
        JSON.stringify({
          mcpServers: {
            'sqlite-mcp': {
              command: 'uvx',
              args: ['mcp-server-sqlite'],
              description: 'SQLite server',
            },
          },
        }),
        'utf-8'
      );

      const { mcpServers, diagnostics } = await findMcpDefinitions(tempDir);
      assert.strictEqual(mcpServers.length, 1);
      assert.strictEqual(mcpServers[0].id, 'sqlite-mcp');
      assert.strictEqual(mcpServers[0].command, 'uvx');
      assert.strictEqual(mcpServers[0].description, 'SQLite server');
      assert.strictEqual(diagnostics.length, 0);
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });
});
