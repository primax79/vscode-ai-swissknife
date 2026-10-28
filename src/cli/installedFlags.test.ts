import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { runInstalled } from './commands';
import { writeManifest, writeState, SCHEMA_VERSION } from '../domain/registry';
import type { ManagedInstallation, Source } from '../domain/types';
import { buildInstalledTree } from '../engine/installedTree';

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
      try {
        const lst = fs.lstatSync(fullPath);
        if (lst.isSymbolicLink()) {
          const raw = fs.readlinkSync(fullPath);
          map.set(`symlink:${relPath}`, raw);
        } else if (lst.isDirectory()) {
          traverse(fullPath);
        } else if (lst.isFile()) {
          const content = fs.readFileSync(fullPath);
          const hash = crypto.createHash('sha256').update(content).digest('hex');
          map.set(relPath, hash);
        }
      } catch {
        // ignore
      }
    }
  }

  traverse(dir);
  return map;
}

function assertSnapshotsEqual(before: Map<string, string>, after: Map<string, string>) {
  assert.strictEqual(
    after.size,
    before.size,
    `Snapshots differ in entry count: before=${before.size}, after=${after.size}`
  );
  for (const [key, val] of before.entries()) {
    assert.strictEqual(after.get(key), val, `File ${key} changed after read-only command`);
  }
}

