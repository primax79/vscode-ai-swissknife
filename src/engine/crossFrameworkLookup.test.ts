import test from 'node:test';
import * as assert from 'node:assert/strict';
import type { ManagedInstallation } from '../domain/types';
import { findRelatedInstallations } from './crossFrameworkLookup';

test('crossFrameworkLookup - target with sourceId+artifactId matching one other installation -> one provenance result', () => {
  const target: ManagedInstallation = {
    assistant: 'claude-code',
    scope: 'project',
    projectPath: '/workspace',
    kind: 'skill',
    name: 'summarizer',
    path: '/workspace/.claude/skills/summarizer',
    sourceId: 'src-1',
    packageId: 'pkg-1',
    artifactId: 'art-summarizer',
    installedAt: '2026-09-01T00:00:00Z',
  };

  const other: ManagedInstallation = {
    assistant: 'kilo-code',
    scope: 'project',
    projectPath: '/workspace',
    kind: 'skill',
    name: 'summarizer-kilo',
    path: '/workspace/.kilo/skills/summarizer',
    sourceId: 'src-1',
    packageId: 'pkg-1',
    artifactId: 'art-summarizer',
    installedAt: '2026-09-02T00:00:00Z',
  };

  const unrelated: ManagedInstallation = {
    assistant: 'gemini-cli',
    scope: 'global',
    kind: 'skill',
    name: 'other',
    path: '/home/user/.gemini/skills/other',
    sourceId: 'src-2',
    artifactId: 'art-other',
    installedAt: '2026-09-03T00:00:00Z',
  };

  const results = findRelatedInstallations(target, [target, other, unrelated]);

  assert.equal(results.length, 1);
  assert.equal(results[0].strategy, 'provenance');
  assert.deepEqual(results[0].installation, other);
});

test('crossFrameworkLookup - target with same provenance as two others across different assistants -> both returned', () => {
  const target: ManagedInstallation = {
    assistant: 'claude-code',
    scope: 'global',
    kind: 'agent',
    name: 'reviewer',
    path: '/home/user/.claude/agents/reviewer.md',
    sourceId: 'src-agents',
    artifactId: 'art-reviewer',
    installedAt: '2026-09-01T00:00:00Z',
  };

  const kiloInst: ManagedInstallation = {
    assistant: 'kilo-code',
    scope: 'project',
    projectPath: '/workspace',
    kind: 'agent',
    name: 'reviewer',
    path: '/workspace/.kilo/agents/reviewer.md',
    sourceId: 'src-agents',
    artifactId: 'art-reviewer',
    installedAt: '2026-09-02T00:00:00Z',
  };

  const copilotInst: ManagedInstallation = {
    assistant: 'github-copilot',
    scope: 'project',
    projectPath: '/workspace',
    kind: 'agent',
    name: 'reviewer',
    path: '/workspace/.github/agents/reviewer.agent.md',
    sourceId: 'src-agents',
    artifactId: 'art-reviewer',
    installedAt: '2026-09-03T00:00:00Z',
  };

  const results = findRelatedInstallations(target, [kiloInst, target, copilotInst]);

  assert.equal(results.length, 2);
  assert.equal(results[0].strategy, 'provenance');
  assert.deepEqual(results[0].installation, kiloInst);
  assert.equal(results[1].strategy, 'provenance');
  assert.deepEqual(results[1].installation, copilotInst);
});

test('crossFrameworkLookup - target with sourceId+artifactId but no other installation sharing them -> empty array (must not fall back to name+kind)', () => {
  const target: ManagedInstallation = {
    assistant: 'claude-code',
    scope: 'project',
    kind: 'skill',
    name: 'formatter',
    path: '/workspace/.claude/skills/formatter',
    sourceId: 'src-1',
    artifactId: 'art-formatter',
    installedAt: '2026-09-01T00:00:00Z',
  };

  // Has same name and kind, but different provenance
  const candidateWithDifferentProvenance: ManagedInstallation = {
    assistant: 'kilo-code',
    scope: 'project',
    kind: 'skill',
    name: 'formatter',
    path: '/workspace/.kilo/skills/formatter',
    sourceId: 'src-2',
    artifactId: 'art-formatter-other',
    installedAt: '2026-09-02T00:00:00Z',
  };

  // Has same name and kind, and no provenance
  const candidateWithoutProvenance: ManagedInstallation = {
    assistant: 'github-copilot',
    scope: 'global',
    kind: 'skill',
    name: 'formatter',
    path: '/home/user/.github/skills/formatter',
    installedAt: '2026-09-03T00:00:00Z',
  };

  const results = findRelatedInstallations(target, [
    target,
    candidateWithDifferentProvenance,
    candidateWithoutProvenance,
  ]);

  assert.equal(results.length, 0);
});

