# UC020 - Open the Dashboard from the status bar pending badge or filtered by source

- id: UC020
- title: Open the Dashboard from the status bar pending badge or filtered by source
- actor: User
- approval: proposed
- priority: P2
- linked-tasks: 26.1, 26.2, 27.1, 27.2
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: Status bar and source jump

## Description & Business Value
Provides a persistent VS Code status bar item showing pending updates and unsatisfied recommendations that opens the unified Dashboard, plus an explicit Open in Dashboard action on any source row that pre-applies a composite {sourceId, sourceScope} filter. Source: tasks/specs/phase-6-spec.md §4.5, §4.6

## Preconditions
- The extension is activated in VS Code.

## Scenario / Interaction Steps
1. During activation, a persistent status bar item computes unsatisfied recommendation and update counts via computePendingCounts and displays a summary badge.
2. Clicking the status bar item opens the Dashboard showing the unified managed/unmanaged table with filter pills and HTML-escaped dynamic values.
3. Invoking Open in Dashboard on a source row opens the Dashboard with that source's composite {id, scope} filter pre-applied in the filter breadcrumb.

## Automated Verification Command
```bash
node --test out/engine/pendingCounts.test.js out/ui/ui.test.js
```

## Acceptance Criteria
- [ ] `computePendingCounts` calculates unsatisfied project recommendations and available updates, and `formatStatusBarLabel`/`formatStatusBarTooltip` format singular/plural status bar text.
- [ ] The rebuilt Dashboard renders managed and unmanaged items in a single unified table with HTML escaping and no legacy `#observedTable`.
- [ ] `Open in Dashboard` on a `SourceItem` filters the Dashboard by the composite `{ sourceId, sourceScope }` pair.

## AI Validation Log

