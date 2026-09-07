import test from 'node:test';
import * as assert from 'node:assert/strict';
import type { Artifact, ManagedInstallation, Package, Source } from '../domain/types';
import type { DesiredInstallation } from '../domain/registry';
import { resolveRecommendations, type SourceResolutionAttempt } from './recommendations';

test('resolveRecommendations - empty input -> all empty', () => {
  const result = resolveRecommendations([], [], [], new Map());
  assert.deepEqual(result.satisfied, []);
  assert.deepEqual(result.pending, []);
  assert.deepEqual(result.broken, []);
});

test('resolveRecommendations - installed match -> satisfied', () => {
  const desired: DesiredInstallation = {
    sourceId: 's1',
    artifactId: 'a1',
    assistant: 'claude-code',
    scope: 'project',
  };
  const installed: ManagedInstallation[] = [
    {
      sourceId: 's1',
      artifactId: 'a1',
      assistant: 'claude-code',
      scope: 'project',
      kind: 'skill',
      name: 's',
      path: 'p',
      installedAt: 'now',
    },
  ];

  const result = resolveRecommendations([desired], installed, [], new Map());
  assert.equal(result.satisfied.length, 1);
  assert.deepEqual(result.satisfied[0], desired);
  assert.equal(result.pending.length, 0);
  assert.equal(result.broken.length, 0);
});

test("resolveRecommendations - resolvable non-installed entry with a 'resolved' attempt containing its artifact -> pending", () => {
  const desired: DesiredInstallation = {
    sourceId: 's1',
    artifactId: 'a1',
    assistant: 'claude-code',
    scope: 'project',
  };
  const source: Source = { id: 's1', type: 'git-custom', scope: 'project' };
  const artifact: Artifact = { id: 'a1', packageId: 'p1', kind: 'skill', name: 's', nativeFormat: 'md' };
  const pkg: Package = { id: 'p1', sourceId: 's1', nativeFormat: 'kilo', artifacts: [artifact] };

  const attempts = new Map<string, SourceResolutionAttempt>([
    ['s1', { status: 'resolved', source, packages: [pkg] }],
  ]);

  const result = resolveRecommendations([desired], [], [source], attempts);
  assert.equal(result.satisfied.length, 0);
  assert.equal(result.pending.length, 1);
  assert.equal(result.broken.length, 0);
  
  const p = result.pending[0];
  assert.deepEqual(p.desired, desired);
  assert.deepEqual(p.artifact, artifact);
  assert.deepEqual(p.pkg, pkg);
  assert.deepEqual(p.source, source);
});

test('resolveRecommendations - sourceId absent from registeredSources -> broken with source-not-registered', () => {
  const desired: DesiredInstallation = {
    sourceId: 's1',
    artifactId: 'a1',
    assistant: 'claude-code',
    scope: 'project',
  };

  const result = resolveRecommendations([desired], [], [], new Map());
  assert.equal(result.broken.length, 1);
  assert.deepEqual(result.broken[0].desired, desired);
  assert.deepEqual(result.broken[0].reason, { kind: 'source-not-registered' });
});

test('resolveRecommendations - registered source with no entry in resolutionAttempts -> appears in none of the three buckets', () => {
  const desired: DesiredInstallation = {
    sourceId: 's1',
    artifactId: 'a1',
    assistant: 'claude-code',
    scope: 'project',
  };
  const source: Source = { id: 's1', type: 'git-custom', scope: 'project' };

  const result = resolveRecommendations([desired], [], [source], new Map());
  assert.equal(result.satisfied.length, 0);
  assert.equal(result.pending.length, 0);
  assert.equal(result.broken.length, 0);
});

test("resolveRecommendations - registered source with a 'failed' attempt -> broken with source-resolution-failed", () => {
  const desired: DesiredInstallation = {
    sourceId: 's1',
    artifactId: 'a1',
    assistant: 'claude-code',
    scope: 'project',
  };
  const source: Source = { id: 's1', type: 'git-custom', scope: 'project' };
  const attempts = new Map<string, SourceResolutionAttempt>([
    ['s1', { status: 'failed', source, error: 'network error' }],
  ]);

  const result = resolveRecommendations([desired], [], [source], attempts);
  assert.equal(result.broken.length, 1);
  assert.deepEqual(result.broken[0].desired, desired);
  assert.deepEqual(result.broken[0].reason, { kind: 'source-resolution-failed', error: 'network error' });
});

