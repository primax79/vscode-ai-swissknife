import test from 'node:test';
import * as assert from 'node:assert/strict';
import type {
  AssistantId,
  ItemKind,
  ManagedInstallation,
  ObservedArtifact,
  ObservedSourceMatch,
  Source,
} from '../domain/types';
import type { Adapter } from '../adapters/types';
import { claudeAdapter } from '../adapters/claude';
import type { InstalledObject, Place } from './installedTree';
import {
  resolveOrigin,
  computeMissingPlaces,
  checkInstallCapability,
} from './missingPlaces';

test('missingPlaces - resolveOrigin: managed place -> origin source', () => {
  const managedPlace: Place = {
    key: 'claude-code:global:skill::my-skill',
    assistant: 'claude-code',
    scope: 'global',
    membership: 'managed',
    state: 'up-to-date',
    disabled: false,
  };

  const managed: ManagedInstallation[] = [
    {
      assistant: 'claude-code',
      scope: 'global',
      kind: 'skill',
      name: 'my-skill',
      path: '/home/user/.claude/skills/my-skill',
      sourceId: 'src-skills',
      artifactId: 'art-my-skill',
      installedAt: '2026-10-01T00:00:00Z',
    },
  ];

  const origin = resolveOrigin(managedPlace, managed, []);
  assert.strictEqual(origin.kind, 'source');
  if (origin.kind === 'source') {
    assert.strictEqual(origin.sourceId, 'src-skills');
    assert.strictEqual(origin.artifactId, 'art-my-skill');
    assert.strictEqual(origin.scope, 'global');
  }
});

test('missingPlaces - resolveOrigin: managed place resolves source scope from registered sources', () => {
  const managedPlace: Place = {
    key: 'claude-code:global:skill::my-skill',
    assistant: 'claude-code',
    scope: 'global',
    membership: 'managed',
    state: 'up-to-date',
    disabled: false,
  };

  const managed: ManagedInstallation[] = [
    {
      assistant: 'claude-code',
      scope: 'global',
      kind: 'skill',
      name: 'my-skill',
      path: '/home/user/.claude/skills/my-skill',
      sourceId: 'src-team',
      artifactId: 'art-team-skill',
      installedAt: '2026-10-01T00:00:00Z',
    },
  ];

  const sources: Source[] = [
    {
      id: 'src-team',
      type: 'local-folder',
      scope: 'project',
      localPath: '/workspace/team-skills',
    },
  ];

  const origin = resolveOrigin(managedPlace, managed, [], sources);
  assert.strictEqual(origin.kind, 'source');
  if (origin.kind === 'source') {
    assert.strictEqual(origin.sourceId, 'src-team');
    assert.strictEqual(origin.artifactId, 'art-team-skill');
    assert.strictEqual(origin.scope, 'project');
  }
});

test('missingPlaces - resolveOrigin: managed place without sourceId/artifactId falls back to local', () => {
  const managedPlace: Place = {
    key: 'claude-code:global:skill::local-managed',
    assistant: 'claude-code',
    scope: 'global',
    membership: 'managed',
    state: 'up-to-date',
    disabled: false,
  };

  const managed: ManagedInstallation[] = [
    {
      assistant: 'claude-code',
      scope: 'global',
      kind: 'skill',
      name: 'local-managed',
      path: '/home/user/.claude/skills/local-managed',
      installedAt: '2026-10-01T00:00:00Z',
    },
  ];

  const origin = resolveOrigin(managedPlace, managed, []);
  assert.strictEqual(origin.kind, 'local');
  if (origin.kind === 'local') {
    assert.strictEqual(origin.place, managedPlace);
  }
});

test('missingPlaces - resolveOrigin: unmanaged with one candidate -> source', () => {
  const unmanagedPlace: Place = {
    key: 'kilo-code:project:skill:/workspace:helper-skill',
    assistant: 'kilo-code',
    scope: 'project',
    membership: 'unmanaged',
    state: 'identical',
    disabled: false,
  };

  const candidate: ObservedSourceMatch = {
    status: 'identical',
    sourceId: 'community-src',
    artifactId: 'helper-skill-id',
    packageId: 'pkg-1',
  };

  const observed: ObservedArtifact[] = [
    {
      assistant: 'kilo-code',
      scope: 'project',
      projectPath: '/workspace',
      kind: 'skill',
      name: 'helper-skill',
      path: '/workspace/.kilo/skills/helper-skill',
      discoveredAt: '2026-10-01T00:00:00Z',
      candidates: [candidate],
      match: candidate,
    },
  ];

  const origin = resolveOrigin(unmanagedPlace, [], observed);
  assert.strictEqual(origin.kind, 'source');
  if (origin.kind === 'source') {
    assert.strictEqual(origin.sourceId, 'community-src');
    assert.strictEqual(origin.artifactId, 'helper-skill-id');
    assert.strictEqual(origin.scope, 'project');
  }
});

