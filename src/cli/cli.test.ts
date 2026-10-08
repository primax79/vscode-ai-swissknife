import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeManifest, writeState, SCHEMA_VERSION } from '../domain/registry';
import { readSkill, canonicalSkillHash } from '../adapters/codec';
import {
  runSources,
  runCatalog,
  runInstalled,
  runUpdates,
  runItem,
  runPlanInstall,
} from './commands';

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

function assertSnapshotsEqual(before: Map<string, string>, after: Map<string, string>) {
  assert.strictEqual(
    after.size,
    before.size,
    `File count changed: before had ${before.size}, after has ${after.size}`
  );
  for (const [file, hash] of before.entries()) {
    assert.strictEqual(
      after.get(file),
      hash,
      `File ${file} changed or missing after read-only command`
    );
  }
}

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const res = await execFileAsync(process.execPath, [cliPath, ...args]);
    return { stdout: res.stdout, stderr: res.stderr, code: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      code: typeof err.code === 'number' ? err.code : 1,
    };
  }
}

describe('CLI read-only commands & skeleton (Task 46.1)', () => {
  let tempHome: string;
  let tempWorkspace: string;
  let localSourceDir: string;

  beforeEach(async () => {
    tempHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cli-test-home-'));
    tempWorkspace = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cli-test-ws-'));
    localSourceDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cli-test-src-'));

    // Create a local-folder source fixture with a skill
    const skillDir = path.join(localSourceDir, 'test-skill');
    await fs.promises.mkdir(skillDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: test-skill\ndescription: Test skill fixture\n---\n# Test Skill Content\n',
      'utf-8'
    );

    // Register the local-folder source in global manifest
    await writeManifest(
      'global',
      {
        schemaVersion: SCHEMA_VERSION,
        sources: [
          {
            id: 'local-test-source',
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

    // Register a managed installation in global state
    const installedSkillDir = path.join(tempHome, '.claude', 'skills', 'test-skill');
    await fs.promises.mkdir(installedSkillDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(installedSkillDir, 'SKILL.md'),
      '---\nname: test-skill\ndescription: Test skill fixture\n---\n# Test Skill Content\n',
      'utf-8'
    );

    // Compute skill hash
    const skillObj = await readSkill(installedSkillDir);
    const contentHash = canonicalSkillHash(skillObj);

    await writeState(
      'global',
      {
        schemaVersion: SCHEMA_VERSION,
        installations: [
          {
            assistant: 'claude-code',
            scope: 'global',
            kind: 'skill',
            name: 'test-skill',
            path: installedSkillDir,
            sourceId: 'local-test-source',
            packageId: 'local-test-source:test-skill',
            artifactId: 'local-test-source:test-skill:test-skill',
            installedAt: new Date().toISOString(),
            contentHash,
          },
        ],
      },
      undefined,
      tempHome
    );

    // Create an observed unmanaged skill in Kilo home
    const kiloObservedDir = path.join(tempHome, '.kilo', 'skills', 'observed-skill');
    await fs.promises.mkdir(kiloObservedDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(kiloObservedDir, 'SKILL.md'),
      '---\nname: observed-skill\ndescription: Observed\n---\n# Observed\n',
      'utf-8'
    );
  });

  afterEach(async () => {
    for (const p of [tempHome, tempWorkspace, localSourceDir]) {
      if (fs.existsSync(p)) {
        await fs.promises.rm(p, { recursive: true, force: true });
      }
    }
  });

  it('build verification: dist/cli.js contains no require("vscode") or from "vscode"', () => {
    assert.ok(fs.existsSync(cliPath), `CLI bundle exists at ${cliPath}`);
    const content = fs.readFileSync(cliPath, 'utf-8');
    assert.strictEqual(
      content.includes("require('vscode')"),
      false,
      'dist/cli.js must not contain require(\'vscode\')'
    );
    assert.strictEqual(
      content.includes('require("vscode")'),
      false,
      'dist/cli.js must not contain require("vscode")'
    );
    assert.strictEqual(
      content.includes("from 'vscode'"),
      false,
      'dist/cli.js must not contain from \'vscode\''
    );
    assert.strictEqual(
      content.includes('from "vscode"'),
      false,
      'dist/cli.js must not contain from "vscode"'
    );
    assert.strictEqual(
      /require\s*\(\s*['"]vscode['"]\s*\)/.test(content),
      false,
      'dist/cli.js must not match require("vscode") regex'
    );
    assert.strictEqual(
      /from\s+['"]vscode['"]/.test(content),
      false,
      'dist/cli.js must not match from "vscode" regex'
    );
  });

  it('command "sources": lists global and workspace sources with expected JSON shape', async () => {
    const beforeHome = snapshotDirectory(tempHome);
    const beforeWs = snapshotDirectory(tempWorkspace);

    const res = await runCli([
      '--home',
      tempHome,
      '--workspace',
      tempWorkspace,
      'sources',
    ]);

    assert.strictEqual(res.code, 0, `Command failed: ${res.stderr}`);
    const parsed = JSON.parse(res.stdout);
    assert.ok(Array.isArray(parsed));
    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].id, 'local-test-source');
    assert.strictEqual(parsed[0].type, 'local-folder');
    assert.strictEqual(parsed[0].scope, 'global');
    assert.strictEqual(parsed[0].localPath, localSourceDir);

    // Read-only guarantee: assert byte-identical snapshots
    assertSnapshotsEqual(beforeHome, snapshotDirectory(tempHome));
    assertSnapshotsEqual(beforeWs, snapshotDirectory(tempWorkspace));
  });

  it('command "catalog": resolves sources and lists artifacts with diagnostics array', async () => {
    const beforeHome = snapshotDirectory(tempHome);
    const beforeWs = snapshotDirectory(tempWorkspace);

    const res = await runCli([
      '--home',
      tempHome,
      '--workspace',
      tempWorkspace,
      'catalog',
    ]);

    assert.strictEqual(res.code, 0, `Command failed: ${res.stderr}`);
    const parsed = JSON.parse(res.stdout);
    assert.ok(parsed.artifacts);
    assert.ok(parsed.diagnostics);
    assert.ok(Array.isArray(parsed.artifacts));
    assert.ok(Array.isArray(parsed.diagnostics));
    assert.strictEqual(parsed.diagnostics.length, 0);

    const art = parsed.artifacts.find((a: any) => a.name === 'test-skill');
    assert.ok(art, 'test-skill artifact found in catalog');
    assert.strictEqual(art.sourceId, 'local-test-source');
    assert.strictEqual(art.kind, 'skill');
    assert.strictEqual(art.name, 'test-skill');

    // Filter by kind
    const resFiltered = await runCli([
      '--home',
      tempHome,
      '--workspace',
      tempWorkspace,
      'catalog',
      '--kind',
      'agent',
    ]);
    const parsedFiltered = JSON.parse(resFiltered.stdout);
    assert.strictEqual(parsedFiltered.artifacts.length, 0);

    // Read-only guarantee
    assertSnapshotsEqual(beforeHome, snapshotDirectory(tempHome));
    assertSnapshotsEqual(beforeWs, snapshotDirectory(tempWorkspace));
  });

  it('command "catalog": includes per-source resolution failure in diagnostics without global failure', async () => {
    // Add a failing source to manifest
    const manifest = {
      schemaVersion: SCHEMA_VERSION,
      sources: [
        {
          id: 'local-test-source',
          type: 'local-folder' as const,
          scope: 'global' as const,
          localPath: localSourceDir,
        },
        {
          id: 'broken-git-source',
          type: 'git-custom' as const,
          scope: 'global' as const,
          url: 'https://invalid-host-definitely-does-not-exist.example.org/fake.git',
        },
      ],
      desiredInstallations: [],
    };
    await writeManifest('global', manifest, undefined, tempHome);

    const res = await runCli([
      '--home',
      tempHome,
      '--workspace',
      tempWorkspace,
      'catalog',
    ]);

    assert.strictEqual(res.code, 0, 'Catalog exits 0 even when one source fails');
    const parsed = JSON.parse(res.stdout);
    assert.strictEqual(parsed.artifacts.length, 1);
    assert.strictEqual(parsed.diagnostics.length, 1);
    assert.strictEqual(parsed.diagnostics[0].sourceId, 'broken-git-source');
    assert.ok(parsed.diagnostics[0].message);
  });

  it('command "installed": lists managed and observed items with scope/assistant filters', async () => {
    const beforeHome = snapshotDirectory(tempHome);
    const beforeWs = snapshotDirectory(tempWorkspace);

    const res = await runCli([
      '--home',
      tempHome,
      '--workspace',
      tempWorkspace,
      'installed',
    ]);

    assert.strictEqual(res.code, 0, `Command failed: ${res.stderr}`);
    const parsed = JSON.parse(res.stdout);
    assert.ok(Array.isArray(parsed));
    assert.ok(parsed.length >= 2);

    const managedItem = parsed.find(
      (i: any) => i.key === 'claude-code:global:skill:test-skill'
    );
    assert.ok(managedItem);
    assert.strictEqual(managedItem.membership, 'managed');
    assert.strictEqual(managedItem.assistant, 'claude-code');
    assert.strictEqual(managedItem.sourceId, 'local-test-source');

    const observedItem = parsed.find(
      (i: any) => i.key === 'kilo-code:global:skill:observed-skill'
    );
    assert.ok(observedItem);
    assert.strictEqual(observedItem.membership, 'observed');
    assert.strictEqual(observedItem.assistant, 'kilo-code');

    // Filter by assistant
    const resClaude = await runCli([
      '--home',
      tempHome,
      '--workspace',
      tempWorkspace,
      'installed',
      '--assistant',
      'claude-code',
    ]);
    const parsedClaude = JSON.parse(resClaude.stdout);
    assert.strictEqual(
      parsedClaude.every((i: any) => i.assistant === 'claude-code'),
      true
    );

    // Read-only guarantee
    assertSnapshotsEqual(beforeHome, snapshotDirectory(tempHome));
    assertSnapshotsEqual(beforeWs, snapshotDirectory(tempWorkspace));
  });

  it('command "updates": checks drift and reports status per managed item', async () => {
    const beforeHome = snapshotDirectory(tempHome);
    const beforeWs = snapshotDirectory(tempWorkspace);

    const res = await runCli([
      '--home',
      tempHome,
      '--workspace',
      tempWorkspace,
      'updates',
    ]);

    assert.strictEqual(res.code, 0, `Command failed: ${res.stderr}`);
    const parsed = JSON.parse(res.stdout);
    assert.ok(Array.isArray(parsed));
    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].key, 'claude-code:global:skill:test-skill');
    assert.strictEqual(parsed[0].status, 'up-to-date');

    // Read-only guarantee
    assertSnapshotsEqual(beforeHome, snapshotDirectory(tempHome));
    assertSnapshotsEqual(beforeWs, snapshotDirectory(tempWorkspace));
  });

  it('command "item": details origin, installed-in places, and diff availability', async () => {
    const beforeHome = snapshotDirectory(tempHome);
    const beforeWs = snapshotDirectory(tempWorkspace);

    const key = 'claude-code:global:skill:test-skill';
    const res = await runCli([
      '--home',
      tempHome,
      '--workspace',
      tempWorkspace,
      'item',
      key,
    ]);

    assert.strictEqual(res.code, 0, `Command failed: ${res.stderr}`);
    const parsed = JSON.parse(res.stdout);
    assert.strictEqual(parsed.key, key);
    assert.strictEqual(parsed.membership, 'managed');
    assert.strictEqual(parsed.kind, 'skill');
    assert.strictEqual(parsed.name, 'test-skill');
    assert.strictEqual(parsed.diffAvailable, false);
    assert.strictEqual(parsed.diff, undefined);

    // Read-only guarantee for initial inspect
    assertSnapshotsEqual(beforeHome, snapshotDirectory(tempHome));
    assertSnapshotsEqual(beforeWs, snapshotDirectory(tempWorkspace));

    // Now introduce a local modification and test --diff
    const installedSkillFile = path.join(
      tempHome,
      '.claude',
      'skills',
      'test-skill',
      'SKILL.md'
    );
    await fs.promises.writeFile(
      installedSkillFile,
      '---\nname: test-skill\ndescription: Modified locally\n---\n# Modified\n',
      'utf-8'
    );

    const resDiff = await runCli([
      '--home',
      tempHome,
      '--workspace',
      tempWorkspace,
      'item',
      key,
      '--diff',
    ]);

    assert.strictEqual(resDiff.code, 0);
    const parsedDiff = JSON.parse(resDiff.stdout);
    assert.strictEqual(parsedDiff.diffAvailable, true);
    assert.ok(parsedDiff.diff);
    assert.ok(parsedDiff.diff.includes('--- upstream'));
    assert.ok(parsedDiff.diff.includes('+++ local'));

    // Assert temp trees didn't change during the read command
    const afterHome = snapshotDirectory(tempHome);
    const resAgain = await runCli([
      '--home',
      tempHome,
      '--workspace',
      tempWorkspace,
      'item',
      key,
      '--diff',
    ]);
    assert.strictEqual(resAgain.code, 0);
    assertSnapshotsEqual(afterHome, snapshotDirectory(tempHome));
  });

  it('command "plan-install": returns planInstallMatrix summary and never writes', async () => {
    const beforeHome = snapshotDirectory(tempHome);
    const beforeWs = snapshotDirectory(tempWorkspace);

    const res = await runCli([
      '--home',
      tempHome,
      '--workspace',
      tempWorkspace,
      'plan-install',
      '--source',
      'local-test-source',
      '--artifact',
      'test-skill',
      '--assistants',
      'kilo-code,github-copilot',
      '--scopes',
      'global,project',
    ]);

    assert.strictEqual(res.code, 0, `Command failed: ${res.stderr}`);
    const parsed = JSON.parse(res.stdout);
    assert.ok(parsed.counts);
    assert.strictEqual(parsed.counts.total, 4); // 2 assistants x 2 scopes
    assert.ok(parsed.new);
    assert.ok(parsed.conflict);
    assert.ok(parsed.unsupported);

    // Assert that plan-install NEVER writes anything
    assertSnapshotsEqual(beforeHome, snapshotDirectory(tempHome));
    assertSnapshotsEqual(beforeWs, snapshotDirectory(tempWorkspace));
  });

  it('error paths: non-zero exit code and structured JSON error on stdout', async () => {
    // 1. Unknown / non-existent source in catalog
    const resNotFound = await runCli([
      '--home',
      tempHome,
      'catalog',
      '--source',
      'non-existent-source',
    ]);
    assert.notStrictEqual(resNotFound.code, 0);
    const errJson1 = JSON.parse(resNotFound.stdout);
    assert.strictEqual(errJson1.error.code, 'NOT_FOUND');
    assert.ok(errJson1.error.message.includes('non-existent-source'));

    // 2. Invalid kind argument
    const resInvalidKind = await runCli([
      '--home',
      tempHome,
      'catalog',
      '--kind',
      'not-a-valid-kind',
    ]);
    assert.notStrictEqual(resInvalidKind.code, 0);
    const errJson2 = JSON.parse(resInvalidKind.stdout);
    assert.strictEqual(errJson2.error.code, 'INVALID_ARGUMENT');

    // 3. Item not found
    const resItemNotFound = await runCli([
      '--home',
      tempHome,
      'item',
      'claude-code:global:skill:phantom-item',
    ]);
    assert.notStrictEqual(resItemNotFound.code, 0);
    const errJson3 = JSON.parse(resItemNotFound.stdout);
    assert.strictEqual(errJson3.error.code, 'NOT_FOUND');

    // 4. Missing required options in plan-install
    const resMissingPlan = await runCli([
      '--home',
      tempHome,
      'plan-install',
      '--source',
      'local-test-source',
    ]);
    assert.notStrictEqual(resMissingPlan.code, 0);
    const errJson4 = JSON.parse(resMissingPlan.stdout);
    assert.strictEqual(errJson4.error.code, 'INVALID_ARGUMENT');
  });

  it('direct function calls: runSources, runCatalog, runInstalled, runUpdates, runItem, runPlanInstall', async () => {
    const globalOpts = { home: tempHome, workspace: tempWorkspace };

    // runSources
    const sources = await runSources(globalOpts);
    assert.strictEqual(sources.length, 1);
    assert.strictEqual(sources[0].id, 'local-test-source');

    // runCatalog
    const catalog = await runCatalog(globalOpts);
    assert.strictEqual(catalog.artifacts.length, 1);
    assert.strictEqual(catalog.diagnostics.length, 0);

    // runInstalled
    const installed = await runInstalled(globalOpts);
    assert.ok(installed.length >= 2);

    // runUpdates
    const updates = await runUpdates(globalOpts);
    assert.strictEqual(updates.length, 1);

    // runItem
    const item = await runItem('claude-code:global:skill:test-skill', globalOpts);
    assert.strictEqual(item.name, 'test-skill');

    // runPlanInstall
    const plan = await runPlanInstall({
      ...globalOpts,
      source: 'local-test-source',
      artifact: 'test-skill',
      assistants: 'claude-code',
      scopes: 'global',
    });
    assert.ok(plan.counts);
  });
});
