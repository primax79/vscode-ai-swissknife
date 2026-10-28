import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  explainInstallation,
  formatExplainCliLine,
  formatExplainCliJson,
  formatExplainTooltip,
  formatExplainDetailHtml,
  shortHash,
  shortCommit,
} from './explain';
import type { ManagedInstallation, Source } from '../domain/types';
import type { DriftReport } from './types';
import { runUpdates } from '../cli/commands';
import { createProgram } from '../cli/main';
import { writeManifest, writeState, toDesiredSource, SCHEMA_VERSION } from '../domain/registry';

describe('Task 49.7 — Explain update state (formatter unit tests)', () => {
  const baseInst: ManagedInstallation = {
    assistant: 'claude-code',
    scope: 'global',
    kind: 'skill',
    name: 'test-skill',
    path: '/test/home/.claude/skills/test-skill',
    source: {
      id: 'ai-orchestration',
      scope: 'global',
      type: 'git-marketplace',
      location: 'https://github.com/org/marketplace.git',
    },
    sourceRevision: {
      commit: 'abc1234567890123456789012345678901234567',
    },
    contentHash: '1111111222222233333334444444555555566666667777777888888899999990',
    sourceContentHash: '1111111222222233333334444444555555566666667777777888888899999990',
    installedAt: '2026-10-27T10:00:00.000Z',
  };

  it('1. state "up-to-date": same commit -> source commit unchanged', () => {
    const report: DriftReport = {
      installation: baseInst,
      status: 'up-to-date',
      installedCommit: 'abc1234567890123456789012345678901234567',
      currentCommit: 'abc1234567890123456789012345678901234567',
      diskHash: baseInst.contentHash,
      sourceHash: baseInst.contentHash,
    };
    const explained = explainInstallation(baseInst, report);
    assert.strictEqual(explained.status, 'up-to-date');
    assert.strictEqual(explained.sourceIdentity, 'global:ai-orchestration');
    assert.strictEqual(explained.reason, 'source commit unchanged');
    assert.strictEqual(shortCommit(explained.installedCommit), 'abc1234');
    assert.strictEqual(shortCommit(explained.currentCommit), 'abc1234');
    assert.strictEqual(shortHash(explained.installedContentHash), '1111111');
    assert.strictEqual(shortHash(explained.sourceContentHash), '1111111');
    assert.strictEqual(shortHash(explained.diskHash), '1111111');
  });

  it('1b. state "up-to-date": source moved but content unchanged', () => {
    const report: DriftReport = {
      installation: baseInst,
      status: 'up-to-date',
      installedCommit: 'abc1234567890123456789012345678901234567',
      currentCommit: 'def5678901234567890123456789012345678901',
      diskHash: baseInst.contentHash,
      sourceHash: baseInst.contentHash,
    };
    const explained = explainInstallation(baseInst, report);
    assert.strictEqual(explained.status, 'up-to-date');
    assert.strictEqual(
      explained.reason,
      'source moved from abc1234 to def5678 but content is unchanged'
    );
  });

  it('2. state "update-available": source commit moved and content changed', () => {
    const report: DriftReport = {
      installation: baseInst,
      status: 'update-available',
      installedCommit: 'abc1234567890123456789012345678901234567',
      currentCommit: 'def5678901234567890123456789012345678901',
      diskHash: baseInst.contentHash,
      sourceHash: '9999999888888877777776666666555555544444443333333222222211111110',
    };
    const explained = explainInstallation(baseInst, report);
    assert.strictEqual(explained.status, 'update-available');
    assert.strictEqual(
      explained.reason,
      'source moved from abc1234 to def5678 and the content changed'
    );
  });

  it('2b. state "update-available": dirty working tree in local folder', () => {
    const report: DriftReport = {
      installation: baseInst,
      status: 'update-available',
      dirty: true,
      diskHash: baseInst.contentHash,
      sourceHash: '9999999888888877777776666666555555544444443333333222222211111110',
    };
    const explained = explainInstallation(baseInst, report);
    assert.strictEqual(explained.status, 'update-available');
    assert.strictEqual(
      explained.reason,
      'newer version available in source (dirty working tree)'
    );
  });

  it('3. state "modified-locally": edited on disk after install', () => {
    const report: DriftReport = {
      installation: baseInst,
      status: 'modified-locally',
      diskHash: '3333333444444455555556666666777777788888889999999000000011111112',
    };
    const explained = explainInstallation(baseInst, report);
    assert.strictEqual(explained.status, 'modified-locally');
    assert.strictEqual(explained.reason, 'edited on disk after install');
  });

  it('3b. state "modified-locally": with local.patch applied', () => {
    const report: DriftReport = {
      installation: baseInst,
      status: 'modified-locally',
      hasLocalPatch: true,
      diskHash: '3333333444444455555556666666777777788888889999999000000011111112',
    };
    const explained = explainInstallation(baseInst, report);
    assert.strictEqual(explained.status, 'modified-locally');
    assert.strictEqual(
      explained.reason,
      'edited on disk after install (local.patch applied)'
    );
  });

  it('4. state "modified-and-update-available": disk modified and upstream commit moved', () => {
    const report: DriftReport = {
      installation: baseInst,
      status: 'modified-and-update-available',
      installedCommit: 'abc1234567890123456789012345678901234567',
      currentCommit: 'def5678901234567890123456789012345678901',
      diskHash: '3333333444444455555556666666777777788888889999999000000011111112',
      sourceHash: '9999999888888877777776666666555555544444443333333222222211111110',
    };
    const explained = explainInstallation(baseInst, report);
    assert.strictEqual(explained.status, 'modified-and-update-available');
    assert.strictEqual(
      explained.reason,
      'edited on disk after install; source moved from abc1234 to def5678 and the content changed'
    );
  });

  it('5. state "missing-on-disk": directory or file removed', () => {
    const report: DriftReport = {
      installation: baseInst,
      status: 'missing-on-disk',
      details: 'Skill directory not found at /test/home/.claude/skills/test-skill',
    };
    const explained = explainInstallation(baseInst, report);
    assert.strictEqual(explained.status, 'missing-on-disk');
    assert.strictEqual(
      explained.reason,
      'Skill directory not found at /test/home/.claude/skills/test-skill'
    );
  });

  it('6. state "source-unavailable": source removed or artifact not in source', () => {
    const report: DriftReport = {
      installation: baseInst,
      status: 'source-unavailable',
      reason: 'artifact test-skill no longer in source',
    };
    const explained = explainInstallation(baseInst, report);
    assert.strictEqual(explained.status, 'source-unavailable');
    assert.strictEqual(
      explained.reason,
      'source unavailable: artifact test-skill no longer in source'
    );
  });

  it('7. state "provenance-unknown": artifact-not-in-source reason', () => {
    const unknownInst: ManagedInstallation = {
      ...baseInst,
      source: undefined,
      provenance: 'unknown',
      provenanceReason: 'artifact-not-in-source',
    };
    const report: DriftReport = {
      installation: unknownInst,
      status: 'provenance-unknown',
    };
    const explained = explainInstallation(unknownInst, report);
    assert.strictEqual(explained.status, 'provenance-unknown');
    assert.strictEqual(
      explained.reason,
      'provenance unknown: artifact-not-in-source'
    );
  });

  it('8. state "rebaselined": hash rebaselined after codec change', () => {
    const rebaselinedInst: ManagedInstallation = {
      ...baseInst,
      rebaselined: 'codec',
    };
    const report: DriftReport = {
      installation: rebaselinedInst,
      status: 'up-to-date',
      rebaselined: 'codec',
    };
    const explained = explainInstallation(rebaselinedInst, report);
    assert.strictEqual(explained.status, 'rebaselined');
    assert.strictEqual(
      explained.reason,
      'hash rebaselined after codec change'
    );
  });

  it('formatExplainCliLine outputs one clean line with short hashes (7 chars)', () => {
    const report: DriftReport = {
      installation: baseInst,
      status: 'update-available',
      installedCommit: 'abc1234567890123456789012345678901234567',
      currentCommit: 'def5678901234567890123456789012345678901',
      diskHash: baseInst.contentHash,
      sourceHash: '9999999888888877777776666666555555544444443333333222222211111110',
    };
    const explained = explainInstallation(baseInst, report);
    const line = formatExplainCliLine(explained);
    assert.ok(line.includes('claude-code:global:skill:test-skill'));
    assert.ok(line.includes('source:global:ai-orchestration'));
    assert.ok(line.includes('installedCommit:abc1234'));
    assert.ok(line.includes('currentCommit:def5678'));
    assert.ok(line.includes('installedHash:1111111'));
    assert.ok(line.includes('sourceHash:9999999'));
    assert.ok(line.includes('diskHash:1111111'));
    assert.ok(line.includes('status:update-available'));
    assert.ok(
      line.includes(
        'reason:source moved from abc1234 to def5678 and the content changed'
      )
    );
    assert.strictEqual(line.includes('\n'), false, 'Line must be a single line');
  });

  it('formatExplainCliJson outputs full hashes and commits', () => {
    const report: DriftReport = {
      installation: baseInst,
      status: 'update-available',
      installedCommit: 'abc1234567890123456789012345678901234567',
      currentCommit: 'def5678901234567890123456789012345678901',
      diskHash: baseInst.contentHash,
      sourceHash: '9999999888888877777776666666555555544444443333333222222211111110',
    };
    const explained = explainInstallation(baseInst, report);
    const json = formatExplainCliJson(explained);
    assert.strictEqual(json.key, 'claude-code:global:skill:test-skill');
    assert.strictEqual(json.sourceIdentity, 'global:ai-orchestration');
    assert.strictEqual(
      json.installedCommit,
      'abc1234567890123456789012345678901234567'
    );
    assert.strictEqual(
      json.currentCommit,
      'def5678901234567890123456789012345678901'
    );
    assert.strictEqual(
      json.installedContentHash,
      baseInst.contentHash
    );
    assert.strictEqual(
      json.sourceContentHash,
      '9999999888888877777776666666555555544444443333333222222211111110'
    );
    assert.strictEqual(json.diskHash, baseInst.contentHash);
    assert.strictEqual(json.status, 'update-available');
    assert.strictEqual(
      json.reason,
      'source moved from abc1234 to def5678 and the content changed'
    );
  });

  it('formatExplainTooltip outputs 7-char short hashes and all required fields', () => {
    const report: DriftReport = {
      installation: baseInst,
      status: 'update-available',
      installedCommit: 'abc1234567890123456789012345678901234567',
      currentCommit: 'def5678901234567890123456789012345678901',
      diskHash: baseInst.contentHash,
      sourceHash: '9999999888888877777776666666555555544444443333333222222211111110',
    };
    const explained = explainInstallation(baseInst, report);
    const tooltip = formatExplainTooltip(explained);
    assert.ok(tooltip.includes('Source: global:ai-orchestration'));
    assert.ok(tooltip.includes('Installed commit: abc1234'));
    assert.ok(tooltip.includes('Current commit: def5678'));
    assert.ok(tooltip.includes('Installed hash: 1111111'));
    assert.ok(tooltip.includes('Source hash: 9999999'));
    assert.ok(tooltip.includes('Disk hash: 1111111'));
    assert.ok(tooltip.includes('Status: update-available'));
    assert.ok(
      tooltip.includes(
        'Reason: source moved from abc1234 to def5678 and the content changed'
      )
    );
  });

  it('formatExplainDetailHtml outputs full values for detail panel', () => {
    const report: DriftReport = {
      installation: baseInst,
      status: 'update-available',
      installedCommit: 'abc1234567890123456789012345678901234567',
      currentCommit: 'def5678901234567890123456789012345678901',
      diskHash: baseInst.contentHash,
      sourceHash: '9999999888888877777776666666555555544444443333333222222211111110',
    };
    const explained = explainInstallation(baseInst, report);
    const html = formatExplainDetailHtml(explained);
    assert.ok(html.includes('class="detail-explain"'));
    assert.ok(html.includes('global:ai-orchestration'));
    assert.ok(html.includes('abc1234567890123456789012345678901234567'));
    assert.ok(html.includes('def5678901234567890123456789012345678901'));
    assert.ok(html.includes(baseInst.contentHash!));
    assert.ok(
      html.includes(
        '9999999888888877777776666666555555544444443333333222222211111110'
      )
    );
    assert.ok(
      html.includes(
        'source moved from abc1234 to def5678 and the content changed'
      )
    );
  });
});

