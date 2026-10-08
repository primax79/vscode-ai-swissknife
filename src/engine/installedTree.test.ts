import test from 'node:test';
import * as assert from 'node:assert/strict';
import type { ManagedInstallation, ObservedArtifact } from '../domain/types';
import {
  buildInstalledTree,
  getArtifactIdentity,
  getIdentityKey,
  STATE_SEVERITY,
  SEVERITY_TABLE,
  STATE_SEVERITIES,
  computeWorstState,
  type PlaceState,
} from './installedTree';

test('installedTree - same skill in global+project and in claude+kilo -> one object, 4 places', () => {
  const managed: ManagedInstallation[] = [
    {
      assistant: 'kilo-code',
      scope: 'project',
      projectPath: '/workspace',
      kind: 'skill',
      name: 'search-tools',
      path: '/workspace/.kilo/skills/search-tools',
      sourceId: 'src-skills',
      artifactId: 'art-search',
      installedAt: '2026-10-01T00:00:00Z',
    },
    {
      assistant: 'claude-code',
      scope: 'global',
      kind: 'skill',
      name: 'search-tools',
      path: '/home/user/.claude/skills/search-tools',
      sourceId: 'src-skills',
      artifactId: 'art-search',
      installedAt: '2026-10-01T00:00:00Z',
    },
    {
      assistant: 'kilo-code',
      scope: 'global',
      kind: 'skill',
      name: 'search-tools',
      path: '/home/user/.kilo/skills/search-tools',
      sourceId: 'src-skills',
      artifactId: 'art-search',
      installedAt: '2026-10-01T00:00:00Z',
    },
    {
      assistant: 'claude-code',
      scope: 'project',
      projectPath: '/workspace',
      kind: 'skill',
      name: 'search-tools',
      path: '/workspace/.claude/skills/search-tools',
      sourceId: 'src-skills',
      artifactId: 'art-search',
      installedAt: '2026-10-01T00:00:00Z',
    },
  ];

  const tree = buildInstalledTree(managed, []);

  assert.equal(tree.length, 1);
  const obj = tree[0];
  assert.equal(obj.kind, 'skill');
  assert.equal(obj.name, 'search-tools');
  assert.equal(obj.identity, 'prov:src-skills:art-search');
  assert.equal(obj.places.length, 4);

  // ALL_ADAPTERS order: claude-code then kilo-code; scope order: global then project
  assert.equal(obj.places[0].assistant, 'claude-code');
  assert.equal(obj.places[0].scope, 'global');
  assert.equal(obj.places[0].membership, 'managed');

  assert.equal(obj.places[1].assistant, 'claude-code');
  assert.equal(obj.places[1].scope, 'project');
  assert.equal(obj.places[1].membership, 'managed');

  assert.equal(obj.places[2].assistant, 'kilo-code');
  assert.equal(obj.places[2].scope, 'global');
  assert.equal(obj.places[2].membership, 'managed');

  assert.equal(obj.places[3].assistant, 'kilo-code');
  assert.equal(obj.places[3].scope, 'project');
  assert.equal(obj.places[3].membership, 'managed');

  // All managed places default to checking
  assert.equal(obj.worstState, 'checking');
});

