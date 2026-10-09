import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  writeManifest,
  writeState,
  readState,
  SCHEMA_VERSION,
} from '../domain/registry';
import { readSkill, canonicalSkillHash } from '../adapters/codec';
import { runDescribe } from './definitions';

const execFileAsync = promisify(execFile);
const cliPath = path.resolve(__dirname, '../../dist/cli.js');

function snapshotDirectory(dir: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(dir)) return map;

  function traverse(current: string) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relPath = path.relative(dir, fullPath);
      if (entry.isDirectory()) {
        traverse(fullPath);
      } else if (entry.isFile()) {
        const content = fs.readFileSync(fullPath);
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        map.set(relPath, hash);
      }
    }
  }

  traverse(dir);
  return map;
}

function assertSnapshotsEqual(
  before: Map<string, string>,
  after: Map<string, string>,
  msg = 'Directory snapshot changed unexpectedly'
) {
  assert.strictEqual(
    after.size,
    before.size,
    `${msg}: file count mismatch (before: ${before.size}, after: ${after.size})`
  );
  for (const [file, hash] of before.entries()) {
    assert.strictEqual(after.get(file), hash, `${msg}: ${file} changed or missing`);
  }
}

async function runCli(
  args: string[]
): Promise<{ stdout: string; stderr: string; code: number; json: any }> {
  try {
    const res = await execFileAsync(process.execPath, [cliPath, ...args]);
    let json: any = null;
    try {
      json = JSON.parse(res.stdout);
    } catch {
      json = null;
    }
    return { stdout: res.stdout, stderr: res.stderr, code: 0, json };
  } catch (err: any) {
    let json: any = null;
    try {
      json = JSON.parse(err.stdout);
    } catch {
      json = null;
    }
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      code: typeof err.code === 'number' ? err.code : 1,
      json,
    };
  }
}

