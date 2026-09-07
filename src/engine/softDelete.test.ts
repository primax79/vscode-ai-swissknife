import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { softDeletePath } from './softDelete';

describe('softDeletePath', () => {
  let testTempDir: string;
  let testHomeDir: string;
  let testProjectDir: string;

  beforeEach(async () => {
    testTempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'soft-delete-test-'));
    testHomeDir = path.join(testTempDir, 'home');
    testProjectDir = path.join(testTempDir, 'project');
    await fs.promises.mkdir(testHomeDir, { recursive: true });
    await fs.promises.mkdir(testProjectDir, { recursive: true });
  });

  afterEach(async () => {
    if (testTempDir) {
      await fs.promises.rm(testTempDir, { recursive: true, force: true });
    }
  });

  it('moves a single file to _deleted inside the correct .ai-swissknife root (project scope)', async () => {
    const filePath = path.join(testProjectDir, 'test-agent.md');
    await fs.promises.writeFile(filePath, 'agent content', 'utf-8');

    const resultPath = await softDeletePath(filePath, 'agent', 'test-agent', 'project', testProjectDir, testHomeDir);

    // Original file should be gone
    assert.strictEqual(fs.existsSync(filePath), false);

    // It should have moved to .vscode/ai-swissknife/_deleted/agent/test-agent-<timestamp>/
    assert.ok(resultPath.includes('.vscode/ai-swissknife/_deleted/agent/test-agent-'));
    assert.strictEqual(fs.existsSync(resultPath), true);
    
    // As it was a file, the moved item itself is now a file (or technically rename moves the file directly, so the target name is the file)
    const content = await fs.promises.readFile(resultPath, 'utf-8');
    assert.strictEqual(content, 'agent content');
  });

  it('moves a directory to _deleted inside the correct .ai-swissknife root (global scope)', async () => {
    const dirPath = path.join(testHomeDir, 'test-skill');
    await fs.promises.mkdir(dirPath, { recursive: true });
    await fs.promises.writeFile(path.join(dirPath, 'SKILL.md'), 'skill content', 'utf-8');
    await fs.promises.writeFile(path.join(dirPath, 'helper.js'), 'console.log();', 'utf-8');

    const resultPath = await softDeletePath(dirPath, 'skill', 'test-skill', 'global', testProjectDir, testHomeDir);

    // Original directory should be gone
    assert.strictEqual(fs.existsSync(dirPath), false);

    // It should have moved to .ai-swissknife/_deleted/skill/test-skill-<timestamp>/
    assert.ok(resultPath.includes('.ai-swissknife/_deleted/skill/test-skill-'));
    assert.strictEqual(fs.existsSync(resultPath), true);
    
    // As it was a directory, the moved item is a directory
    const stat = await fs.promises.stat(resultPath);
    assert.ok(stat.isDirectory());

    // Check contents
    const skillContent = await fs.promises.readFile(path.join(resultPath, 'SKILL.md'), 'utf-8');
    assert.strictEqual(skillContent, 'skill content');

    const helperContent = await fs.promises.readFile(path.join(resultPath, 'helper.js'), 'utf-8');
    assert.strictEqual(helperContent, 'console.log();');
  });
});