test('installedTree - managed + unmanaged copy of one name -> one object, two places with different membership', () => {
  const managed: ManagedInstallation[] = [
    {
      assistant: 'claude-code',
      scope: 'global',
      kind: 'skill',
      name: 'summarizer',
      path: '/home/user/.claude/skills/summarizer',
      sourceId: 'src-1',
      artifactId: 'art-summarizer',
      installedAt: '2026-10-01T00:00:00Z',
    },
  ];

  const observed: ObservedArtifact[] = [
    {
      assistant: 'kilo-code',
      scope: 'project',
      projectPath: '/workspace',
      kind: 'skill',
      name: 'summarizer',
      path: '/workspace/.kilo/skills/summarizer',
      discoveredAt: '2026-10-01T00:00:00Z',
      match: {
        status: 'unmatched',
      },
    },
  ];

  const tree = buildInstalledTree(managed, observed);

  assert.equal(tree.length, 1);
  const obj = tree[0];
  assert.equal(obj.kind, 'skill');
  assert.equal(obj.name, 'summarizer');
  assert.equal(obj.identity, 'prov:src-1:art-summarizer');
  assert.equal(obj.places.length, 2);

  const p0 = obj.places[0];
  assert.equal(p0.assistant, 'claude-code');
  assert.equal(p0.scope, 'global');
  assert.equal(p0.membership, 'managed');
  assert.equal(p0.state, 'checking');
  assert.equal(p0.match, undefined);

  const p1 = obj.places[1];
  assert.equal(p1.assistant, 'kilo-code');
  assert.equal(p1.scope, 'project');
  assert.equal(p1.membership, 'unmanaged');
  assert.equal(p1.state, 'local-only');
  assert.deepEqual(p1.match, { status: 'none', sourceId: undefined });

  // local-only (sev 3) > checking (sev 2)
  assert.equal(obj.worstState, 'local-only');
});

test('installedTree - two objects of different kind but same name stay separate', () => {
  const managed: ManagedInstallation[] = [
    {
      assistant: 'claude-code',
      scope: 'global',
      kind: 'skill',
      name: 'formatter',
      path: '/home/user/.claude/skills/formatter',
      installedAt: '2026-10-01T00:00:00Z',
    },
    {
      assistant: 'claude-code',
      scope: 'global',
      kind: 'agent',
      name: 'formatter',
      path: '/home/user/.claude/agents/formatter.md',
      installedAt: '2026-10-01T00:00:00Z',
    },
  ];

  const tree = buildInstalledTree(managed, []);

  assert.equal(tree.length, 2);
  const skillObj = tree.find((o) => o.kind === 'skill');
  const agentObj = tree.find((o) => o.kind === 'agent');

  assert.ok(skillObj);
  assert.ok(agentObj);
  assert.equal(skillObj.name, 'formatter');
  assert.equal(agentObj.name, 'formatter');
  assert.equal(skillObj.identity, 'name:skill:formatter');
  assert.equal(agentObj.identity, 'name:agent:formatter');
  assert.equal(skillObj.places.length, 1);
  assert.equal(agentObj.places.length, 1);
});

test('installedTree - worstState for mixed states', () => {
  // Test 1: update-available > modified-locally (Dashboard ordering)
  assert.equal(
    computeWorstState(['modified-locally', 'update-available', 'up-to-date']),
    'update-available'
  );

  // Test 2: missing-on-disk > modified-and-update-available
  assert.equal(
    computeWorstState(['modified-and-update-available', 'missing-on-disk']),
    'missing-on-disk'
  );

  // Test 3: different > local-only > checking > identical > up-to-date
  assert.equal(
    computeWorstState(['checking', 'identical', 'up-to-date']),
    'checking'
  );
  assert.equal(
    computeWorstState(['identical', 'up-to-date']),
    'identical'
  );
  assert.equal(
    computeWorstState(['local-only', 'checking', 'identical']),
    'local-only'
  );
  assert.equal(
    computeWorstState(['different', 'local-only']),
    'different'
  );

  // Test 4: empty states
  assert.equal(computeWorstState([]), 'up-to-date');

  // Test 5: via buildInstalledTree with statusByKey injection
  const managed: ManagedInstallation[] = [
    {
      assistant: 'claude-code',
      scope: 'global',
      kind: 'skill',
      name: 'tool',
      path: '/p1',
      installedAt: '2026-10-01T00:00:00Z',
    },
    {
      assistant: 'kilo-code',
      scope: 'global',
      kind: 'skill',
      name: 'tool',
      path: '/p2',
      installedAt: '2026-10-01T00:00:00Z',
    },
  ];

  const key1 = getIdentityKey(managed[0]);
  const key2 = getIdentityKey(managed[1]);

  const statusMap = new Map<string, PlaceState>([
    [key1, 'up-to-date'],
    [key2, 'update-available'],
  ]);

  const tree = buildInstalledTree(managed, [], { statusByKey: statusMap });
  assert.equal(tree.length, 1);
  assert.equal(tree[0].places[0].state, 'up-to-date');
  assert.equal(tree[0].places[1].state, 'update-available');
  assert.equal(tree[0].worstState, 'update-available');
});