describe('CLI redistribute command (Task 46.5)', () => {
  let tempHome: string;
  let tempWorkspace: string;
  let localSourceDir: string;

  beforeEach(async () => {
    tempHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'redist-test-home-'));
    tempWorkspace = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'redist-test-ws-'));
    localSourceDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'redist-test-src-'));

    // Create two skills in local-folder source: skill-a and skill-b
    const skillADir = path.join(localSourceDir, 'skill-a');
    await fs.promises.mkdir(skillADir, { recursive: true });
    await fs.promises.writeFile(
      path.join(skillADir, 'SKILL.md'),
      '---\nname: skill-a\ndescription: Skill A fixture\n---\n# Skill A Original\n',
      'utf-8'
    );

    const skillBDir = path.join(localSourceDir, 'skill-b');
    await fs.promises.mkdir(skillBDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(skillBDir, 'SKILL.md'),
      '---\nname: skill-b\ndescription: Skill B fixture\n---\n# Skill B Original\n',
      'utf-8'
    );

    // Register local-folder source in global and project manifests
    await writeManifest(
      'global',
      {
        schemaVersion: SCHEMA_VERSION,
        sources: [
          {
            id: 'local-src',
            type: 'local-folder',
            scope: 'global',
            localPath: localSourceDir,
          },
        ],
        desiredInstallations: [],
      },
      undefined,
      tempHome
    );

    await writeManifest(
      'project',
      {
        schemaVersion: SCHEMA_VERSION,
        sources: [
          {
            id: 'local-src-proj',
            type: 'local-folder',
            scope: 'project',
            localPath: localSourceDir,
          },
        ],
        desiredInstallations: [],
      },
      tempWorkspace,
      tempHome
    );

    // Install skill-a to claude-code (global)
    const claudeGlobalSkillA = path.join(tempHome, '.claude', 'skills', 'skill-a');
    await fs.promises.mkdir(claudeGlobalSkillA, { recursive: true });
    await fs.promises.writeFile(
      path.join(claudeGlobalSkillA, 'SKILL.md'),
      '---\nname: skill-a\ndescription: Skill A fixture\n---\n# Skill A Original\n',
      'utf-8'
    );
    const skillAObj = await readSkill(claudeGlobalSkillA);
    const hashA = canonicalSkillHash(skillAObj);

    await writeState(
      'global',
      {
        schemaVersion: SCHEMA_VERSION,
        installations: [
          {
            assistant: 'claude-code',
            scope: 'global',
            kind: 'skill',
            name: 'skill-a',
            path: claudeGlobalSkillA,
            sourceId: 'local-src',
            packageId: 'local-src:skill-a',
            artifactId: 'local-src:skill-a:skill-a',
            installedAt: new Date().toISOString(),
            contentHash: hashA,
          },
        ],
      },
      undefined,
      tempHome
    );

    // Install skill-a to kilo-code (project)
    const kiloProjSkillA = path.join(tempWorkspace, '.kilo', 'skills', 'skill-a');
    await fs.promises.mkdir(kiloProjSkillA, { recursive: true });
    await fs.promises.writeFile(
      path.join(kiloProjSkillA, 'SKILL.md'),
      '---\nname: skill-a\ndescription: Skill A fixture\n---\n# Skill A Original\n',
      'utf-8'
    );

    // Install skill-b to claude-code (project)
    const claudeProjSkillB = path.join(tempWorkspace, '.claude', 'skills', 'skill-b');
    await fs.promises.mkdir(claudeProjSkillB, { recursive: true });
    await fs.promises.writeFile(
      path.join(claudeProjSkillB, 'SKILL.md'),
      '---\nname: skill-b\ndescription: Skill B fixture\n---\n# Skill B Original\n',
      'utf-8'
    );
    const skillBObj = await readSkill(claudeProjSkillB);
    const hashB = canonicalSkillHash(skillBObj);

    await writeState(
      'project',
      {
        schemaVersion: SCHEMA_VERSION,
        installations: [
          {
            assistant: 'kilo-code',
            scope: 'project',
            kind: 'skill',
            name: 'skill-a',
            path: kiloProjSkillA,
            sourceId: 'local-src',
            packageId: 'local-src:skill-a',
            artifactId: 'local-src:skill-a:skill-a',
            installedAt: new Date().toISOString(),
            contentHash: hashA,
            projectPath: tempWorkspace,
          },
          {
            assistant: 'claude-code',
            scope: 'project',
            kind: 'skill',
            name: 'skill-b',
            path: claudeProjSkillB,
            sourceId: 'local-src',
            packageId: 'local-src:skill-b',
            artifactId: 'local-src:skill-b:skill-b',
            installedAt: new Date().toISOString(),
            contentHash: hashB,
            projectPath: tempWorkspace,
          },
        ],
      },
      tempWorkspace,
      tempHome
    );
  });

  afterEach(async () => {
    for (const p of [tempHome, tempWorkspace, localSourceDir]) {
      if (fs.existsSync(p)) {
        await fs.promises.rm(p, { recursive: true, force: true });
      }
    }
  });

  it('1. plan-only mode: editing a skill in the folder reports stale, disk is byte-identical before and after', async () => {
    // Edit skill-a in the source folder
    const skillAPath = path.join(localSourceDir, 'skill-a', 'SKILL.md');
    await fs.promises.writeFile(
      skillAPath,
      '---\nname: skill-a\ndescription: Skill A fixture edited\n---\n# Skill A Edited\n',
      'utf-8'
    );

    const beforeHome = snapshotDirectory(tempHome);
    const beforeWs = snapshotDirectory(tempWorkspace);

    // Run redistribute in plan mode
    const res = await runCli([
      '--home',
      tempHome,
      '--workspace',
      tempWorkspace,
      'redistribute',
      path.join(localSourceDir, 'skill-a'),
    ]);

    assert.strictEqual(res.code, 0, `CLI failed: ${res.stderr}`);
    assert.strictEqual(res.json.mode, 'plan');
    assert.ok(Array.isArray(res.json.targets));
    assert.strictEqual(res.json.targets.length, 2);

    for (const t of res.json.targets) {
      assert.strictEqual(t.item, 'skill-a');
      assert.strictEqual(t.classification, 'stale');
      assert.strictEqual(t.action, 'update');
      assert.ok(t.oldHash, 'oldHash must be present');
      assert.ok(t.newHash, 'newHash must be present');
      assert.notStrictEqual(t.oldHash, t.newHash);
    }

    // Verify temp tree is byte-identical (nothing modified on disk in plan mode)
    assertSnapshotsEqual(beforeHome, snapshotDirectory(tempHome), 'tempHome changed in plan mode');
    assertSnapshotsEqual(beforeWs, snapshotDirectory(tempWorkspace), 'tempWorkspace changed in plan mode');
  });

  it('2. --write updates stale copies, outputs old/new hashes and correct changedFiles', async () => {
    // Edit skill-a in local source folder, adding a new file and modifying SKILL.md
    const skillADir = path.join(localSourceDir, 'skill-a');
    await fs.promises.writeFile(
      path.join(skillADir, 'SKILL.md'),
      '---\nname: skill-a\ndescription: Skill A fixture edited\n---\n# Skill A Edited Content\n',
      'utf-8'
    );
    await fs.promises.writeFile(
      path.join(skillADir, 'helper.txt'),
      'Helper tool notes\n',
      'utf-8'
    );

    const res = await runCli([
      '--home',
      tempHome,
      '--workspace',
      tempWorkspace,
      'redistribute',
      path.join(localSourceDir, 'skill-a'),
      '--write',
    ]);

    assert.strictEqual(res.code, 0, `CLI failed: ${res.stderr}`);
    assert.strictEqual(res.json.mode, 'applied');
    assert.ok(Array.isArray(res.json.targets));
    assert.strictEqual(res.json.targets.length, 2);

    for (const t of res.json.targets) {
      assert.strictEqual(t.item, 'skill-a');
      assert.strictEqual(t.classification, 'stale');
      assert.strictEqual(t.action, 'updated');
      assert.ok(t.oldHash, 'oldHash present');
      assert.ok(t.newHash, 'newHash present');
      assert.notStrictEqual(t.oldHash, t.newHash);

      // Verify changedFiles contains modified SKILL.md and added helper.txt
      assert.ok(t.changedFiles, 'changedFiles present');
      assert.ok(
        t.changedFiles.changed.includes('SKILL.md'),
        `SKILL.md should be in changedFiles.changed: ${JSON.stringify(t.changedFiles)}`
      );
      assert.ok(
        t.changedFiles.added.includes('helper.txt'),
        `helper.txt should be in changedFiles.added: ${JSON.stringify(t.changedFiles)}`
      );

      // Verify files actually exist on disk
      const diskSkillMd = fs.readFileSync(path.join(t.path, 'SKILL.md'), 'utf-8');
      assert.ok(diskSkillMd.includes('Skill A Edited Content'));
      const diskHelper = fs.readFileSync(path.join(t.path, 'helper.txt'), 'utf-8');
      assert.ok(diskHelper.includes('Helper tool notes'));
    }
  });

  it('3. modified-locally copy is skipped, with --force is overwritten and saved to _deleted/', async () => {
    // Modify skill-a source folder
    const skillADir = path.join(localSourceDir, 'skill-a');
    await fs.promises.writeFile(
      path.join(skillADir, 'SKILL.md'),
      '---\nname: skill-a\ndescription: Source changed\n---\n# Source Changed\n',
      'utf-8'
    );

    // Hand-edit the installed copy in claude global
    const claudeGlobalSkillA = path.join(tempHome, '.claude', 'skills', 'skill-a');
    const handEditedContent = '---\nname: skill-a\ndescription: Hand edited\n---\n# Hand Edited Locally\n';
    await fs.promises.writeFile(
      path.join(claudeGlobalSkillA, 'SKILL.md'),
      handEditedContent,
      'utf-8'
    );

    // Run redistribute with --write but WITHOUT --force
    const resNoForce = await runCli([
      '--home',
      tempHome,
      '--workspace',
      tempWorkspace,
      'redistribute',
      'skill-a',
      '--scope',
      'global',
      '--write',
    ]);

    assert.strictEqual(resNoForce.code, 0);
    assert.strictEqual(resNoForce.json.mode, 'applied');
    const targetNoForce = resNoForce.json.targets.find(
      (t: any) => t.scope === 'global' && t.assistant === 'claude-code'
    );
    assert.ok(targetNoForce);
    assert.strictEqual(targetNoForce.classification, 'modified-locally');
    assert.strictEqual(targetNoForce.action, 'skipped');

    // Confirm file was not overwritten
    const contentStillHandEdited = fs.readFileSync(
      path.join(claudeGlobalSkillA, 'SKILL.md'),
      'utf-8'
    );
    assert.strictEqual(contentStillHandEdited, handEditedContent);

    // Now run with --force --write
    const resForce = await runCli([
      '--home',
      tempHome,
      '--workspace',
      tempWorkspace,
      'redistribute',
      'skill-a',
      '--scope',
      'global',
      '--force',
      '--write',
    ]);

    assert.strictEqual(resForce.code, 0);
    assert.strictEqual(resForce.json.mode, 'applied');
    const targetForce = resForce.json.targets.find(
      (t: any) => t.scope === 'global' && t.assistant === 'claude-code'
    );
    assert.ok(targetForce);
    assert.strictEqual(targetForce.classification, 'modified-locally');
    assert.strictEqual(targetForce.action, 'updated');
    assert.ok(targetForce.backupPath, 'backupPath must be returned');

    // Verify backup file exists under _deleted/ and equals the hand-edited content
    assert.ok(
      targetForce.backupPath.includes('_deleted'),
      `backupPath must be under _deleted/: ${targetForce.backupPath}`
    );
    assert.ok(fs.existsSync(targetForce.backupPath));
    const backedUpSkillMd = fs.readFileSync(
      path.join(targetForce.backupPath, 'SKILL.md'),
      'utf-8'
    );
    assert.strictEqual(backedUpSkillMd, handEditedContent);

    // Verify installed copy has the new source content
    const updatedInstalled = fs.readFileSync(
      path.join(claudeGlobalSkillA, 'SKILL.md'),
      'utf-8'
    );
    assert.ok(updatedInstalled.includes('Source Changed'));
  });

  it('4. removed skill is reported orphan and installed copy is not deleted', async () => {
    // Delete skill-b from local source directory
    const skillBDir = path.join(localSourceDir, 'skill-b');
    await fs.promises.rm(skillBDir, { recursive: true, force: true });

    const installedBPath = path.join(tempWorkspace, '.claude', 'skills', 'skill-b');
    assert.ok(fs.existsSync(installedBPath), 'Installed skill-b exists before run');

    // Run redistribute with --write
    const res = await runCli([
      '--home',
      tempHome,
      '--workspace',
      tempWorkspace,
      'redistribute',
      localSourceDir,
      '--item',
      'skill-b',
      '--write',
    ]);

    assert.strictEqual(res.code, 0);
    assert.strictEqual(res.json.mode, 'applied');
    const targetB = res.json.targets.find((t: any) => t.item === 'skill-b');
    assert.ok(targetB);
    assert.strictEqual(targetB.classification, 'orphan');
    assert.strictEqual(targetB.action, 'skipped');

    // Installed copy must NOT be deleted
    assert.ok(fs.existsSync(installedBPath), 'Orphan installed copy must still be on disk');
    const contentB = fs.readFileSync(path.join(installedBPath, 'SKILL.md'), 'utf-8');
    assert.ok(contentB.includes('Skill B Original'));
  });

  it('5. --install-missing installs into assistant/scope without copy, but not without the flag', async () => {
    // skill-b is only installed in claude-code project, not in kilo-code project
    const kiloSkillBPath = path.join(tempWorkspace, '.kilo', 'skills', 'skill-b');
    assert.strictEqual(fs.existsSync(kiloSkillBPath), false);

    // 5a. Without --install-missing: nothing is installed into kilo-code project
    const resNoMissing = await runCli([
      '--home',
      tempHome,
      '--workspace',
      tempWorkspace,
      'redistribute',
      localSourceDir,
      '--item',
      'skill-b',
      '--assistants',
      'kilo-code',
      '--scope',
      'project',
      '--write',
    ]);

    assert.strictEqual(resNoMissing.code, 0);
    assert.strictEqual(fs.existsSync(kiloSkillBPath), false);
    // targets should have 0 items for kilo-code
    assert.strictEqual(
      resNoMissing.json.targets.filter((t: any) => t.assistant === 'kilo-code').length,
      0
    );

    // 5b. With --install-missing: plans and installs into kilo-code project
    const resMissing = await runCli([
      '--home',
      tempHome,
      '--workspace',
      tempWorkspace,
      'redistribute',
      localSourceDir,
      '--item',
      'skill-b',
      '--assistants',
      'kilo-code',
      '--scope',
      'project',
      '--install-missing',
      '--write',
    ]);

    assert.strictEqual(resMissing.code, 0);
    assert.strictEqual(resMissing.json.mode, 'applied');
    const missingTarget = resMissing.json.targets.find(
      (t: any) => t.item === 'skill-b' && t.assistant === 'kilo-code'
    );
    assert.ok(missingTarget);
    assert.strictEqual(missingTarget.classification, 'missing');
    assert.strictEqual(missingTarget.action, 'installed');

    // Confirm skill-b was installed on disk for kilo-code
    assert.ok(fs.existsSync(kiloSkillBPath));
    const skillBMd = fs.readFileSync(path.join(kiloSkillBPath, 'SKILL.md'), 'utf-8');
    assert.ok(skillBMd.includes('Skill B'));

    // Check project state now records the installation
    const pState = await readState('project', tempWorkspace, tempHome);
    const recorded = pState.installations.find(
      (i) => i.name === 'skill-b' && i.assistant === 'kilo-code'
    );
    assert.ok(recorded, 'New installation must be recorded in state.json');
  });

  it('6. folder that is not a registered local-folder source exits non-zero with NOT_A_LOCAL_FOLDER_SOURCE', async () => {
    const unregisteredDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'unreg-dir-'));
    try {
      const res = await runCli([
        '--home',
        tempHome,
        '--workspace',
        tempWorkspace,
        'redistribute',
        unregisteredDir,
      ]);

      assert.notStrictEqual(res.code, 0);
      assert.ok(res.json?.error, 'JSON error response expected');
      assert.strictEqual(res.json.error.code, 'NOT_A_LOCAL_FOLDER_SOURCE');
      assert.ok(
        res.json.error.message.includes('No registered local-folder source'),
        `Unexpected error message: ${res.json.error.message}`
      );
    } finally {
      await fs.promises.rm(unregisteredDir, { recursive: true, force: true });
    }
  });

  it('7. hook/mcp-server refused without --allow-code-kinds, allowed with flag', async () => {
    // Add a hook definition to localSourceDir
    const hookFile = path.join(localSourceDir, 'my-hook.json');
    await fs.promises.writeFile(
      hookFile,
      JSON.stringify({
        name: 'my-hook',
        event: 'PreToolUse',
        command: 'echo pretool',
      }),
      'utf-8'
    );

    // Register a managed installation for the hook in global state
    const installedHookPath = path.join(tempHome, '.claude', 'hooks', 'my-hook.json');
    await fs.promises.mkdir(path.dirname(installedHookPath), { recursive: true });
    await fs.promises.writeFile(installedHookPath, '{"name":"my-hook"}', 'utf-8');

    const gState = await readState('global', undefined, tempHome);
    gState.installations.push({
      assistant: 'claude-code',
      scope: 'global',
      kind: 'hook',
      name: 'my-hook',
      path: installedHookPath,
      sourceId: 'local-src',
      packageId: 'local-src:my-hook',
      artifactId: 'local-src:my-hook:my-hook',
      installedAt: new Date().toISOString(),
      contentHash: 'hash-initial',
    });
    await writeState('global', gState, undefined, tempHome);

    // 7a. Without --allow-code-kinds: refused with KIND_NOT_ALLOWED
    const resRefused = await runCli([
      '--home',
      tempHome,
      '--workspace',
      tempWorkspace,
      'redistribute',
      localSourceDir,
      '--item',
      'my-hook',
    ]);

    assert.notStrictEqual(resRefused.code, 0);
    assert.ok(resRefused.json?.error);
    assert.strictEqual(resRefused.json.error.code, 'KIND_NOT_ALLOWED');

    // 7b. With --allow-code-kinds: succeeds
    const resAllowed = await runCli([
      '--home',
      tempHome,
      '--workspace',
      tempWorkspace,
      'redistribute',
      localSourceDir,
      '--item',
      'my-hook',
      '--allow-code-kinds',
    ]);

    assert.strictEqual(resAllowed.code, 0);
    assert.strictEqual(resAllowed.json.mode, 'plan');
    const hookTarget = resAllowed.json.targets.find((t: any) => t.item === 'my-hook');
    assert.ok(hookTarget);
    assert.strictEqual(hookTarget.kind, 'hook');
  });

  it('8. stdout is exactly one JSON document and exit code is non-zero on error', async () => {
    const res = await runCli([
      '--home',
      tempHome,
      '--workspace',
      tempWorkspace,
      'redistribute',
      '/nonexistent/path/for/sure',
    ]);

    assert.notStrictEqual(res.code, 0);
    // Validate stdout is pure valid JSON (only one document)
    assert.doesNotThrow(() => {
      const parsed = JSON.parse(res.stdout);
      assert.strictEqual(parsed.error.code, 'NOT_A_LOCAL_FOLDER_SOURCE');
    });
    // Ensure no extra concatenated garbage on stdout
    const trimmed = res.stdout.trim();
    assert.ok(trimmed.startsWith('{') && trimmed.endsWith('}'));
  });

  it('9. describe lists redistribute command', () => {
    const descriptions = runDescribe();
    const found = descriptions.find((d) => d.name === 'redistribute');
    assert.ok(found, 'describe must list redistribute');
    assert.ok(found.description.length > 0);
    assert.ok(found.arguments && found.arguments.length > 0);
    assert.ok(found.arguments.some((a) => a.name === 'target'));
    assert.ok(found.options.some((o) => o.flags.includes('--write')));
    assert.ok(found.options.some((o) => o.flags.includes('--force')));
    assert.ok(found.options.some((o) => o.flags.includes('--install-missing')));
    assert.ok(found.options.some((o) => o.flags.includes('--allow-code-kinds')));
    assert.ok(found.outputShape && typeof found.outputShape === 'object');
  });

  describe('Regression tests (Round 46.5 fix: no duplicate records, false modified-locally)', () => {
    it('(1) after --write the state has the same number of installation records as before and the new hash', async () => {
      const gStateBefore = await readState('global', undefined, tempHome);
      const pStateBefore = await readState('project', tempWorkspace, tempHome);
      const gCountBefore = gStateBefore.installations.length;
      const pCountBefore = pStateBefore.installations.length;

      // Edit skill-a in the folder
      const skillADir = path.join(localSourceDir, 'skill-a');
      await fs.promises.writeFile(
        path.join(skillADir, 'SKILL.md'),
        '---\nname: skill-a\ndescription: Skill A v2\n---\n# Skill A v2\n',
        'utf-8'
      );
      const skillAObj = await readSkill(skillADir);
      const expectedHash = canonicalSkillHash(skillAObj);

      const res = await runCli([
        '--home',
        tempHome,
        '--workspace',
        tempWorkspace,
        'redistribute',
        localSourceDir,
        '--item',
        'skill-a',
        '--write',
      ]);

      assert.strictEqual(res.code, 0, `CLI failed: ${res.stderr}`);
      assert.strictEqual(res.json.mode, 'applied');
      assert.strictEqual(res.json.targets.length, 2);

      const gStateAfter = await readState('global', undefined, tempHome);
      const pStateAfter = await readState('project', tempWorkspace, tempHome);

      // (1) Number of installation records must be unchanged!
      assert.strictEqual(
        gStateAfter.installations.length,
        gCountBefore,
        `Global installation count changed: before was ${gCountBefore}, after is ${gStateAfter.installations.length}`
      );
      assert.strictEqual(
        pStateAfter.installations.length,
        pCountBefore,
        `Project installation count changed: before was ${pCountBefore}, after is ${pStateAfter.installations.length}`
      );

      // Verify the new hash
      const globalInst = gStateAfter.installations.find((i) => i.name === 'skill-a');
      assert.ok(globalInst);
      assert.strictEqual(globalInst.contentHash, expectedHash);

      const projectInst = pStateAfter.installations.find((i) => i.name === 'skill-a');
      assert.ok(projectInst);
      assert.strictEqual(projectInst.contentHash, expectedHash);
    });

    it('(2) a second redistribute plan right after a successful --write returns only identical targets, one per installation', async () => {
      // Edit skill-a in the folder
      const skillADir = path.join(localSourceDir, 'skill-a');
      await fs.promises.writeFile(
        path.join(skillADir, 'SKILL.md'),
        '---\nname: skill-a\ndescription: Skill A v2\n---\n# Skill A v2\n',
        'utf-8'
      );

      // First run --write
      const resWrite = await runCli([
        '--home',
        tempHome,
        '--workspace',
        tempWorkspace,
        'redistribute',
        localSourceDir,
        '--item',
        'skill-a',
        '--write',
      ]);
      assert.strictEqual(resWrite.code, 0);

      // Second run (plan mode) immediately after
      const resPlan = await runCli([
        '--home',
        tempHome,
        '--workspace',
        tempWorkspace,
        'redistribute',
        localSourceDir,
        '--item',
        'skill-a',
      ]);

      assert.strictEqual(resPlan.code, 0);
      assert.strictEqual(resPlan.json.mode, 'plan');
      // Exactly 2 targets (one for claude global, one for kilo project), both identical
      assert.strictEqual(resPlan.json.targets.length, 2);
      for (const t of resPlan.json.targets) {
        assert.strictEqual(t.classification, 'identical');
        assert.strictEqual(t.action, 'skip');
        assert.strictEqual(t.oldHash, t.newHash);
      }
    });

    it('(3) updates right after --write reports up-to-date (one row per item)', async () => {
      // Edit skill-a in the folder
      const skillADir = path.join(localSourceDir, 'skill-a');
      await fs.promises.writeFile(
        path.join(skillADir, 'SKILL.md'),
        '---\nname: skill-a\ndescription: Skill A v2\n---\n# Skill A v2\n',
        'utf-8'
      );

      // Run redistribute --write
      const resWrite = await runCli([
        '--home',
        tempHome,
        '--workspace',
        tempWorkspace,
        'redistribute',
        localSourceDir,
        '--item',
        'skill-a',
        '--write',
      ]);
      assert.strictEqual(resWrite.code, 0);

      // Run updates command
      const resUpdates = await runCli([
        '--home',
        tempHome,
        '--workspace',
        tempWorkspace,
        'updates',
      ]);

      assert.strictEqual(resUpdates.code, 0);
      assert.ok(Array.isArray(resUpdates.json));

      // Exactly 3 managed items total (skill-a global, skill-a project, skill-b project)
      assert.strictEqual(resUpdates.json.length, 3);
      for (const item of resUpdates.json) {
        assert.strictEqual(item.status, 'up-to-date');
      }
    });

    it('(4) hand-edit one of two copies, edit folder: plan has 1 row per installation, --write keeps hand edit, --force overwrites with backup only for hand-edited', async () => {
      // skill-a is installed in claude global and kilo project.
      // Hand-edit ONLY claude global copy
      const claudeGlobalPath = path.join(tempHome, '.claude', 'skills', 'skill-a', 'SKILL.md');
      const handEditedText = '---\nname: skill-a\ndescription: Hand edit\n---\n# Hand Edit\n';
      await fs.promises.writeFile(claudeGlobalPath, handEditedText, 'utf-8');

      // Edit the source folder to v2
      const skillADir = path.join(localSourceDir, 'skill-a');
      await fs.promises.writeFile(
        path.join(skillADir, 'SKILL.md'),
        '---\nname: skill-a\ndescription: Upstream v2\n---\n# Upstream v2\n',
        'utf-8'
      );

      // Check plan mode: exactly one row per installation
      const resPlan = await runCli([
        '--home',
        tempHome,
        '--workspace',
        tempWorkspace,
        'redistribute',
        localSourceDir,
        '--item',
        'skill-a',
      ]);

      assert.strictEqual(resPlan.code, 0);
      assert.strictEqual(resPlan.json.targets.length, 2);

      const modifiedTarget = resPlan.json.targets.find(
        (t: any) => t.assistant === 'claude-code' && t.scope === 'global'
      );
      assert.ok(modifiedTarget);
      assert.strictEqual(modifiedTarget.classification, 'modified-locally');
      assert.strictEqual(modifiedTarget.action, 'skip');

      const untouchedTarget = resPlan.json.targets.find(
        (t: any) => t.assistant === 'kilo-code' && t.scope === 'project'
      );
      assert.ok(untouchedTarget);
      assert.strictEqual(untouchedTarget.classification, 'stale');
      assert.strictEqual(untouchedTarget.action, 'update');

      // Run --write WITHOUT --force: keeps hand edit, updates the other
      const resWriteNoForce = await runCli([
        '--home',
        tempHome,
        '--workspace',
        tempWorkspace,
        'redistribute',
        localSourceDir,
        '--item',
        'skill-a',
        '--write',
      ]);

      assert.strictEqual(resWriteNoForce.code, 0);
      assert.strictEqual(resWriteNoForce.json.targets.length, 2);

      // Verify hand-edited copy remains unchanged on disk
      assert.strictEqual(fs.readFileSync(claudeGlobalPath, 'utf-8'), handEditedText);

      // Verify untouched copy was updated on disk
      const kiloProjectPath = path.join(
        tempWorkspace,
        '.kilo',
        'skills',
        'skill-a',
        'SKILL.md'
      );
      assert.ok(fs.readFileSync(kiloProjectPath, 'utf-8').includes('Upstream v2'));

      // Now run with --force --write: overwrites hand-edited copy, backs up to trash
      const resWriteForce = await runCli([
        '--home',
        tempHome,
        '--workspace',
        tempWorkspace,
        'redistribute',
        localSourceDir,
        '--item',
        'skill-a',
        '--force',
        '--write',
      ]);

      assert.strictEqual(resWriteForce.code, 0);
      const forcedModified = resWriteForce.json.targets.find(
        (t: any) => t.assistant === 'claude-code' && t.scope === 'global'
      );
      assert.ok(forcedModified);
      assert.strictEqual(forcedModified.action, 'updated');
      assert.ok(forcedModified.backupPath, 'backupPath must be present for hand-edited copy');
      assert.strictEqual(
        fs.readFileSync(path.join(forcedModified.backupPath, 'SKILL.md'), 'utf-8'),
        handEditedText
      );

      // Untouched copy was identical in this run so it was skipped without backupPath
      const untouchedInForced = resWriteForce.json.targets.find(
        (t: any) => t.assistant === 'kilo-code' && t.scope === 'project'
      );
      assert.ok(untouchedInForced);
      assert.strictEqual(untouchedInForced.backupPath, undefined);
    });

    it('(5) outcome list has no failed entries and no duplicates across redistribute and --install-missing', async () => {
      // Edit skill-a in the folder
      const skillADir = path.join(localSourceDir, 'skill-a');
      await fs.promises.writeFile(
        path.join(skillADir, 'SKILL.md'),
        '---\nname: skill-a\ndescription: Skill A v3\n---\n# Skill A v3\n',
        'utf-8'
      );

      const res = await runCli([
        '--home',
        tempHome,
        '--workspace',
        tempWorkspace,
        'redistribute',
        localSourceDir,
        '--item',
        'skill-a',
        '--install-missing',
        '--assistants',
        'claude-code,kilo-code',
        '--write',
      ]);

      assert.strictEqual(res.code, 0);
      const targets = res.json.targets;
      assert.ok(targets.length > 0);

      // Check no failed entries
      for (const t of targets) {
        assert.notStrictEqual(t.action, 'failed', `Target ${t.item} had failed action`);
      }

      // Check no duplicate target keys
      const keys = targets.map((t: any) => `${t.assistant}:${t.scope}:${t.kind}:${t.item}`);
      const uniqueKeys = new Set(keys);
      assert.strictEqual(
        keys.length,
        uniqueKeys.size,
        `Duplicate targets found: ${JSON.stringify(keys)}`
      );
    });
  });
});