test("resolveRecommendations - 'resolved' attempt whose packages don't contain the artifactId -> broken with artifact-not-found", () => {
  const desired: DesiredInstallation = {
    sourceId: 's1',
    artifactId: 'a1',
    assistant: 'claude-code',
    scope: 'project',
  };
  const source: Source = { id: 's1', type: 'git-custom', scope: 'project' };
  const artifact: Artifact = { id: 'other-a', packageId: 'p1', kind: 'skill', name: 's', nativeFormat: 'md' };
  const pkg: Package = { id: 'p1', sourceId: 's1', nativeFormat: 'kilo', artifacts: [artifact] };

  const attempts = new Map<string, SourceResolutionAttempt>([
    ['s1', { status: 'resolved', source, packages: [pkg] }],
  ]);

  const result = resolveRecommendations([desired], [], [source], attempts);
  assert.equal(result.broken.length, 1);
  assert.deepEqual(result.broken[0].desired, desired);
  assert.deepEqual(result.broken[0].reason, { kind: 'artifact-not-found' });
});

test('resolveRecommendations - mixed input producing all three buckets simultaneously plus a skipped entry', () => {
  const desiredSat: DesiredInstallation = { sourceId: 's-sat', artifactId: 'a-sat', assistant: 'claude-code', scope: 'project' };
  const desiredPend: DesiredInstallation = { sourceId: 's-pend', artifactId: 'a-pend', assistant: 'claude-code', scope: 'project' };
  const desiredBrokUnreg: DesiredInstallation = { sourceId: 's-unreg', artifactId: 'a', assistant: 'claude-code', scope: 'project' };
  const desiredBrokFail: DesiredInstallation = { sourceId: 's-fail', artifactId: 'a', assistant: 'claude-code', scope: 'project' };
  const desiredBrokNotFound: DesiredInstallation = { sourceId: 's-notfound', artifactId: 'a-missing', assistant: 'claude-code', scope: 'project' };
  const desiredSkip: DesiredInstallation = { sourceId: 's-skip', artifactId: 'a-skip', assistant: 'claude-code', scope: 'project' };

  const desiredList = [desiredSat, desiredPend, desiredBrokUnreg, desiredBrokFail, desiredBrokNotFound, desiredSkip];

  const installed: ManagedInstallation[] = [
    { sourceId: 's-sat', artifactId: 'a-sat', assistant: 'claude-code', scope: 'project', kind: 'skill', name: 's', path: 'p', installedAt: 'now' }
  ];

  const sourcePend: Source = { id: 's-pend', type: 'git-custom', scope: 'project' };
  const sourceFail: Source = { id: 's-fail', type: 'git-custom', scope: 'project' };
  const sourceNotFound: Source = { id: 's-notfound', type: 'git-custom', scope: 'project' };
  const sourceSkip: Source = { id: 's-skip', type: 'git-custom', scope: 'project' };
  const sourceSat: Source = { id: 's-sat', type: 'git-custom', scope: 'project' };

  const registeredSources = [sourcePend, sourceFail, sourceNotFound, sourceSkip, sourceSat];

  const artifactPend: Artifact = { id: 'a-pend', packageId: 'p-pend', kind: 'skill', name: 's', nativeFormat: 'md' };
  const pkgPend: Package = { id: 'p-pend', sourceId: 's-pend', nativeFormat: 'kilo', artifacts: [artifactPend] };

  const artifactOther: Artifact = { id: 'other', packageId: 'p-notfound', kind: 'skill', name: 's', nativeFormat: 'md' };
  const pkgNotFound: Package = { id: 'p-notfound', sourceId: 's-notfound', nativeFormat: 'kilo', artifacts: [artifactOther] };

  const attempts = new Map<string, SourceResolutionAttempt>([
    ['s-pend', { status: 'resolved', source: sourcePend, packages: [pkgPend] }],
    ['s-fail', { status: 'failed', source: sourceFail, error: 'failed' }],
    ['s-notfound', { status: 'resolved', source: sourceNotFound, packages: [pkgNotFound] }]
    // s-skip is omitted
  ]);

  const result = resolveRecommendations(desiredList, installed, registeredSources, attempts);

  assert.equal(result.satisfied.length, 1);
  assert.deepEqual(result.satisfied[0], desiredSat);

  assert.equal(result.pending.length, 1);
  assert.deepEqual(result.pending[0].desired, desiredPend);

  assert.equal(result.broken.length, 3);
  assert.deepEqual(result.broken.find(b => b.desired.sourceId === 's-unreg')?.reason, { kind: 'source-not-registered' });
  assert.deepEqual(result.broken.find(b => b.desired.sourceId === 's-fail')?.reason, { kind: 'source-resolution-failed', error: 'failed' });
  assert.deepEqual(result.broken.find(b => b.desired.sourceId === 's-notfound')?.reason, { kind: 'artifact-not-found' });
});
