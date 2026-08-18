import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ClaudeAdapter, claudeAdapter } from './claude';
import type { CanonicalRule, CanonicalSkill } from './types';

describe('ClaudeAdapter', () => {
  let testTempDir: string;
  let testHomeDir: string;
  let testProjectDir: string;
  let adapter: ClaudeAdapter;

  beforeEach(async () => {
    testTempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'claude-adapter-test-'));
    testHomeDir = path.join(testTempDir, 'home');
    testProjectDir = path.join(testTempDir, 'project');
    await fs.promises.mkdir(testHomeDir, { recursive: true });
    await fs.promises.mkdir(testProjectDir, { recursive: true });
    adapter = new ClaudeAdapter(() => testHomeDir);
  });

  afterEach(async () => {
    if (testTempDir) {
      await fs.promises.rm(testTempDir, { recursive: true, force: true });
    }
  });

  describe('assistant identity', () => {
    it('has assistant = claude-code', () => {
      assert.strictEqual(adapter.assistant, 'claude-code');
      assert.strictEqual(claudeAdapter.assistant, 'claude-code');
    });
  });

  describe('path resolution', () => {
    it('skillPath returns correct global path and throws when projectRoot is missing for project scope', () => {
      const defaultGlobalPath = claudeAdapter.skillPath('my-skill', { scope: 'global' });
      assert.strictEqual(
        defaultGlobalPath,
        path.join(os.homedir(), '.claude', 'skills', 'my-skill', 'SKILL.md')
      );

      const customGlobalPath = adapter.skillPath('my-skill', { scope: 'global' });
      assert.strictEqual(
        customGlobalPath,
        path.join(testHomeDir, '.claude', 'skills', 'my-skill', 'SKILL.md')
      );

      const projectPath = adapter.skillPath('my-skill', {
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.strictEqual(
        projectPath,
        path.join(testProjectDir, '.claude', 'skills', 'my-skill', 'SKILL.md')
      );

      assert.throws(
        () => {
          adapter.skillPath('my-skill', { scope: 'project' });
        },
        {
          message: /projectRoot is required when scope is "project"/,
        }
      );
    });

    it('rulePath returns correct global (~/.claude/CLAUDE.md) and project (<root>/CLAUDE.md) paths', () => {
      const defaultGlobalRule = claudeAdapter.rulePath({ scope: 'global' });
      assert.strictEqual(defaultGlobalRule, path.join(os.homedir(), '.claude', 'CLAUDE.md'));

      const customGlobalRule = adapter.rulePath({ scope: 'global' });
      assert.strictEqual(customGlobalRule, path.join(testHomeDir, '.claude', 'CLAUDE.md'));

      const projectRule = adapter.rulePath({
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.strictEqual(projectRule, path.join(testProjectDir, 'CLAUDE.md'));

      assert.throws(
        () => {
          adapter.rulePath({ scope: 'project' });
        },
        {
          message: /projectRoot is required when scope is "project"/,
        }
      );
    });
  });

  describe('skills', () => {
    it('Round-trip: writeSkill then readSkill returns the same name/description/body and extraFields', async () => {
      const skill: CanonicalSkill = {
        name: 'conflict-resolver',
        description: 'Resolve merge conflicts in files produced by parallel Executor tasks',
        body: '# conflict-resolver\n\nUse this skill to resolve merge conflicts.',
        extraFields: {
          license: 'MIT',
          version: '1.2.0',
          enabled: true,
          priority: 10,
          metadata: { category: 'development', author: 'test' },
          tags: ['git', 'merge'],
        },
      };

      // Test in project scope
      await adapter.writeSkill(skill, { scope: 'project', projectRoot: testProjectDir });
      const loadedProjectSkill = await adapter.readSkill('conflict-resolver', {
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.deepStrictEqual(loadedProjectSkill, skill);

      // Test in global scope
      await adapter.writeSkill(skill, { scope: 'global' });
      const loadedGlobalSkill = await adapter.readSkill('conflict-resolver', { scope: 'global' });
      assert.deepStrictEqual(loadedGlobalSkill, skill);
    });

    it('readSkill on a nonexistent skill returns null, not a throw', async () => {
      const resultProject = await adapter.readSkill('nonexistent-skill', {
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.strictEqual(resultProject, null);

      const resultGlobal = await adapter.readSkill('nonexistent-skill', { scope: 'global' });
      assert.strictEqual(resultGlobal, null);
    });

    it('listSkills returns only directories containing SKILL.md, given a fixture directory with one valid skill dir and one dir without SKILL.md', async () => {
      // Create .claude/skills in testProjectDir
      const skillsDir = path.join(testProjectDir, '.claude', 'skills');
      const validSkillDir = path.join(skillsDir, 'valid-skill');
      const invalidDir = path.join(skillsDir, 'not-a-skill');
      const strayFile = path.join(skillsDir, 'stray.txt');

      await fs.promises.mkdir(validSkillDir, { recursive: true });
      await fs.promises.mkdir(invalidDir, { recursive: true });

      // Add SKILL.md to valid-skill
      await fs.promises.writeFile(
        path.join(validSkillDir, 'SKILL.md'),
        '---\nname: valid-skill\ndescription: A valid skill\n---\n# Body\n',
        'utf-8'
      );

      // Add another file (not SKILL.md) to not-a-skill
      await fs.promises.writeFile(
        path.join(invalidDir, 'OTHER.md'),
        '# Not a skill',
        'utf-8'
      );

      // Add a stray regular file in skillsDir
      await fs.promises.writeFile(strayFile, 'some text', 'utf-8');

      const listed = await adapter.listSkills({
        scope: 'project',
        projectRoot: testProjectDir,
      });

      assert.deepStrictEqual(listed, ['valid-skill']);
    });

    it('listSkills returns empty array when .claude/skills does not exist', async () => {
      const listed = await adapter.listSkills({
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.deepStrictEqual(listed, []);
    });
  });

  describe('rules', () => {
    it('rulePath/readRule/writeRule round-trip for both scopes', async () => {
      const projectRule: CanonicalRule = {
        content: '# Project Rules\n\n- Follow TypeScript strict guidelines\n- Run tests before commit\n',
      };

      const globalRule: CanonicalRule = {
        content: '# Global Rules\n\n- Global user preferences\n',
      };

      // Project scope
      const projectRuleLocation = { scope: 'project' as const, projectRoot: testProjectDir };
      assert.strictEqual(adapter.rulePath(projectRuleLocation), path.join(testProjectDir, 'CLAUDE.md'));
      const initialProjectRule = await adapter.readRule(projectRuleLocation);
      assert.strictEqual(initialProjectRule, null);

      await adapter.writeRule(projectRule, projectRuleLocation);
      const readProjectRule = await adapter.readRule(projectRuleLocation);
      assert.deepStrictEqual(readProjectRule, projectRule);

      // Global scope
      const globalRuleLocation = { scope: 'global' as const };
      assert.strictEqual(adapter.rulePath(globalRuleLocation), path.join(testHomeDir, '.claude', 'CLAUDE.md'));
      const initialGlobalRule = await adapter.readRule(globalRuleLocation);
      assert.strictEqual(initialGlobalRule, null);

      await adapter.writeRule(globalRule, globalRuleLocation);
      const readGlobalRule = await adapter.readRule(globalRuleLocation);
      assert.deepStrictEqual(readGlobalRule, globalRule);
    });
  });
});
