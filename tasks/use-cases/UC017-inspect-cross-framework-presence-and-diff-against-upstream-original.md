# UC017 - Inspect cross-framework presence and diff against upstream original

- id: UC017
- title: Inspect cross-framework presence and diff against upstream original
- actor: User
- approval: proposed
- priority: P2
- linked-tasks: 23.1, 23.2, 23.3, 24.1, 24.2, 26.1, 26.2
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: Cross-framework lookup and diff

## Description & Business Value
Allows a developer inspecting an installed item in the Dashboard to see where else the same artifact is installed across assistants/scopes (by provenance or probable name+kind fallback) and open a diff against the current upstream original. Source: tasks/specs/phase-6-spec.md §4.1, §4.2, §4.5

## Preconditions
- One or more artifacts are installed across assistants or scopes.

## Scenario / Interaction Steps
1. The user selects an installed or unmanaged row in the Dashboard unified table.
2. The detail panel displays origin provenance, cross-framework 'installed also in' matches (distinguishing exact provenance from probable name+kind fallback), and an action bar.
3. For a locally modified managed item or an unmanaged item that differs from a source candidate, clicking Diff resolves/translates the upstream original and opens a read-only diff on the logical unit.

## Automated Verification Command
```bash
node --test out/engine/crossFrameworkLookup.test.js out/ui/ui.test.js
```

## Acceptance Criteria
- [ ] `crossFrameworkLookup` matches other installations by exact `sourceId + artifactId` (`provenance`) when both are present, or falls back to `name + kind` (`name-fallback`) when either is missing, never returning the target item itself.
- [ ] Diff-vs-original extracts the logical unit for `rule` (demarcated block) and `mcp-server` (single server JSON entry) rather than diffing the whole shared file.
- [ ] Preview-before-install lets the user inspect the resolved/translated content from `planInstall` read-only before confirming `applyInstall`.

## AI Validation Log

