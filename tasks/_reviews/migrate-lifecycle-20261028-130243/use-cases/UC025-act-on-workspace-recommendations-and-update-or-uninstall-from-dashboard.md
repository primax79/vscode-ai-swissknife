# UC025 - Act on workspace recommendations and update or uninstall from Dashboard

- id: UC025
- title: Act on workspace recommendations and update or uninstall from Dashboard
- actor: User
- status: draft
- priority: P1
- linked-tasks: 31, 34, 35
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: Dashboard recommendations & parity

## Description & Business Value
Brings full sidebar action parity to the Dashboard: users can install-one, install-all, or unrecommend items in the Recommendations section, create new artifacts from the header, and run Update to latest or Uninstall from the Installed detail panel with server-side identity re-resolution and cross-view refresh. Source: tasks/specs/phase-9-spec.md §1, §1.1, §4

## Preconditions
- The Dashboard webview is open with installed items or workspace recommendations.

## Scenario / Interaction Steps
1. In the Recommendations section, the user views pending and broken recommendations and triggers install-one, install-all, or unrecommend via identifier-based handlers.
2. In the Installed detail panel, the user triggers Update to latest or Uninstall; the extension re-resolves the target ManagedInstallation server-side by {assistant, scope, kind, name} rather than trusting client paths.
3. After any Dashboard mutation, both sidebar tree views, the status bar item, and the Dashboard sections refresh incrementally via postMessage.

## Automated Verification Command
```bash
node --test out/ui/recommendations.test.js out/ui/ui.test.js
```

## Acceptance Criteria
- [ ] `doUninstallItem` and `doUpdateInstallation` re-resolve the target `ManagedInstallation` server-side by `{ assistant, scope, kind, name }` identity and never trust a raw filesystem path from a webview message.
- [ ] Identifier-based `recommendAvailableArtifact`, `recommendInstalledArtifact`, `unrecommendAvailableArtifact`, and `unrecommendInstalledArtifact` operate on plain identifiers without requiring `TreeItem` instances.
- [ ] Every Dashboard mutation triggers cross-refresh of the sidebar tree views and status bar item, and handles artifact/source names containing apostrophes safely.

## AI Validation Log