test('missingPlaces - resolveOrigin: unmanaged with two candidates -> candidates', () => {
  const unmanagedPlace: Place = {
    key: 'kilo-code:global:skill::dup-skill',
    assistant: 'kilo-code',
    scope: 'global',
    membership: 'unmanaged',
    state: 'different',
    disabled: false,
  };

  const candidate1: ObservedSourceMatch = {
    status: 'identical',
    sourceId: 'src-1',
    artifactId: 'art-1',
    packageId: 'pkg-1',
  };

  const candidate2: ObservedSourceMatch = {
    status: 'different',
    sourceId: 'src-2',
    artifactId: 'art-2',
    packageId: 'pkg-2',
  };

  const observed: ObservedArtifact[] = [
    {
      assistant: 'kilo-code',
      scope: 'global',
      kind: 'skill',
      name: 'dup-skill',
      path: '/home/user/.kilo/skills/dup-skill',
      discoveredAt: '2026-10-01T00:00:00Z',
      candidates: [candidate1, candidate2],
      match: candidate1,
    },
  ];

  const origin = resolveOrigin(unmanagedPlace, [], observed);
  assert.strictEqual(origin.kind, 'candidates');
  if (origin.kind === 'candidates') {
    assert.strictEqual(origin.candidates.length, 2);
    assert.strictEqual(origin.candidates[0].sourceId, 'src-1');
    assert.strictEqual(origin.candidates[1].sourceId, 'src-2');
  }
});

test('missingPlaces - resolveOrigin: unmanaged with none -> local', () => {
  const unmanagedPlace: Place = {
    key: 'claude-code:global:skill::scratch-skill',
    assistant: 'claude-code',
    scope: 'global',
    membership: 'unmanaged',
    state: 'local-only',
    disabled: false,
  };

  const observed: ObservedArtifact[] = [
    {
      assistant: 'claude-code',
      scope: 'global',
      kind: 'skill',
      name: 'scratch-skill',
      path: '/home/user/.claude/skills/scratch-skill',
      discoveredAt: '2026-10-01T00:00:00Z',
      candidates: [],
      match: {
        status: 'unmatched',
        details: 'Local component',
      },
    },
  ];

  const origin = resolveOrigin(unmanagedPlace, [], observed);
  assert.strictEqual(origin.kind, 'local');
  if (origin.kind === 'local') {
    assert.strictEqual(origin.place, unmanagedPlace);
  }
});

test('missingPlaces - resolveOrigin: place not found in inventory -> local', () => {
  const missingPlace: Place = {
    key: 'claude-code:global:skill::ghost-skill',
    assistant: 'claude-code',
    scope: 'global',
    membership: 'managed',
    state: 'missing-on-disk',
    disabled: false,
  };

  const origin = resolveOrigin(missingPlace, [], []);
  assert.strictEqual(origin.kind, 'local');
  if (origin.kind === 'local') {
    assert.strictEqual(origin.place, missingPlace);
  }
});

