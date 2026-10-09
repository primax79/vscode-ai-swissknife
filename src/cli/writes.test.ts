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
  readManifest,
  writeState,
  readState,
  SCHEMA_VERSION,
} from '../domain/registry';
import type { Source, ManagedInstallation } from '../domain/types';
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

describe('CLI write commands behind --write (Task 46.4)', () => {
  let tempHome: string;
  let tempWorkspace: string;
  let localSourceDir: string;

  beforeEach(async () => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'swk-cli-write-home-'));
    tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'swk-cli-write-ws-'));
    localSourceDir = path.join(tempWorkspace, 'my-source');

    fs.mkdirSync(localSourceDir, { recursive: true });

    // Setup a valid skill inside localSourceDir
    const skillDir = path.join(localSourceDir, 'test-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: test-skill\ndescription: Test Skill\n---\n# Test Skill content\n',
      'utf-8'
    );

    // Setup an MCP server fixture in localSourceDir
    fs.writeFileSync(
      path.join(localSourceDir, 'mcp.json'),
      JSON.stringify(
        {
          mcpServers: {
            'test-mcp': {
              command: 'node',
              args: ['server.js'],
            },
          },
        },
        null,
        2
      ),
      'utf-8'
    );

    // Initialize global and workspace manifests
    await writeManifest('global', {
      schemaVersion: SCHEMA_VERSION,
      sources: [
        {
          id: 'local-test',
          type: 'local-folder',
          scope: 'global',
          name: 'Local Test',
          localPath: path.relative(tempHome, localSourceDir),
        },
      ],
      desiredInstallations: [],
    }, undefined, tempHome);

    await writeState('global', {
      schemaVersion: SCHEMA_VERSION,
      installations: [],
    }, undefined, tempHome);

    await writeManifest('project', {
      schemaVersion: SCHEMA_VERSION,
      sources: [
        {
          id: 'proj-source',
          type: 'local-folder',
          scope: 'project',
          name: 'Project Source',
          localPath: path.relative(tempWorkspace, localSourceDir),
        },
      ],
      desiredInstallations: [],
    }, tempWorkspace, tempHome);

    await writeState('project', {
      schemaVersion: SCHEMA_VERSION,
      installations: [],
    }, tempWorkspace, tempHome);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempHome, { recursive: true, force: true });
    } catch {
      // ignore
    }
    try {
      fs.rmSync(tempWorkspace, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('1. describe lists every new write command and options', () => {
    const descriptions = runDescribe();
    const names = descriptions.map((d) => d.name);

    assert.ok(names.includes('apply-install'), 'must list apply-install');
    assert.ok(names.includes('uninstall'), 'must list uninstall');
    assert.ok(names.includes('source add'), 'must list source add');
    assert.ok(names.includes('source remove'), 'must list source remove');
    assert.ok(names.includes('update'), 'must list update');
    assert.ok(names.includes('trash list'), 'must list trash list');
    assert.ok(names.includes('trash restore'), 'must list trash restore');
    assert.ok(names.includes('trash empty'), 'must list trash empty');

    const applyDef = descriptions.find((d) => d.name === 'apply-install')!;
    assert.ok(applyDef.options.some((o) => o.flags.includes('--overwrite')));
    assert.ok(applyDef.options.some((o) => o.flags.includes('--write')));
    assert.ok(applyDef.options.some((o) => o.flags.includes('--allow-code-kinds')));

    const unDef = descriptions.find((d) => d.name === 'uninstall')!;
    assert.ok(unDef.options.some((o) => o.flags.includes('--hard')));
    assert.ok(unDef.options.some((o) => o.flags.includes('--write')));

    const srcAddDef = descriptions.find((d) => d.name === 'source add')!;
    assert.ok(srcAddDef.options.some((o) => o.flags.includes('--replace')));
    assert.ok(srcAddDef.options.some((o) => o.flags.includes('--write')));

    const updateDef = descriptions.find((d) => d.name === 'update')!;
    assert.ok(updateDef.options.some((o) => o.flags.includes('--all')));
    assert.ok(updateDef.options.some((o) => o.flags.includes('--include-modified')));
  });

  it('2. plan-only without --write leaves disk byte-identical for all write commands', async () => {
    const beforeHome = snapshotDirectory(tempHome);
    const beforeWs = snapshotDirectory(tempWorkspace);

    // apply-install without --write
    const resApply = await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'apply-install',
      '--source', 'local-test',
      '--artifact', 'test-skill',
      '--assistants', 'claude-code',
      '--scopes', 'global',
    ]);
    assert.strictEqual(resApply.code, 0);
    assert.strictEqual(resApply.json.mode, 'plan');

    // source add without --write
    const resAdd = await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'source', 'add',
      'local-folder', localSourceDir,
      '--id', 'new-source',
      '--scope', 'project',
    ]);
    assert.strictEqual(resAdd.code, 0);
    assert.strictEqual(resAdd.json.mode, 'plan');

    // source remove without --write
    const resRemove = await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'source', 'remove',
      'local-test',
      '--scope', 'global',
    ]);
    assert.strictEqual(resRemove.code, 0);
    assert.strictEqual(resRemove.json.mode, 'plan');

    // update --all without --write
    const resUpdate = await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'update',
      '--all',
    ]);
    assert.strictEqual(resUpdate.code, 0);
    assert.strictEqual(resUpdate.json.mode, 'plan');

    // trash empty without --write
    const resEmpty = await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'trash', 'empty',
    ]);
    assert.strictEqual(resEmpty.code, 0);
    assert.strictEqual(resEmpty.json.mode, 'plan');

    // Verify temp home and workspace directories are completely untouched
    const afterHome = snapshotDirectory(tempHome);
    const afterWs = snapshotDirectory(tempWorkspace);
    assertSnapshotsEqual(beforeHome, afterHome, 'Home snapshot changed during plan-only calls');
    assertSnapshotsEqual(beforeWs, afterWs, 'Workspace snapshot changed during plan-only calls');
  });

  it('3. code kinds (hook, mcp-server) refused unless --allow-code-kinds is provided', async () => {
    // apply-install mcp-server without --allow-code-kinds
    const resMcp = await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'apply-install',
      '--source', 'local-test',
      '--artifact', 'test-mcp',
      '--assistants', 'claude-code',
      '--scopes', 'global',
      '--write',
    ]);
    assert.notStrictEqual(resMcp.code, 0);
    assert.strictEqual(resMcp.json.error.code, 'KIND_NOT_ALLOWED');

    // apply-install mcp-server WITH --allow-code-kinds (plan mode)
    const resMcpAllowed = await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'apply-install',
      '--source', 'local-test',
      '--artifact', 'test-mcp',
      '--assistants', 'claude-code',
      '--scopes', 'global',
      '--allow-code-kinds',
    ]);
    assert.strictEqual(resMcpAllowed.code, 0);
    assert.strictEqual(resMcpAllowed.json.mode, 'plan');
  });

  it('4. apply-install applies new targets and skips conflicts unless --overwrite', async () => {
    // 1st apply: new target
    const res1 = await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'apply-install',
      '--source', 'local-test',
      '--artifact', 'test-skill',
      '--assistants', 'claude-code',
      '--scopes', 'global',
      '--write',
    ]);
    assert.strictEqual(res1.code, 0);
    assert.strictEqual(res1.json.mode, 'applied');
    assert.strictEqual(res1.json.targets[0].status, 'applied');
    assert.ok(res1.json.targets[0].changedFiles.added.length > 0);

    // Verify installation exists in state
    const state = await readState('global', undefined, tempHome);
    assert.strictEqual(state.installations.length, 1);
    assert.strictEqual(state.installations[0].name, 'test-skill');

    // 2nd apply without --overwrite: skips conflict
    const res2 = await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'apply-install',
      '--source', 'local-test',
      '--artifact', 'test-skill',
      '--assistants', 'claude-code',
      '--scopes', 'global',
      '--write',
    ]);
    assert.strictEqual(res2.code, 0);
    assert.strictEqual(res2.json.targets[0].status, 'skipped');

    // 3rd apply WITH --overwrite: overwrites and backs up previous version to trash
    const res3 = await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'apply-install',
      '--source', 'local-test',
      '--artifact', 'test-skill',
      '--assistants', 'claude-code',
      '--scopes', 'global',
      '--overwrite',
      '--write',
    ]);
    assert.strictEqual(res3.code, 0);
    assert.strictEqual(res3.json.targets[0].status, 'applied');
    assert.ok(res3.json.targets[0].backupPath, 'Must report backupPath when overwriting');
    assert.ok(fs.existsSync(res3.json.targets[0].backupPath));
  });

  it('5. uninstall soft moves to trash and --hard removes permanently, removing state record in both', async () => {
    // First, install a skill
    await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'apply-install',
      '--source', 'local-test',
      '--artifact', 'test-skill',
      '--assistants', 'claude-code',
      '--scopes', 'global',
      '--write',
    ]);

    const stateBefore = await readState('global', undefined, tempHome);
    assert.strictEqual(stateBefore.installations.length, 1);
    const installedPath = stateBefore.installations[0].path;
    assert.ok(fs.existsSync(installedPath));

    const itemKey = 'claude-code:global:skill:test-skill';

    // 1. Plan uninstall
    const resPlan = await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'uninstall',
      itemKey,
    ]);
    assert.strictEqual(resPlan.code, 0);
    assert.strictEqual(resPlan.json.mode, 'plan');
    assert.strictEqual(resPlan.json.action, 'trash');
    assert.ok(fs.existsSync(installedPath), 'Plan must not remove file');

    // 2. Soft uninstall
    const resSoft = await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'uninstall',
      itemKey,
      '--write',
    ]);
    assert.strictEqual(resSoft.code, 0);
    assert.strictEqual(resSoft.json.mode, 'applied');
    assert.strictEqual(resSoft.json.hard, false);
    assert.ok(!fs.existsSync(installedPath), 'Soft delete must move original file');
    assert.ok(resSoft.json.backupPath, 'Must return backupPath');
    assert.ok(fs.existsSync(resSoft.json.backupPath), 'Backup folder must exist in trash');

    const stateAfterSoft = await readState('global', undefined, tempHome);
    assert.strictEqual(stateAfterSoft.installations.length, 0, 'State record must be removed');

    // 3. Install again and test --hard
    await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'apply-install',
      '--source', 'local-test',
      '--artifact', 'test-skill',
      '--assistants', 'claude-code',
      '--scopes', 'global',
      '--write',
    ]);

    const resHard = await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'uninstall',
      itemKey,
      '--hard',
      '--write',
    ]);
    assert.strictEqual(resHard.code, 0);
    assert.strictEqual(resHard.json.mode, 'applied');
    assert.strictEqual(resHard.json.hard, true);
    assert.strictEqual(resHard.json.backupPath, undefined, 'Hard uninstall has no backupPath');

    const stateAfterHard = await readState('global', undefined, tempHome);
    assert.strictEqual(stateAfterHard.installations.length, 0);
  });

  it('6. source add validates location, rejects duplicates unless --replace, derives defaults', async () => {
    // Bad URL rejects
    const resBad = await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'source', 'add',
      'git-custom',
      'http://github.com/org/repo.git',
      '--write',
    ]);
    assert.notStrictEqual(resBad.code, 0);
    assert.strictEqual(resBad.json.error.code, 'INVALID_ARGUMENT');

    // Missing repo path rejects
    const resNoPath = await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'source', 'add',
      'git-custom',
      'https://github.com',
      '--write',
    ]);
    assert.notStrictEqual(resNoPath.code, 0);
    assert.strictEqual(resNoPath.json.error.code, 'INVALID_ARGUMENT');

    // Add source with derived id and name
    const resAdd = await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'source', 'add',
      'git-custom',
      'https://github.com/my-org/custom-tools.git',
      '--scope', 'global',
      '--write',
    ]);
    assert.strictEqual(resAdd.code, 0);
    assert.strictEqual(resAdd.json.source.id, 'custom-tools');
    assert.strictEqual(resAdd.json.source.name, 'Custom tools');

    // Duplicate ID without --replace rejected
    const resDup = await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'source', 'add',
      'git-custom',
      'https://github.com/other-org/custom-tools.git',
      '--scope', 'global',
      '--write',
    ]);
    assert.notStrictEqual(resDup.code, 0);
    assert.strictEqual(resDup.json.error.code, 'DUPLICATE_ID');

    // Duplicate ID WITH --replace succeeds
    const resReplace = await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'source', 'add',
      'git-custom',
      'https://github.com/other-org/custom-tools.git',
      '--scope', 'global',
      '--replace',
      '--write',
    ]);
    assert.strictEqual(resReplace.code, 0);
    assert.strictEqual(resReplace.json.action, 'replaced');

    const manifest = await readManifest('global', undefined, tempHome);
    const src = manifest.sources.find((s) => s.id === 'custom-tools')!;
    assert.strictEqual(src.url, 'https://github.com/other-org/custom-tools.git');
  });

  it('7. source remove removes source from manifest and reports changed files', async () => {
    const resRemove = await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'source', 'remove',
      'local-test',
      '--scope', 'global',
      '--write',
    ]);
    assert.strictEqual(resRemove.code, 0);
    assert.strictEqual(resRemove.json.action, 'removed');
    assert.strictEqual(resRemove.json.source.id, 'local-test');
    assert.ok(resRemove.json.changedFiles.changed.length > 0);

    const manifest = await readManifest('global', undefined, tempHome);
    assert.strictEqual(manifest.sources.some((s) => s.id === 'local-test'), false);

    // Non-existent source remove fails with NOT_FOUND
    const resNotFound = await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'source', 'remove',
      'non-existent',
      '--scope', 'global',
      '--write',
    ]);
    assert.notStrictEqual(resNotFound.code, 0);
    assert.strictEqual(resNotFound.json.error.code, 'NOT_FOUND');
  });

  it('8. update reports oldRevision/newRevision/changedFiles and skips modified-locally unless --include-modified', async () => {
    // Install initial version of skill
    await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'apply-install',
      '--source', 'local-test',
      '--artifact', 'test-skill',
      '--assistants', 'claude-code',
      '--scopes', 'global',
      '--write',
    ]);

    const state = await readState('global', undefined, tempHome);
    const instPath = state.installations[0].path;
    const skillMdPath = path.join(instPath, 'SKILL.md');

    // Edit the installed copy locally to create local drift
    fs.appendFileSync(skillMdPath, '\n# User local modifications\n');

    // Modify upstream source to introduce an upstream update
    fs.appendFileSync(
      path.join(localSourceDir, 'test-skill', 'SKILL.md'),
      '\n# Upstream update content\n'
    );

    // Update without --include-modified: skips modified-locally copy
    const resUpdateSkipped = await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'update',
      '--all',
      '--write',
    ]);
    assert.strictEqual(resUpdateSkipped.code, 0);
    const skippedTarget = resUpdateSkipped.json.targets.find(
      (t: any) => t.item === 'test-skill'
    );
    assert.ok(
      skippedTarget.status === 'modified-locally' ||
      skippedTarget.status === 'modified-and-update-available'
    );
    assert.strictEqual(skippedTarget.action, 'skipped');

    // Update WITH --include-modified: overwrites and backs up previous version to trash
    const resUpdateForce = await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'update',
      'claude-code:global:skill:test-skill',
      '--include-modified',
      '--write',
    ]);
    assert.strictEqual(resUpdateForce.code, 0);
    const updatedTarget = resUpdateForce.json.targets.find(
      (t: any) => t.item === 'test-skill'
    );
    assert.strictEqual(updatedTarget.status, 'updated');
    assert.ok(updatedTarget.backupPath, 'Previous version must be saved in trash');
    assert.ok(fs.existsSync(updatedTarget.backupPath));
    assert.ok(updatedTarget.changedFiles.changed.includes('SKILL.md'));
  });

  it('9. trash list, restore, and empty round trip byte-identical with typed conflict', async () => {
    // Install a skill and soft-delete it to trash
    await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'apply-install',
      '--source', 'local-test',
      '--artifact', 'test-skill',
      '--assistants', 'claude-code',
      '--scopes', 'global',
      '--write',
    ]);

    const state = await readState('global', undefined, tempHome);
    const origPath = state.installations[0].path;
    const origSnapshot = snapshotDirectory(origPath);

    const resUninstall = await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'uninstall',
      'claude-code:global:skill:test-skill',
      '--write',
    ]);
    assert.strictEqual(resUninstall.code, 0);

    // 1. trash list
    const resList = await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'trash', 'list',
    ]);
    assert.strictEqual(resList.code, 0);
    assert.strictEqual(resList.json.length, 1);
    const trashEntry = resList.json[0];
    assert.strictEqual(trashEntry.name, 'test-skill');

    // 2. Test conflict: create conflicting file at origPath
    fs.mkdirSync(origPath, { recursive: true });
    fs.writeFileSync(path.join(origPath, 'conflict.txt'), 'conflict');

    const resConflict = await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'trash', 'restore',
      trashEntry.id,
      '--write',
    ]);
    assert.notStrictEqual(resConflict.code, 0);
    assert.strictEqual(resConflict.json.error.code, 'CONFLICT');

    // Remove conflict
    fs.rmSync(origPath, { recursive: true, force: true });

    // 3. trash restore without destination conflict
    const resRestore = await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'trash', 'restore',
      trashEntry.id,
      '--write',
    ]);
    assert.strictEqual(resRestore.code, 0);
    assert.strictEqual(resRestore.json.mode, 'applied');
    assert.ok(fs.existsSync(origPath));

    // Verify restored files are byte-identical to original
    const restoredSnapshot = snapshotDirectory(origPath);
    assertSnapshotsEqual(origSnapshot, restoredSnapshot, 'Restored files must be byte-identical');

    // 4. Install again, soft-delete again, then test trash empty
    await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'apply-install',
      '--source', 'local-test',
      '--artifact', 'test-skill',
      '--assistants', 'claude-code',
      '--scopes', 'global',
      '--overwrite',
      '--write',
    ]);

    await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'uninstall',
      'claude-code:global:skill:test-skill',
      '--write',
    ]);

    const resEmpty = await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'trash', 'empty',
      '--write',
    ]);
    assert.strictEqual(resEmpty.code, 0);
    assert.strictEqual(resEmpty.json.mode, 'applied');
    assert.ok(resEmpty.json.count >= 1);

    const resListAfter = await runCli([
      '--home', tempHome,
      '--workspace', tempWorkspace,
      'trash', 'list',
    ]);
    assert.strictEqual(resListAfter.json.length, 0);
  });

  it('10. concurrent CLI writers serialize under stateLock and lose no updates', async () => {
    // Run two CLI source add commands concurrently
    const [p1, p2] = await Promise.all([
      runCli([
        '--home', tempHome,
        '--workspace', tempWorkspace,
        'source', 'add',
        'git-custom',
        'https://github.com/org/source-one.git',
        '--id', 'source-one',
        '--scope', 'global',
        '--write',
      ]),
      runCli([
        '--home', tempHome,
        '--workspace', tempWorkspace,
        'source', 'add',
        'git-custom',
        'https://github.com/org/source-two.git',
        '--id', 'source-two',
        '--scope', 'global',
        '--write',
      ]),
    ]);

    assert.strictEqual(p1.code, 0);
    assert.strictEqual(p2.code, 0);

    const manifest = await readManifest('global', undefined, tempHome);
    const ids = manifest.sources.map((s) => s.id);
    assert.ok(ids.includes('source-one'), 'source-one must be preserved');
    assert.ok(ids.includes('source-two'), 'source-two must be preserved');
  });
});