test('installedTree - ordering: ALL_ADAPTERS order then global-before-project', () => {
  // Scramble assistants and scopes
  const managed: ManagedInstallation[] = [
    {
      assistant: 'gemini-cli',
      scope: 'project',
      projectPath: '/w',
      kind: 'command',
      name: 'cmd',
      path: '/p1',
      installedAt: '2026-10-01T00:00:00Z',
    },
    {
      assistant: 'kilo-code',
      scope: 'project',
      projectPath: '/w',
      kind: 'command',
      name: 'cmd',
      path: '/p2',
      installedAt: '2026-10-01T00:00:00Z',
    },
    {
      assistant: 'claude-code',
      scope: 'project',
      projectPath: '/w',
      kind: 'command',
      name: 'cmd',
      path: '/p3',
      installedAt: '2026-10-01T00:00:00Z',
    },
    {
      assistant: 'github-copilot',
      scope: 'global',
      kind: 'command',
      name: 'cmd',
      path: '/p4',
      installedAt: '2026-10-01T00:00:00Z',
    },
    {
      assistant: 'claude-code',
      scope: 'global',
      kind: 'command',
      name: 'cmd',
      path: '/p5',
      installedAt: '2026-10-01T00:00:00Z',
    },
    {
      assistant: 'codex-cli',
      scope: 'global',
      kind: 'command',
      name: 'cmd',
      path: '/p6',
      installedAt: '2026-10-01T00:00:00Z',
    },
    {
      assistant: 'kilo-code',
      scope: 'global',
      kind: 'command',
      name: 'cmd',
      path: '/p7',
      installedAt: '2026-10-01T00:00:00Z',
    },
  ];

  const tree = buildInstalledTree(managed, []);
  assert.equal(tree.length, 1);
  const places = tree[0].places;

  const expectedSequence: [string, string][] = [
    ['claude-code', 'global'],
    ['claude-code', 'project'],
    ['kilo-code', 'global'],
    ['kilo-code', 'project'],
    ['github-copilot', 'global'],
    ['codex-cli', 'global'],
    ['gemini-cli', 'project'],
  ];

  assert.equal(places.length, expectedSequence.length);
  for (let i = 0; i < expectedSequence.length; i++) {
    assert.equal(places[i].assistant, expectedSequence[i][0]);
    assert.equal(places[i].scope, expectedSequence[i][1]);
  }
});

test('installedTree - empty inputs', () => {
  const tree1 = buildInstalledTree([], []);
  assert.deepEqual(tree1, []);

  const tree2 = buildInstalledTree([], [], {});
  assert.deepEqual(tree2, []);

  const tree3 = buildInstalledTree();
  assert.deepEqual(tree3, []);
});

test('installedTree - severity table exports and values', () => {
  assert.equal(SEVERITY_TABLE, STATE_SEVERITY);
  assert.equal(STATE_SEVERITIES, STATE_SEVERITY);

  // Check strict monotonic decrease according to the Dashboard ordering:
  // missing-on-disk > modified-and-update-available > update-available > modified-locally >
  // different > local-only > checking > identical > up-to-date
  const expectedOrder: PlaceState[] = [
    'missing-on-disk',
    'modified-and-update-available',
    'update-available',
    'modified-locally',
    'different',
    'local-only',
    'checking',
    'identical',
    'up-to-date',
  ];

  for (let i = 0; i < expectedOrder.length - 1; i++) {
    const curr = expectedOrder[i];
    const next = expectedOrder[i + 1];
    assert.ok(
      STATE_SEVERITY[curr] > STATE_SEVERITY[next],
      `${curr} (${STATE_SEVERITY[curr]}) must be > ${next} (${STATE_SEVERITY[next]})`
    );
  }
});