describe('Task 49.7 — CLI integration (status/updates --explain and --json)', () => {
  let tmpHome: string;
  let sampleInst: ManagedInstallation;

  it('setup fixture state and manifest', async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-cli-test-'));
    fs.mkdirSync(path.join(tmpHome, '.ai-swissknife'), { recursive: true });
    fs.mkdirSync(path.join(tmpHome, '.claude', 'skills', 'alpha-skill'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmpHome, '.claude', 'skills', 'alpha-skill', 'SKILL.md'),
      '# Alpha Skill\n',
      'utf-8'
    );

    const sourceLocalPath = path.join(tmpHome, 'source-repo');
    fs.mkdirSync(sourceLocalPath, { recursive: true });

    const source: Source = {
      id: 'test-src',
      type: 'local-folder',
      scope: 'global',
      localPath: sourceLocalPath,
    };

    await writeManifest(
      'global',
      {
        schemaVersion: SCHEMA_VERSION,
        sources: [toDesiredSource(source, undefined, tmpHome)],
        desiredInstallations: [],
      },
      undefined,
      tmpHome
    );

    sampleInst = {
      assistant: 'claude-code',
      scope: 'global',
      kind: 'skill',
      name: 'alpha-skill',
      path: path.join(tmpHome, '.claude', 'skills', 'alpha-skill'),
      sourceId: 'test-src',
      source: {
        id: 'test-src',
        scope: 'global',
        type: 'local-folder',
        location: sourceLocalPath,
      },
      sourceRevision: {
        commit: '1111222233334444555566667777888899990000',
      },
      contentHash: 'hash111122223333444455556666777788889999',
      installedAt: '2026-10-27T10:00:00.000Z',
    };

    await writeState(
      'global',
      {
        schemaVersion: SCHEMA_VERSION,
        installations: [sampleInst],
      },
      undefined,
      tmpHome
    );
  });

  it('status --explain prints text lines with each field', async () => {
    const res = await runUpdates({
      home: tmpHome,
      explain: true,
      json: false,
    });
    assert.strictEqual(typeof res, 'string');
    assert.ok(res.includes('claude-code:global:skill:alpha-skill'));
    assert.ok(res.includes('source:global:test-src'));
    assert.ok(res.includes('installedCommit:1111222'));
    assert.ok(res.includes('status:'));
    assert.ok(res.includes('reason:'));
  });

  it('status --explain --json returns structured JSON array', async () => {
    const res = await runUpdates({
      home: tmpHome,
      explain: true,
      json: true,
    });
    assert.ok(Array.isArray(res));
    const item = res[0] as any;
    assert.strictEqual(item.key, 'claude-code:global:skill:alpha-skill');
    assert.strictEqual(item.sourceIdentity, 'global:test-src');
    assert.strictEqual(
      item.installedCommit,
      '1111222233334444555566667777888899990000'
    );
    assert.ok(item.status);
    assert.ok(item.reason);
  });

  it('status --explain <item> filters to requested item', async () => {
    const res = await runUpdates({
      home: tmpHome,
      explain: true,
      json: false,
      item: 'claude-code:global:skill:alpha-skill',
    });
    assert.strictEqual(typeof res, 'string');
    assert.ok(res.includes('claude-code:global:skill:alpha-skill'));
  });

  it('status --explain <item> with unknown key throws NOT_FOUND', async () => {
    await assert.rejects(
      async () => {
        await runUpdates({
          home: tmpHome,
          explain: true,
          item: 'claude-code:global:skill:non-existent',
        });
      },
      (err: any) => err.code === 'NOT_FOUND'
    );
  });

  it('status without --explain returns normal CliUpdateItem[] unchanged', async () => {
    const res = await runUpdates({
      home: tmpHome,
      explain: false,
    });
    assert.ok(Array.isArray(res));
    const item = res[0] as any;
    assert.strictEqual(item.key, 'claude-code:global:skill:alpha-skill');
    assert.strictEqual(item.sourceId, 'test-src');
    assert.strictEqual(item.reason, undefined, 'Without --explain, reason must not be present');
    assert.strictEqual(item.sourceIdentity, undefined, 'Without --explain, sourceIdentity must not be present');
  });

  it('Commander registers status as alias for updates', () => {
    const program = createProgram();
    const updatesCmd = program.commands.find((c) => c.name() === 'updates');
    assert.ok(updatesCmd, 'updates command must exist');
    assert.ok(updatesCmd.aliases().includes('status'), 'updates must have status alias');
  });
});
