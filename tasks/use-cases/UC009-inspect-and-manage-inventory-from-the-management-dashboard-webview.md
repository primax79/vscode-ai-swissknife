# UC009 - Inspect and manage inventory from the Management Dashboard webview

- id: UC009
- title: Inspect and manage inventory from the Management Dashboard webview
- actor: User
- approval: proposed
- priority: P2
- linked-tasks: 15.1, 15.2, 16.1, 16.2, 16.3
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: Management Dashboard webview

## Description & Business Value
Provides a visual Management Dashboard webview in VS Code with summary metrics, search, filters, drift status badges, and reactive updates from debounced filesystem watchers. Source: tasks/specs/phase-3-spec.md §1

## Preconditions
- The AI Swissknife extension is active in VS Code.

## Scenario / Interaction Steps
1. The user opens the Management Dashboard from the Activity Bar or command palette.
2. The webview renders inventory metrics, installed items, and drift indicators, updating incrementally when background drift scans complete.
3. External changes in assistant folders trigger debounced file watchers that refresh the tree views and Dashboard.

## Automated Verification Command
```bash
node --test out/ui/ui.test.js
```

## Acceptance Criteria
- [ ] `DashboardPanel` renders inventory summary metrics, item rows, filter controls, and drift badges in both initial and scanning modes.
- [ ] `setupFileWatchers` registers disposables watching assistant configuration directories for external file creations, modifications, and deletions.
- [ ] Incremental `postMessage` updates refresh the Dashboard table and drift status badges without requiring a full webview reload.

## AI Validation Log