test('crossFrameworkLookup - target missing sourceId matching another installation by name+kind -> one name-fallback result', () => {
  const target: ManagedInstallation = {
    assistant: 'claude-code',
    scope: 'project',
    kind: 'skill',
    name: 'linter',
    path: '/workspace/.claude/skills/linter',
    // missing sourceId
    artifactId: 'art-linter',
    installedAt: '2026-09-01T00:00:00Z',
  };

  const match: ManagedInstallation = {
    assistant: 'kilo-code',
    scope: 'global',
    kind: 'skill',
    name: 'linter',
    path: '/home/user/.kilo/skills/linter',
    sourceId: 'src-community',
    artifactId: 'art-linter',
    installedAt: '2026-09-02T00:00:00Z',
  };

  const results = findRelatedInstallations(target, [target, match]);

  assert.equal(results.length, 1);
  assert.equal(results[0].strategy, 'name-fallback');
  assert.deepEqual(results[0].installation, match);
});

test('crossFrameworkLookup - target missing artifactId matching another installation by name+kind -> one name-fallback result', () => {
  const target: ManagedInstallation = {
    assistant: 'claude-code',
    scope: 'project',
    kind: 'command',
    name: 'deploy',
    path: '/workspace/.claude/commands/deploy.md',
    sourceId: 'src-commands',
    // missing artifactId
    installedAt: '2026-09-01T00:00:00Z',
  };

  const match: ManagedInstallation = {
    assistant: 'gemini-cli',
    scope: 'project',
    kind: 'command',
    name: 'deploy',
    path: '/workspace/.gemini/commands/deploy.toml',
    installedAt: '2026-09-02T00:00:00Z',
  };

  const results = findRelatedInstallations(target, [target, match]);

  assert.equal(results.length, 1);
  assert.equal(results[0].strategy, 'name-fallback');
  assert.deepEqual(results[0].installation, match);
});

test('crossFrameworkLookup - target itself must never appear in its own result list', () => {
  const target: ManagedInstallation = {
    assistant: 'claude-code',
    scope: 'project',
    kind: 'skill',
    name: 'shared-skill',
    path: '/workspace/.claude/skills/shared-skill',
    sourceId: 'src-1',
    artifactId: 'art-1',
    installedAt: '2026-09-01T00:00:00Z',
  };

  // Same reference
  const results1 = findRelatedInstallations(target, [target]);
  assert.equal(results1.length, 0);

  // Different object instance with same assistant+scope+name+path
  const targetClone: ManagedInstallation = {
    assistant: 'claude-code',
    scope: 'project',
    kind: 'skill',
    name: 'shared-skill',
    path: '/workspace/.claude/skills/shared-skill',
    sourceId: 'src-1',
    artifactId: 'art-1',
    installedAt: '2026-09-01T00:00:00Z',
  };

  const results2 = findRelatedInstallations(target, [targetClone]);
  assert.equal(results2.length, 0);

  // Target without provenance must also exclude itself
  const unmanagedTarget: ManagedInstallation = {
    assistant: 'claude-code',
    scope: 'global',
    kind: 'skill',
    name: 'local-tool',
    path: '/home/user/.claude/skills/local-tool',
    installedAt: '2026-09-01T00:00:00Z',
  };
  const results3 = findRelatedInstallations(unmanagedTarget, [unmanagedTarget]);
  assert.equal(results3.length, 0);
});

test('crossFrameworkLookup - two installations with the same name but different kind must not match', () => {
  const target: ManagedInstallation = {
    assistant: 'claude-code',
    scope: 'project',
    kind: 'skill',
    name: 'test-runner',
    path: '/workspace/.claude/skills/test-runner',
    // missing provenance triggers name-fallback
    installedAt: '2026-09-01T00:00:00Z',
  };

  const sameNameDifferentKind: ManagedInstallation = {
    assistant: 'kilo-code',
    scope: 'project',
    kind: 'command',
    name: 'test-runner',
    path: '/workspace/.kilo/commands/test-runner.md',
    installedAt: '2026-09-02T00:00:00Z',
  };

  const results = findRelatedInstallations(target, [target, sameNameDifferentKind]);
  assert.equal(results.length, 0);
});
