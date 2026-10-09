import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  softDeletePath,
  copyToTrash,
  listTrash,
  restoreFromTrash,
  deleteFromTrash,
  emptyTrash,
  formatRelativeTime,
} from './softDelete';

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

  it('delete then list shows the entry with its sidecar origin', async () => {
    const filePath = path.join(testProjectDir, 'test-agent.md');
    await fs.promises.writeFile(filePath, 'agent content', 'utf-8');

    await softDeletePath(
      filePath,
      'agent',
      'my-agent',
      'project',
      testProjectDir,
      testHomeDir,
      { assistant: 'claude-code' }
    );

    const entries = await listTrash('project', testProjectDir, testHomeDir);
    assert.strictEqual(entries.length, 1);
    const entry = entries[0];
    assert.strictEqual(entry.name, 'my-agent');
    assert.strictEqual(entry.kind, 'agent');
    assert.strictEqual(entry.originalPath, filePath);
    assert.strictEqual(entry.assistant, 'claude-code');
    assert.strictEqual(entry.scope, 'project');
    assert.ok(entry.deletedAt);

    // Verify sidecar file on disk
    const sidecarPath = path.join(entry.trashPath, '.origin.json');
    assert.strictEqual(fs.existsSync(sidecarPath), true);
    const sidecar = JSON.parse(await fs.promises.readFile(sidecarPath, 'utf-8'));
    assert.strictEqual(sidecar.originalPath, filePath);
    assert.strictEqual(sidecar.assistant, 'claude-code');
    assert.strictEqual(sidecar.scope, 'project');
    assert.strictEqual(sidecar.kind, 'agent');
    assert.strictEqual(sidecar.name, 'my-agent');
  });

  it('restore puts files back byte-identical', async () => {
    const skillDir = path.join(testHomeDir, 'byte-skill');
    await fs.promises.mkdir(skillDir, { recursive: true });
    const skillContent = '# Unique Skill\nExact byte content';
    const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xfe, 0xff]);
    await fs.promises.writeFile(path.join(skillDir, 'SKILL.md'), skillContent, 'utf-8');
    await fs.promises.writeFile(path.join(skillDir, 'binary.bin'), binaryData);

    await softDeletePath(
      skillDir,
      'skill',
      'byte-skill',
      'global',
      testProjectDir,
      testHomeDir,
      { assistant: 'kilo-code' }
    );

    assert.strictEqual(fs.existsSync(skillDir), false);

    const entries = await listTrash('global', undefined, testHomeDir);
    assert.strictEqual(entries.length, 1);
    const entry = entries[0];

    const res = await restoreFromTrash(entry, skillDir);
    assert.strictEqual(res.status, 'restored');
    if (res.status === 'restored') {
      assert.strictEqual(res.restoredPath, skillDir);
    }

    assert.strictEqual(fs.existsSync(skillDir), true);
    const restoredSkill = await fs.promises.readFile(path.join(skillDir, 'SKILL.md'), 'utf-8');
    assert.strictEqual(restoredSkill, skillContent);
    const restoredBinary = await fs.promises.readFile(path.join(skillDir, 'binary.bin'));
    assert.deepStrictEqual(restoredBinary, binaryData);

    // .origin.json must not be present in the restored directory
    assert.strictEqual(fs.existsSync(path.join(skillDir, '.origin.json')), false);
    // Trash path must be gone
    assert.strictEqual(fs.existsSync(entry.trashPath), false);
  });

  it('conflict returned when the original exists', async () => {
    const filePath = path.join(testProjectDir, 'existing-file.md');
    await fs.promises.writeFile(filePath, 'original content', 'utf-8');

    await softDeletePath(
      filePath,
      'command',
      'existing-cmd',
      'project',
      testProjectDir,
      testHomeDir
    );

    const entries = await listTrash('project', testProjectDir, testHomeDir);
    assert.strictEqual(entries.length, 1);
    const entry = entries[0];

    // Recreate the file at the original path
    await fs.promises.writeFile(filePath, 'new conflicting content', 'utf-8');

    // Attempting restore without overwrite must return a typed conflict
    const res = await restoreFromTrash(entry, filePath);
    assert.strictEqual(res.status, 'conflict');
    if (res.status === 'conflict') {
      assert.strictEqual(res.targetPath, filePath);
    }

    // Conflicting content must be untouched
    const currentContent = await fs.promises.readFile(filePath, 'utf-8');
    assert.strictEqual(currentContent, 'new conflicting content');

    // Trash entry must still exist
    assert.strictEqual(fs.existsSync(entry.trashPath), true);
  });

  it('entry without sidecar listed as origin unknown and restorable to a chosen path', async () => {
    // Simulate an entry deleted before this change (legacy entry without .origin.json)
    const legacyTrashDir = path.join(
      testProjectDir,
      '.vscode',
      'ai-swissknife',
      '_deleted',
      'skill',
      'legacy-skill-2026-10-09T01-00-00-000Z'
    );
    await fs.promises.mkdir(legacyTrashDir, { recursive: true });
    await fs.promises.writeFile(path.join(legacyTrashDir, 'SKILL.md'), '# Legacy Skill', 'utf-8');

    const entries = await listTrash('project', testProjectDir, testHomeDir);
    assert.strictEqual(entries.length, 1);
    const entry = entries[0];
    assert.strictEqual(entry.name, 'legacy-skill');
    assert.strictEqual(entry.kind, 'skill');
    assert.strictEqual(entry.originalPath, undefined, 'Origin must be unknown');

    // Restore to a chosen path
    const chosenPath = path.join(testProjectDir, 'restored-legacy-skill');
    const res = await restoreFromTrash(entry, chosenPath);
    assert.strictEqual(res.status, 'restored');
    assert.strictEqual(fs.existsSync(path.join(chosenPath, 'SKILL.md')), true);
    const content = await fs.promises.readFile(path.join(chosenPath, 'SKILL.md'), 'utf-8');
    assert.strictEqual(content, '# Legacy Skill');
  });

  it('EXDEV fallback path covered for softDeletePath and restoreFromTrash', async () => {
    const filePath = path.join(testProjectDir, 'exdev-agent.md');
    await fs.promises.writeFile(filePath, 'exdev agent content', 'utf-8');

    const originalRename = fs.promises.rename;
    let renameAttempts = 0;

    // Simulate EXDEV error
    fs.promises.rename = async (src, dest) => {
      renameAttempts++;
      const err = new Error('EXDEV: cross-device link not permitted') as NodeJS.ErrnoException;
      err.code = 'EXDEV';
      throw err;
    };

    try {
      const moved = await softDeletePath(
        filePath,
        'agent',
        'exdev-agent',
        'project',
        testProjectDir,
        testHomeDir
      );
      assert.ok(renameAttempts > 0);
      assert.strictEqual(fs.existsSync(filePath), false);
      assert.strictEqual(fs.existsSync(moved), true);

      const entries = await listTrash('project', testProjectDir, testHomeDir);
      assert.strictEqual(entries.length, 1);

      // Restore with EXDEV still simulated
      const res = await restoreFromTrash(entries[0], filePath);
      assert.strictEqual(res.status, 'restored');
      assert.strictEqual(fs.existsSync(filePath), true);
      const content = await fs.promises.readFile(filePath, 'utf-8');
      assert.strictEqual(content, 'exdev agent content');
    } finally {
      fs.promises.rename = originalRename;
    }
  });

  it('emptyTrash removes only the requested scope, returns the right count and reports a failing entry without stopping the others', async () => {
    // 1. Create one global trash entry and two project trash entries
    const globalFile = path.join(testHomeDir, 'global-item.md');
    await fs.promises.writeFile(globalFile, 'global content', 'utf-8');
    await softDeletePath(globalFile, 'rule', 'global-rule', 'global', testProjectDir, testHomeDir);

    const projectFile1 = path.join(testProjectDir, 'proj-1.md');
    const projectFile2 = path.join(testProjectDir, 'proj-2.md');
    await fs.promises.writeFile(projectFile1, 'p1', 'utf-8');
    await fs.promises.writeFile(projectFile2, 'p2', 'utf-8');
    await softDeletePath(projectFile1, 'agent', 'proj-agent-1', 'project', testProjectDir, testHomeDir);
    await softDeletePath(projectFile2, 'agent', 'proj-agent-2', 'project', testProjectDir, testHomeDir);

    assert.strictEqual((await listTrash('global', undefined, testHomeDir)).length, 1);
    assert.strictEqual((await listTrash('project', testProjectDir, testHomeDir)).length, 2);

    // 2. Empty only project scope
    const projectRes = await emptyTrash('project', testProjectDir, testHomeDir);
    assert.strictEqual(projectRes.count, 2);
    assert.strictEqual(projectRes.failed.length, 0);

    // Project trash must be empty, global trash must be untouched
    assert.strictEqual((await listTrash('project', testProjectDir, testHomeDir)).length, 0);
    assert.strictEqual((await listTrash('global', undefined, testHomeDir)).length, 1);

    // 3. Test failure reporting: create two new project entries and make one fail to remove
    await fs.promises.writeFile(projectFile1, 'p1 again', 'utf-8');
    await fs.promises.writeFile(projectFile2, 'p2 again', 'utf-8');
    await softDeletePath(projectFile1, 'agent', 'proj-agent-3', 'project', testProjectDir, testHomeDir);
    await softDeletePath(projectFile2, 'agent', 'proj-agent-4', 'project', testProjectDir, testHomeDir);

    const projectEntries = await listTrash('project', testProjectDir, testHomeDir);
    assert.strictEqual(projectEntries.length, 2);
    const failingEntry = projectEntries[0];
    const succeedingEntry = projectEntries[1];

    const originalRm = fs.promises.rm;
    fs.promises.rm = async (targetPath, options) => {
      if (String(targetPath) === failingEntry.trashPath) {
        throw new Error('Simulated permission denied on delete');
      }
      return await originalRm(targetPath, options);
    };

    try {
      const result = await emptyTrash('project', testProjectDir, testHomeDir);
      assert.strictEqual(result.count, 1, 'One entry should have succeeded');
      assert.strictEqual(result.failed.length, 1, 'One entry should have failed');
      assert.strictEqual(result.failed[0].entry.name, failingEntry.name);
      assert.ok(result.failed[0].error.includes('Simulated permission denied'));

      // The succeeding entry must have been removed despite the failure of the first entry
      assert.strictEqual(fs.existsSync(succeedingEntry.trashPath), false);
      assert.strictEqual(fs.existsSync(failingEntry.trashPath), true);
    } finally {
      fs.promises.rm = originalRm;
    }
  });

  it('update.ts backup carries the sidecar', async () => {
    const filePath = path.join(testProjectDir, 'backup-agent.md');
    await fs.promises.writeFile(filePath, 'backup content', 'utf-8');

    const backupDir = await copyToTrash(
      filePath,
      'agent',
      'backup-agent',
      'project',
      testProjectDir,
      testHomeDir,
      { assistant: 'claude-code' }
    );

    // Original file must still exist (copyToTrash does not delete)
    assert.strictEqual(fs.existsSync(filePath), true);

    // Backup directory must exist and contain .origin.json
    const sidecarPath = path.join(backupDir, '.origin.json');
    assert.strictEqual(fs.existsSync(sidecarPath), true);
    const sidecar = JSON.parse(await fs.promises.readFile(sidecarPath, 'utf-8'));
    assert.strictEqual(sidecar.originalPath, filePath);
    assert.strictEqual(sidecar.assistant, 'claude-code');
    assert.strictEqual(sidecar.name, 'backup-agent');
    assert.strictEqual(sidecar.kind, 'agent');
    assert.strictEqual(sidecar.scope, 'project');

    // listTrash must find the backup entry with its origin
    const entries = await listTrash('project', testProjectDir, testHomeDir);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].name, 'backup-agent');
    assert.strictEqual(entries[0].originalPath, filePath);
  });
});