describe('Installed Flags — link, copy, broken-link, orphan, duplicate (Task 48.2)', () => {
  let tempHome: string;
  let tempWorkspace: string;
  let sourceDir: string;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'swk-flags-home-'));
    tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'swk-flags-ws-'));
    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swk-flags-src-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempHome, { recursive: true, force: true });
      fs.rmSync(tempWorkspace, { recursive: true, force: true });
      fs.rmSync(sourceDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('1. classifies copy vs link vs broken-link correctly', async () => {
    const claudeSkillsDir = path.join(tempHome, '.claude', 'skills');
    fs.mkdirSync(claudeSkillsDir, { recursive: true });

    // 1. Regular copy skill
    const copySkillDir = path.join(claudeSkillsDir, 'skill-copy');
    fs.mkdirSync(copySkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(copySkillDir, 'SKILL.md'),
      '---\nname: skill-copy\ndescription: A copy skill\n---\n# Copy\n'
    );

    // 2. Symlink skill pointing to valid external folder
    const externalSkillDir = path.join(sourceDir, 'skill-external');
    fs.mkdirSync(externalSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(externalSkillDir, 'SKILL.md'),
      '---\nname: skill-linked\ndescription: Linked skill\n---\n# Linked\n'
    );
    const linkSkillDir = path.join(claudeSkillsDir, 'skill-linked');
    fs.symlinkSync(externalSkillDir, linkSkillDir);

    // 3. Broken symlink skill pointing to nonexistent folder
    const brokenTargetDir = path.join(sourceDir, 'nonexistent-target');
    const brokenLinkSkillDir = path.join(claudeSkillsDir, 'skill-broken');
    fs.symlinkSync(brokenTargetDir, brokenLinkSkillDir);

    const installed = await runInstalled({
      home: tempHome,
      workspace: tempWorkspace,
    });

    const copyItem = installed.find((i) => i.name === 'skill-copy');
    assert.ok(copyItem, 'skill-copy must be found');
    assert.ok(copyItem.flags.includes('copy'), 'skill-copy must have "copy" flag');
    assert.ok(!copyItem.flags.includes('link'), 'skill-copy must not have "link" flag');
    assert.strictEqual(copyItem.linkTarget, undefined);

    const linkItem = installed.find((i) => i.name === 'skill-linked');
    assert.ok(linkItem, 'skill-linked must be found');
    assert.ok(linkItem.flags.includes('link'), 'skill-linked must have "link" flag');
    assert.ok(!linkItem.flags.includes('copy'), 'skill-linked must not have "copy" flag');
    assert.ok(!linkItem.flags.includes('broken-link'), 'skill-linked must not be broken');
    assert.strictEqual(linkItem.linkTarget, externalSkillDir);

    const brokenItem = installed.find((i) => i.name === 'skill-broken');
    assert.ok(brokenItem, 'skill-broken must be found');
    assert.ok(brokenItem.flags.includes('link'), 'skill-broken must have "link" flag');
    assert.ok(brokenItem.flags.includes('broken-link'), 'skill-broken must have "broken-link" flag');
    assert.ok(!brokenItem.flags.includes('copy'), 'skill-broken must not have "copy" flag');
    assert.strictEqual(brokenItem.linkTarget, brokenTargetDir);
  });

  it('2. detects orphan: managed item whose artifact no longer exists in registered source', async () => {
    // Register a source in manifest that does NOT contain the artifact
    const manifestSources: Source[] = [
      {
        id: 'team-source',
        name: 'Team Source',
        type: 'local-folder',
        localPath: sourceDir,
        scope: 'project',
      },
    ];
    await writeManifest(
      'project',
      { schemaVersion: SCHEMA_VERSION, sources: manifestSources, desiredInstallations: [] },
      tempWorkspace,
      tempHome
    );

    // Source dir is empty (no artifact "orphan-skill" in sourceDir)
    const skillPath = path.join(tempWorkspace, '.claude', 'skills', 'orphan-skill');
    fs.mkdirSync(skillPath, { recursive: true });
    fs.writeFileSync(
      path.join(skillPath, 'SKILL.md'),
      '---\nname: orphan-skill\ndescription: Orphan skill\n---\n# Orphan\n'
    );

    const managed: ManagedInstallation = {
      assistant: 'claude-code',
      scope: 'project',
      projectPath: tempWorkspace,
      kind: 'skill',
      name: 'orphan-skill',
      path: skillPath,
      sourceId: 'team-source',
      artifactId: 'orphan-skill',
      packageId: 'team-source:pkg',
      installedAt: new Date().toISOString(),
    };
    await writeState(
      'project',
      { schemaVersion: SCHEMA_VERSION, installations: [managed] },
      tempWorkspace,
      tempHome
    );

    const installed = await runInstalled({
      home: tempHome,
      workspace: tempWorkspace,
    });

    const item = installed.find((i) => i.name === 'orphan-skill');
    assert.ok(item, 'orphan-skill must be found');
    assert.ok(item.flags.includes('orphan'), `Expected "orphan" in flags, got: ${JSON.stringify(item.flags)}`);
    assert.ok(item.flags.includes('copy'), 'Should also be a copy');
  });

  it('3. detects duplicate across global and project for same assistant', async () => {
    // Register a source globally and in workspace
    const source: Source = {
      id: 'shared-source',
      name: 'Shared Source',
      type: 'local-folder',
      localPath: sourceDir,
      scope: 'global',
    };
    // Put artifact in sourceDir
    const srcSkill = path.join(sourceDir, 'shared-skill');
    fs.mkdirSync(srcSkill, { recursive: true });
    fs.writeFileSync(
      path.join(srcSkill, 'SKILL.md'),
      '---\nname: shared-skill\ndescription: Shared skill\n---\n# Shared\n'
    );

    await writeManifest(
      'global',
      { schemaVersion: SCHEMA_VERSION, sources: [source], desiredInstallations: [] },
      undefined,
      tempHome
    );

    // Install in Global
    const globalSkillPath = path.join(tempHome, '.claude', 'skills', 'shared-skill');
    fs.mkdirSync(globalSkillPath, { recursive: true });
    fs.writeFileSync(
      path.join(globalSkillPath, 'SKILL.md'),
      '---\nname: shared-skill\ndescription: Shared skill\n---\n# Shared\n'
    );
    const globalManaged: ManagedInstallation = {
      assistant: 'claude-code',
      scope: 'global',
      kind: 'skill',
      name: 'shared-skill',
      path: globalSkillPath,
      sourceId: 'shared-source',
      artifactId: 'shared-skill',
      packageId: 'shared-source:pkg',
      installedAt: new Date().toISOString(),
    };
    await writeState(
      'global',
      { schemaVersion: SCHEMA_VERSION, installations: [globalManaged] },
      undefined,
      tempHome
    );

    // Install in Project
    const projectSkillPath = path.join(tempWorkspace, '.claude', 'skills', 'shared-skill');
    fs.mkdirSync(projectSkillPath, { recursive: true });
    fs.writeFileSync(
      path.join(projectSkillPath, 'SKILL.md'),
      '---\nname: shared-skill\ndescription: Shared skill\n---\n# Shared\n'
    );
    const projectManaged: ManagedInstallation = {
      assistant: 'claude-code',
      scope: 'project',
      projectPath: tempWorkspace,
      kind: 'skill',
      name: 'shared-skill',
      path: projectSkillPath,
      sourceId: 'shared-source',
      artifactId: 'shared-skill',
      packageId: 'shared-source:pkg',
      installedAt: new Date().toISOString(),
    };
    await writeState(
      'project',
      { schemaVersion: SCHEMA_VERSION, installations: [projectManaged] },
      tempWorkspace,
      tempHome
    );

    const installed = await runInstalled({
      home: tempHome,
      workspace: tempWorkspace,
    });

    const gItem = installed.find((i) => i.scope === 'global' && i.name === 'shared-skill');
    const pItem = installed.find((i) => i.scope === 'project' && i.name === 'shared-skill');

    assert.ok(gItem, 'Global item must be found');
    assert.ok(pItem, 'Project item must be found');

    assert.ok(gItem.flags.includes('duplicate'), 'Global item must have duplicate flag');
    assert.ok(pItem.flags.includes('duplicate'), 'Project item must have duplicate flag');

    assert.deepStrictEqual(gItem.duplicateOf, [pItem.key]);
    assert.deepStrictEqual(pItem.duplicateOf, [gItem.key]);
  });

  it('4. filters correctly with --flags <flag,...>', async () => {
    const claudeSkillsDir = path.join(tempHome, '.claude', 'skills');
    fs.mkdirSync(claudeSkillsDir, { recursive: true });

    // 1. Copy
    const copyDir = path.join(claudeSkillsDir, 'copy-one');
    fs.mkdirSync(copyDir, { recursive: true });
    fs.writeFileSync(path.join(copyDir, 'SKILL.md'), '# Copy 1');

    // 2. Link
    const targetDir = path.join(sourceDir, 'target-one');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'SKILL.md'), '# Target 1');
    const linkDir = path.join(claudeSkillsDir, 'link-one');
    fs.symlinkSync(targetDir, linkDir);

    // 3. Broken link
    const brokenLinkDir = path.join(claudeSkillsDir, 'broken-one');
    fs.symlinkSync(path.join(sourceDir, 'nonexistent'), brokenLinkDir);

    const opts = { home: tempHome, workspace: tempWorkspace };

    // Filter --flags copy
    const copyOnly = await runInstalled({ ...opts, flags: 'copy' });
    assert.strictEqual(copyOnly.length, 1);
    assert.strictEqual(copyOnly[0].name, 'copy-one');

    // Filter --flags link (should match both valid and broken links)
    const linkOnly = await runInstalled({ ...opts, flags: 'link' });
    const linkNames = linkOnly.map((i) => i.name).sort();
    assert.deepStrictEqual(linkNames, ['broken-one', 'link-one']);

    // Filter --flags broken-link
    const brokenOnly = await runInstalled({ ...opts, flags: 'broken-link' });
    assert.strictEqual(brokenOnly.length, 1);
    assert.strictEqual(brokenOnly[0].name, 'broken-one');

    // Filter --flags copy,broken-link
    const copyAndBroken = await runInstalled({ ...opts, flags: 'copy,broken-link' });
    const cbNames = copyAndBroken.map((i) => i.name).sort();
    assert.deepStrictEqual(cbNames, ['broken-one', 'copy-one']);

    // Invalid flag throws INVALID_ARGUMENT
    await assert.rejects(
      async () => runInstalled({ ...opts, flags: 'invalid-flag' }),
      (err: any) => err.code === 'INVALID_ARGUMENT' && err.message.includes('invalid-flag')
    );
  });

  it('5. CLI execution via child process: JSON stdout and read-only guarantee', async () => {
    // Build dist/cli.js if needed or run directly
    const claudeSkillsDir = path.join(tempHome, '.claude', 'skills');
    fs.mkdirSync(claudeSkillsDir, { recursive: true });

    const copyDir = path.join(claudeSkillsDir, 'cli-copy');
    fs.mkdirSync(copyDir, { recursive: true });
    fs.writeFileSync(path.join(copyDir, 'SKILL.md'), '# CLI Copy');

    const homeSnapshotBefore = snapshotDirectory(tempHome);
    const wsSnapshotBefore = snapshotDirectory(tempWorkspace);

    // Run CLI installed command
    const { stdout } = await execFileAsync(process.execPath, [
      cliPath,
      'installed',
      '--home',
      tempHome,
      '--workspace',
      tempWorkspace,
      '--flags',
      'copy',
    ]);

    const parsed = JSON.parse(stdout);
    assert.ok(Array.isArray(parsed), 'CLI output should be an array');
    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].name, 'cli-copy');
    assert.deepStrictEqual(parsed[0].flags, ['copy']);

    // Check read-only: snapshots must match
    const homeSnapshotAfter = snapshotDirectory(tempHome);
    const wsSnapshotAfter = snapshotDirectory(tempWorkspace);
    assertSnapshotsEqual(homeSnapshotBefore, homeSnapshotAfter);
    assertSnapshotsEqual(wsSnapshotBefore, wsSnapshotAfter);
  });

  it('6. Place in buildInstalledTree carries flags, linkTarget, and duplicateOf', () => {
    const inst: ManagedInstallation = {
      assistant: 'claude-code',
      scope: 'global',
      kind: 'skill',
      name: 'tree-flagged-skill',
      path: '/path/to/skill',
      sourceId: 'src-flag',
      artifactId: 'art-flag',
      installedAt: new Date().toISOString(),
      flags: ['link'],
      linkTarget: '/resolved/target',
      duplicateOf: ['claude-code:project:skill:tree-flagged-skill'],
    };

    const tree = buildInstalledTree([inst], []);
    assert.strictEqual(tree.length, 1);
    const place = tree[0].places[0];
    assert.deepStrictEqual(place.flags, ['link']);
    assert.strictEqual(place.linkTarget, '/resolved/target');
    assert.deepStrictEqual(place.duplicateOf, ['claude-code:project:skill:tree-flagged-skill']);
  });
});