test('missingPlaces - computeMissingPlaces: object present in claude/global and kilo/project offers other 6 of 8 pairs (4 assistants, 2 scopes)', () => {
  const enabledAssistants: AssistantId[] = [
    'claude-code',
    'kilo-code',
    'github-copilot',
    'codex-cli',
  ];

  const placesOfObject: Place[] = [
    {
      key: 'claude-code:global:skill::my-skill',
      assistant: 'claude-code',
      scope: 'global',
      membership: 'managed',
      state: 'up-to-date',
      disabled: false,
    },
    {
      key: 'kilo-code:project:skill:/workspace:my-skill',
      assistant: 'kilo-code',
      scope: 'project',
      membership: 'unmanaged',
      state: 'identical',
      disabled: false,
    },
  ];

  const result = computeMissingPlaces({
    placesOfObject,
    enabledAssistants,
    workspaceOpen: true,
    kind: 'skill',
  });

  // 4 enabled assistants × 2 scopes = 8 total pairs.
  // 2 are already present: (claude-code, global) and (kilo-code, project).
  // Exactly 6 remaining pairs should be offered.
  assert.strictEqual(result.offered.length, 6);
  assert.strictEqual(result.unsupported.length, 0);

  const expectedOffered = [
    { assistant: 'claude-code', scope: 'project' },
    { assistant: 'kilo-code', scope: 'global' },
    { assistant: 'github-copilot', scope: 'global' },
    { assistant: 'github-copilot', scope: 'project' },
    { assistant: 'codex-cli', scope: 'global' },
    { assistant: 'codex-cli', scope: 'project' },
  ];

  assert.deepStrictEqual(result.offered, expectedOffered);

  // Verify that existing places are NEVER offered
  const claudeGlobalOffered = result.offered.some(
    (p) => p.assistant === 'claude-code' && p.scope === 'global'
  );
  assert.strictEqual(claudeGlobalOffered, false);

  const kiloProjectOffered = result.offered.some(
    (p) => p.assistant === 'kilo-code' && p.scope === 'project'
  );
  assert.strictEqual(kiloProjectOffered, false);
});

test('missingPlaces - computeMissingPlaces: no workspace -> no project pairs', () => {
  const enabledAssistants: AssistantId[] = [
    'claude-code',
    'kilo-code',
    'github-copilot',
    'codex-cli',
  ];

  const placesOfObject: Place[] = [
    {
      key: 'claude-code:global:skill::my-skill',
      assistant: 'claude-code',
      scope: 'global',
      membership: 'managed',
      state: 'up-to-date',
      disabled: false,
    },
  ];

  const result = computeMissingPlaces({
    placesOfObject,
    enabledAssistants,
    workspaceOpen: false,
    kind: 'skill',
  });

  // When workspaceOpen is false, only global pairs are considered.
  // Total pairs considered = 4.
  // claude-code:global is already present.
  // Remaining = 3 global pairs. No project pairs in offered or unsupported.
  assert.strictEqual(result.offered.length, 3);
  assert.strictEqual(result.unsupported.length, 0);

  for (const item of result.offered) {
    assert.strictEqual(item.scope, 'global');
  }

  assert.deepStrictEqual(result.offered, [
    { assistant: 'kilo-code', scope: 'global' },
    { assistant: 'github-copilot', scope: 'global' },
    { assistant: 'codex-cli', scope: 'global' },
  ]);
});

test('missingPlaces - computeMissingPlaces: existing places never offered, a disabled place counts as present', () => {
  const enabledAssistants: AssistantId[] = [
    'claude-code',
    'kilo-code',
  ];

  const placesOfObject: Place[] = [
    {
      key: 'claude-code:global:skill::disabled-skill',
      assistant: 'claude-code',
      scope: 'global',
      membership: 'managed',
      state: 'disabled',
      disabled: true,
    },
    {
      key: 'claude-code:project:skill:/workspace:disabled-skill',
      assistant: 'claude-code',
      scope: 'project',
      membership: 'unmanaged',
      state: 'disabled',
      disabled: true,
    },
  ];

  const result = computeMissingPlaces({
    placesOfObject,
    enabledAssistants,
    workspaceOpen: true,
    kind: 'skill',
  });

  // claude-code global and project are both disabled, but count as present.
  // Therefore neither should be offered nor in unsupported.
  const claudeOffered = result.offered.filter((p) => p.assistant === 'claude-code');
  assert.strictEqual(claudeOffered.length, 0);

  const claudeUnsupported = result.unsupported.filter((p) => p.assistant === 'claude-code');
  assert.strictEqual(claudeUnsupported.length, 0);

  // kilo-code places (global and project) are offered
  assert.strictEqual(result.offered.length, 2);
  assert.deepStrictEqual(result.offered, [
    { assistant: 'kilo-code', scope: 'global' },
    { assistant: 'kilo-code', scope: 'project' },
  ]);
});

