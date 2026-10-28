# UC008 - Discover unmanaged artifacts in assistant folders and promote them

- id: UC008
- title: Discover unmanaged artifacts in assistant folders and promote them
- actor: User
- status: draft
- priority: P1
- linked-tasks: 14
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: Discover and promote items

## Description & Business Value
Scans assistant directories for manually created (unmanaged) skills, agents, commands, and MCP servers, matches them against registered sources (identical, differs, or local-only), and promotes selected items to ManagedInstallation status in state.json. Source: tasks/specs/phase-3-spec.md §1

## Preconditions
- An assistant directory contains an artifact not recorded in state.json.

## Scenario / Interaction Steps
1. scanInstalledInventory scans all enabled assistant folders and identifies unmanaged ObservedArtifact entries.
2. Each unmanaged item is compared against registered sources to determine whether it is identical to a source artifact, differs from a source candidate, or exists locally only.
3. The user invokes Promote on an unmanaged item, recording it in state.json with restored source provenance (if matched) or local provenance.

## Automated Verification Command
```bash
node --test out/engine/discovery.test.js
```

## Acceptance Criteria
- [ ] `scanInstalledInventory` discovers unmanaged skills, agents, commands, and MCP servers across assistant directories without duplicating already-managed items.
- [ ] Unmanaged items matching a registered source artifact are flagged as `identical` or `differs`, collecting all candidate sources rather than stopping at the first match.
- [ ] `promoteObservedArtifact` promotes an unmanaged artifact into `state.json`, restoring upstream source provenance when a matching source is selected.

## AI Validation Log

