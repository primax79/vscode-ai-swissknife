# UC028 - Install an artifact to multiple assistants and scopes or refresh one source

- id: UC028
- title: Install an artifact to multiple assistants and scopes or refresh one source
- actor: User
- status: draft
- priority: P1
- linked-tasks: 36, 37, 38, 40
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: Multi-target install & refresh

## Description & Business Value
Allows installing an artifact across a matrix of assistants and scopes in one operation (planInstallMatrix / applyInstallMatrix), refreshing a single source without re-fetching others, and viewing multi-place objects as a collapsible tree in the Dashboard. Source: tasks/specs/actions-study.md §2

## Preconditions
- One or more sources are registered and multiple assistants are enabled.

## Scenario / Interaction Steps
1. The user plans and applies an installation across multiple selected assistants and scopes via planInstallMatrix and applyInstallMatrix, with sequential execution and per-target conflict/unsupported reporting.
2. When refreshing a single source from the sidebar or Dashboard, refreshSource resolves only that source (deduplicating concurrent calls) while keeping sibling sources intact.
3. In the Dashboard Installed tab, an artifact installed in multiple places renders as one collapsible parent row with environment chips, worst-state badge, and child place rows.

## Automated Verification Command
```bash
node --test out/engine/installMatrix.test.js out/sources/sourceDefaults.test.js out/ui/ui.test.js
```

## Acceptance Criteria
- [ ] `planInstallMatrix` and `applyInstallMatrix` plan and sequentially apply an artifact across multiple assistants and scopes, skipping conflicts unless `overwrite` is set and reporting unsupported targets with reasons.
- [ ] `refreshSource` resolves only the targeted `(sourceId, scope)` source, deduplicates concurrent calls, and recomputes the `Recommended` group without re-fetching other sources.
- [ ] `installedTree` groups multiple installations of the same logical artifact into one parent object with ordered child places and worst-status calculation.

## AI Validation Log

