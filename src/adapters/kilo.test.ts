import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { KiloAdapter, kiloAdapter } from './kilo';
import { ClaudeAdapter, claudeAdapter } from './claude';
import type { CanonicalRule, CanonicalSkill } from './types';

describe('KiloAdapter', () => {
  let testTempDir: string;
  let testHomeDir: string;
  let testProjectDir: string;
  let adapter: KiloAdapter;

  beforeEach(async () => {
    testTempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kilo-adapter-test-'));
    testHomeDir = path.join(testTempDir, 'home');
    testProjectDir = path.join(testTempDir, 'project');
    await fs.promises.mkdir(testHomeDir, { recursive: true });
    await fs.promises.mkdir(testProjectDir, { recursive: true });
    adapter = new KiloAdapter(() => testHomeDir);
  });

  afterEach(async () => {
    if (testTempDir) {
      await fs.promises.rm(testTempDir, { recursive: true, force: true });
    }
  });

  describe('assistant identity', () => {
    it('has assistant = kilo-code', () => {
      assert.strictEqual(adapter.assistant, 'kilo-code');
      assert.strictEqual(kiloAdapter.assistant, 'kilo-code');
    });
  });

  describe('path resolution', () => {
    it('skillPath returns correct global path and throws when projectRoot is missing for project scope', () => {
      const defaultGlobalPath = kiloAdapter.skillPath('my-skill', { scope: 'global' });
      assert.strictEqual(
        defaultGlobalPath,
        path.join(os.homedir(), '.kilo', 'skills', 'my-skill', 'SKILL.md')
      );

      const customGlobalPath = adapter.skillPath('my-skill', { scope: 'global' });
      assert.strictEqual(
        customGlobalPath,
        path.join(testHomeDir, '.kilo', 'skills', 'my-skill', 'SKILL.md')
      );

      const projectPath = adapter.skillPath('my-skill', {
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.strictEqual(
        projectPath,
        path.join(testProjectDir, '.kilo', 'skills', 'my-skill', 'SKILL.md')
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

    it('skillDir equals path.dirname(skillPath) for both global and project scope', () => {
      const globalLoc = { scope: 'global' as const };
      assert.strictEqual(
        adapter.skillDir('my-skill', globalLoc),
        path.dirname(adapter.skillPath('my-skill', globalLoc))
      );
      assert.strictEqual(
        kiloAdapter.skillDir('my-skill', globalLoc),
        path.dirname(kiloAdapter.skillPath('my-skill', globalLoc))
      );

      const projectLoc = {
        scope: 'project' as const,
        projectRoot: testProjectDir,
      };
      assert.strictEqual(
        adapter.skillDir('my-skill', projectLoc),
        path.dirname(adapter.skillPath('my-skill', projectLoc))
      );
      assert.strictEqual(
        kiloAdapter.skillDir('my-skill', projectLoc),
        path.dirname(kiloAdapter.skillPath('my-skill', projectLoc))
      );
    });

    it('rulePath returns correct global (~/.config/kilo/AGENTS.md) and project (<root>/CLAUDE.md) paths', () => {
      const defaultGlobalRule = kiloAdapter.rulePath({ scope: 'global' });
      assert.strictEqual(
        defaultGlobalRule,
        path.join(os.homedir(), '.config', 'kilo', 'AGENTS.md')
      );

      const customGlobalRule = adapter.rulePath({ scope: 'global' });
      assert.strictEqual(
        customGlobalRule,
        path.join(testHomeDir, '.config', 'kilo', 'AGENTS.md')
      );

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

    it('project-scope rulePath returns identical string to ClaudeAdapter project-scope rulePath for the same projectRoot', () => {
      const location = { scope: 'project' as const, projectRoot: testProjectDir };
      assert.strictEqual(
        kiloAdapter.rulePath(location),
        claudeAdapter.rulePath(location)
      );

      const customClaudeAdapter = new ClaudeAdapter(() => testHomeDir);
      assert.strictEqual(
        adapter.rulePath(location),
        customClaudeAdapter.rulePath(location)
      );
    });
  });

  describe('skills', () => {
    it('Round-trip: writeSkill then readSkill returns the same name/description/body and extraFields', async () => {
      const skill: CanonicalSkill = {
        name: 'full-feature-skill',
        description: 'A skill with many fields',
        body: 'This is the skill body.\nIt spans multiple lines.\n',
        extraFields: {
          license: 'MIT',
          version: '1.0.0',
          enabled: true,
          priority: 10,
          metadata: {
            category: 'test',
            author: 'Alfredo',
          },
          tags: ['typescript', 'node'],
        },
        files: [],
      };

      // Test in project scope
      await adapter.writeSkill(skill, { scope: 'project', projectRoot: testProjectDir });
      const loadedProjectSkill = await adapter.readSkill(skill.name, {
        scope: 'project',
        projectRoot: testProjectDir,
      });
      assert.deepStrictEqual(loadedProjectSkill, skill);

      // Test in global scope
      await adapter.writeSkill(skill, { scope: 'global' });
      const loadedGlobalSkill = await adapter.readSkill(skill.name, { scope: 'global' });
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
      // Create .kilo/skills in testProjectDir
      const skillsDir = path.join(testProjectDir, '.kilo', 'skills');
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

    it('listSkills returns empty array when .kilo/skills does not exist', async () => {
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
      assert.strictEqual(
        adapter.rulePath(globalRuleLocation),
        path.join(testHomeDir, '.config', 'kilo', 'AGENTS.md')
      );
      const initialGlobalRule = await adapter.readRule(globalRuleLocation);
      assert.strictEqual(initialGlobalRule, null);

      await adapter.writeRule(globalRule, globalRuleLocation);
      const readGlobalRule = await adapter.readRule(globalRuleLocation);
      assert.deepStrictEqual(readGlobalRule, globalRule);
    });
  });
});