test('missingPlaces - computeMissingPlaces: a kind an adapter cannot install appears under unsupported with a reason', () => {
  // Mock adapter that lacks hookPath
  const mockAdapterWithoutHook = {
    assistant: 'kilo-code' as const,
    displayName: 'Mock Kilo without hook',
    iconId: 'mock-kilo',
    disableSupport: 'unsupported' as const,
    getDisabledPath: () => undefined,
    getDisabledRoot: () => undefined,
    skillDir: () => '/tmp/skills',
    skillPath: () => '/tmp/skills/test/SKILL.md',
    readSkill: async () => null,
    writeSkill: async () => {},
    listSkills: async () => [],
    agentPath: () => '/tmp/agents/test.md',
    readAgent: async () => null,
    writeAgent: async () => {},
    listAgents: async () => [],
    commandPath: () => '/tmp/commands/test.md',
    readCommand: async () => null,
    writeCommand: async () => {},
    listCommands: async () => [],
    mcpConfigPath: () => '/tmp/mcp.json',
    readMcpServer: async () => null,
    writeMcpServer: async () => {},
    removeMcpServer: async () => {},
    listMcpServers: async () => [],
    // hookPath is omitted!
    readHook: async () => null,
    writeHook: async () => {},
    listHooks: async () => [],
    rulePath: () => '/tmp/rule.md',
    readRule: async () => null,
    writeRule: async () => {},
  } as unknown as Adapter;

  const result = computeMissingPlaces({
    placesOfObject: [],
    enabledAssistants: ['claude-code', mockAdapterWithoutHook],
    workspaceOpen: false,
    kind: 'hook',
  });

  // claude-code supports hooks -> offered
  const claudeOffered = result.offered.find((p) => p.assistant === 'claude-code');
  assert.ok(claudeOffered);
  assert.strictEqual(claudeOffered.scope, 'global');

  // mock kilo lacks hookPath -> unsupported with reason
  const kiloUnsupported = result.unsupported.find((p) => p.assistant === 'kilo-code');
  assert.ok(kiloUnsupported);
  assert.strictEqual(kiloUnsupported.scope, 'global');
  assert.ok(
    kiloUnsupported.reason.includes('does not support hook installation'),
    `Expected reason to mention hook installation, got: ${kiloUnsupported.reason}`
  );
});

test('missingPlaces - computeMissingPlaces: unknown artifact kind appears under unsupported for all pairs', () => {
  const result = computeMissingPlaces({
    placesOfObject: [],
    enabledAssistants: ['claude-code', 'kilo-code'],
    workspaceOpen: false,
    kind: 'unknown-kind' as ItemKind,
  });

  assert.strictEqual(result.offered.length, 0);
  assert.strictEqual(result.unsupported.length, 2);
  for (const u of result.unsupported) {
    assert.ok(u.reason.includes('Artifact kind "unknown-kind" is not supported'));
  }
});

test('missingPlaces - computeMissingPlaces: accepts InstalledObject as placesOfObject', () => {
  const installedObject: InstalledObject = {
    kind: 'command',
    name: 'run-check',
    identity: 'name:command:run-check',
    worstState: 'up-to-date',
    places: [
      {
        key: 'claude-code:global:command::run-check',
        assistant: 'claude-code',
        scope: 'global',
        membership: 'managed',
        state: 'up-to-date',
        disabled: false,
      },
    ],
  };

  const result = computeMissingPlaces({
    placesOfObject: installedObject,
    enabledAssistants: ['claude-code', 'kilo-code'],
    workspaceOpen: false,
  });

  // Kind is inferred from InstalledObject.kind ('command')
  // claude-code:global exists -> omitted
  // kilo-code:global is offered
  assert.strictEqual(result.offered.length, 1);
  assert.strictEqual(result.offered[0].assistant, 'kilo-code');
  assert.strictEqual(result.offered[0].scope, 'global');
  assert.strictEqual(result.unsupported.length, 0);
});

test('missingPlaces - checkInstallCapability: exercises capability checks for all kinds', () => {
  assert.strictEqual(checkInstallCapability(claudeAdapter, 'skill', 'global').supported, true);
  assert.strictEqual(checkInstallCapability(claudeAdapter, 'agent', 'global').supported, true);
  assert.strictEqual(checkInstallCapability(claudeAdapter, 'command', 'global').supported, true);
  assert.strictEqual(checkInstallCapability(claudeAdapter, 'mcp-server', 'global').supported, true);
  assert.strictEqual(checkInstallCapability(claudeAdapter, 'hook', 'global').supported, true);
  assert.strictEqual(checkInstallCapability(claudeAdapter, 'rule', 'global').supported, true);

  const invalid = checkInstallCapability(claudeAdapter, 'invalid' as ItemKind, 'global');
  assert.strictEqual(invalid.supported, false);
  assert.ok(invalid.reason?.includes('Artifact kind "invalid" is not supported'));
});
