import test from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ManagedInstallation } from '../domain/types';
import {
  type DesiredInstallation,
  type ManifestFile,
  type StateFile,
  SCHEMA_VERSION,
  writeManifest,
  writeState,
} from '../domain/registry';
import {
  countUnsatisfiedRecommendations,
  computePendingCounts,
  formatStatusBarLabel,
  formatStatusBarTooltip,
  type PendingCounts,
} from './pendingCounts';

test('countUnsatisfiedRecommendations - empty desired -> 0', () => {
  const result = countUnsatisfiedRecommendations([], []);
  assert.equal(result, 0);
});

test('countUnsatisfiedRecommendations - all satisfied -> 0', () => {
  const desired: DesiredInstallation[] = [
    { sourceId: 's1', artifactId: 'a1', assistant: 'claude-code', scope: 'project' },
    { sourceId: 's2', artifactId: 'a2', assistant: 'kilo-code', scope: 'project' },
  ];
  const installed: ManagedInstallation[] = [
    {
      sourceId: 's1',
      artifactId: 'a1',
      assistant: 'claude-code',
      scope: 'project',
      kind: 'skill',
      name: 'skill1',
      path: '/path/1',
      installedAt: 'now',
    },
    {
      sourceId: 's2',
      artifactId: 'a2',
      assistant: 'kilo-code',
      scope: 'project',
      kind: 'skill',
      name: 'skill2',
      path: '/path/2',
      installedAt: 'now',
    },
  ];

  assert.equal(countUnsatisfiedRecommendations(desired, installed), 0);
});

test('countUnsatisfiedRecommendations - partially satisfied -> correct count', () => {
  const desired: DesiredInstallation[] = [
    { sourceId: 's1', artifactId: 'a1', assistant: 'claude-code', scope: 'project' },
    { sourceId: 's1', artifactId: 'a2', assistant: 'claude-code', scope: 'project' },
    { sourceId: 's2', artifactId: 'a1', assistant: 'kilo-code', scope: 'project' },
  ];
  const installed: ManagedInstallation[] = [
    {
      sourceId: 's1',
      artifactId: 'a1',
      assistant: 'claude-code',
      scope: 'project',
      kind: 'skill',
      name: 'skill1',
      path: '/path/1',
      installedAt: 'now',
    },
    // a2 not installed, kilo-code a1 not installed (different assistant/source)
  ];

  assert.equal(countUnsatisfiedRecommendations(desired, installed), 2);
});

test('formatStatusBarLabel - zero counts -> fallback label', () => {
  const counts: PendingCounts = { unsatisfiedRecommendations: 0, updatesAvailable: 0, total: 0 };
  assert.equal(formatStatusBarLabel(counts), '$(dashboard) AI Swissknife');
});

test('formatStatusBarLabel - single update -> singular', () => {
  const counts: PendingCounts = { unsatisfiedRecommendations: 0, updatesAvailable: 1, total: 1 };
  assert.equal(formatStatusBarLabel(counts), '$(dashboard) AI Swissknife: 1 update');
});

test('formatStatusBarLabel - multiple updates -> plural', () => {
  const counts: PendingCounts = { unsatisfiedRecommendations: 0, updatesAvailable: 3, total: 3 };
  assert.equal(formatStatusBarLabel(counts), '$(dashboard) AI Swissknife: 3 updates');
});

test('formatStatusBarLabel - single recommendation -> singular', () => {
  const counts: PendingCounts = { unsatisfiedRecommendations: 1, updatesAvailable: 0, total: 1 };
  assert.equal(formatStatusBarLabel(counts), '$(dashboard) AI Swissknife: 1 recommendation');
});

test('formatStatusBarLabel - multiple recommendations -> plural', () => {
  const counts: PendingCounts = { unsatisfiedRecommendations: 2, updatesAvailable: 0, total: 2 };
  assert.equal(formatStatusBarLabel(counts), '$(dashboard) AI Swissknife: 2 recommendations');
});

test('formatStatusBarLabel - both updates and recommendations present', () => {
  const counts: PendingCounts = { unsatisfiedRecommendations: 2, updatesAvailable: 1, total: 3 };
  assert.equal(formatStatusBarLabel(counts), '$(dashboard) AI Swissknife: 1 update, 2 recommendations');
});

test('formatStatusBarTooltip - zero counts -> simple tooltip', () => {
  const counts: PendingCounts = { unsatisfiedRecommendations: 0, updatesAvailable: 0, total: 0 };
  assert.equal(formatStatusBarTooltip(counts), 'AI Swissknife: Open Dashboard');
});

test('formatStatusBarTooltip - nonzero counts -> includes details', () => {
  const counts: PendingCounts = { unsatisfiedRecommendations: 2, updatesAvailable: 1, total: 3 };
  const tooltip = formatStatusBarTooltip(counts);
  assert.ok(tooltip.includes('1 update(s) available'));
  assert.ok(tooltip.includes('2 unsatisfied recommendation(s)'));
  assert.ok(tooltip.includes('Click to open Dashboard'));
});

test('computePendingCounts - integration with on-disk state and manifest', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-counts-test-'));
  const projectRoot = path.join(tempDir, 'project');
  const homeRoot = path.join(tempDir, 'home');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(homeRoot, { recursive: true });

  try {
    // 1. Initially empty
    const countsEmpty = await computePendingCounts(projectRoot, homeRoot);
    assert.deepEqual(countsEmpty, {
      unsatisfiedRecommendations: 0,
      updatesAvailable: 0,
      total: 0,
    });

    // 2. Add unsatisfied desired installation
    const manifest: ManifestFile = {
      schemaVersion: SCHEMA_VERSION,
      sources: [],
      desiredInstallations: [
        { sourceId: 'src1', artifactId: 'art1', assistant: 'claude-code', scope: 'project' },
        { sourceId: 'src1', artifactId: 'art2', assistant: 'claude-code', scope: 'project' },
      ],
    };
    await writeManifest('project', manifest, projectRoot);

    const countsWithRecs = await computePendingCounts(projectRoot, homeRoot);
    assert.equal(countsWithRecs.unsatisfiedRecommendations, 2);
    assert.equal(countsWithRecs.updatesAvailable, 0);
    assert.equal(countsWithRecs.total, 2);

    // 3. Satisfy one of the recommendations
    const state: StateFile = {
      schemaVersion: SCHEMA_VERSION,
      installations: [
        {
          sourceId: 'src1',
          artifactId: 'art1',
          assistant: 'claude-code',
          scope: 'project',
          kind: 'skill',
          name: 'art1',
          path: '/path/art1',
          installedAt: 'now',
        },
      ],
    };
    await writeState('project', state, projectRoot);

    const countsPartiallySatisfied = await computePendingCounts(projectRoot, homeRoot);
    assert.equal(countsPartiallySatisfied.unsatisfiedRecommendations, 1);
    assert.equal(countsPartiallySatisfied.total, 1);

    // 4. Test with undefined projectRoot
    const countsNoProject = await computePendingCounts(undefined, homeRoot);
    assert.equal(countsNoProject.unsatisfiedRecommendations, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