test('installedTree - shared getArtifactIdentity helper', () => {
  const managedWithProv: ManagedInstallation = {
    assistant: 'claude-code',
    scope: 'project',
    kind: 'skill',
    name: 'test-skill',
    path: '/path',
    sourceId: 'src-123',
    artifactId: 'art-456',
    installedAt: '2026-10-01T00:00:00Z',
  };
  assert.equal(getArtifactIdentity(managedWithProv), 'prov:src-123:art-456');

  const managedWithoutProv: ManagedInstallation = {
    assistant: 'claude-code',
    scope: 'project',
    kind: 'skill',
    name: 'test-skill',
    path: '/path',
    installedAt: '2026-10-01T00:00:00Z',
  };
  assert.equal(getArtifactIdentity(managedWithoutProv), 'name:skill:test-skill');

  const observedWithMatch: ObservedArtifact = {
    assistant: 'kilo-code',
    scope: 'global',
    kind: 'agent',
    name: 'my-agent',
    path: '/path',
    discoveredAt: '2026-10-01T00:00:00Z',
    match: {
      status: 'identical',
      sourceId: 'src-agents',
      artifactId: 'art-agent',
    },
  };
  assert.equal(getArtifactIdentity(observedWithMatch), 'prov:src-agents:art-agent');

  const observedWithoutMatch: ObservedArtifact = {
    assistant: 'kilo-code',
    scope: 'global',
    kind: 'agent',
    name: 'my-agent',
    path: '/path',
    discoveredAt: '2026-10-01T00:00:00Z',
  };
  assert.equal(getArtifactIdentity(observedWithoutMatch), 'name:agent:my-agent');
});

test('installedTree - observed match status mapping for identical and different', () => {
  const observedIdentical: ObservedArtifact = {
    assistant: 'claude-code',
    scope: 'global',
    kind: 'skill',
    name: 'skill-a',
    path: '/path/a',
    discoveredAt: '2026-10-01T00:00:00Z',
    match: {
      status: 'identical',
      sourceId: 'src-a',
    },
  };

  const observedDifferent: ObservedArtifact = {
    assistant: 'claude-code',
    scope: 'global',
    kind: 'skill',
    name: 'skill-b',
    path: '/path/b',
    discoveredAt: '2026-10-01T00:00:00Z',
    match: {
      status: 'different',
      sourceId: 'src-b',
    },
  };

  const tree = buildInstalledTree([], [observedIdentical, observedDifferent]);
  assert.equal(tree.length, 2);

  const objA = tree.find((o) => o.name === 'skill-a')!;
  assert.equal(objA.places[0].state, 'identical');
  assert.deepEqual(objA.places[0].match, { status: 'identical', sourceId: 'src-a' });

  const objB = tree.find((o) => o.name === 'skill-b')!;
  assert.equal(objB.places[0].state, 'different');
  assert.deepEqual(objB.places[0].match, { status: 'different', sourceId: 'src-b' });
});

test('installedTree - statusByKey supports Record and normalizes checking…', () => {
  const managed: ManagedInstallation = {
    assistant: 'claude-code',
    scope: 'global',
    kind: 'skill',
    name: 'tool',
    path: '/p',
    installedAt: '2026-10-01T00:00:00Z',
  };
  const key = getIdentityKey(managed);

  const treeRecord = buildInstalledTree([managed], [], {
    statusByKey: { [key]: 'checking…' },
  });
  assert.equal(treeRecord[0].places[0].state, 'checking');
});
