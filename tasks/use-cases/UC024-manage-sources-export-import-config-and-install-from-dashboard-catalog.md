# UC024 - Manage sources, export/import config, and install from Dashboard catalog

- id: UC024
- title: Manage sources, export/import config, and install from Dashboard catalog
- actor: User
- approval: proposed
- priority: P2
- linked-tasks: 31.1, 31.2, 31.3, 31.4, 32.1, 32.2, 32.3, 33.1, 33.2, 33.3, 33.4, 33.5, 35.1, 35.2, 35.3, 35.4, 35.5
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: Dashboard sources and catalog

## Description & Business Value
Allows a developer to add, remove, export, or import sources and lazily browse/preview/install source catalog contents (including folder and whole-source batch installs and resolver diagnostics) directly from the Dashboard's Sources & Catalog section. Source: tasks/specs/phase-9-spec.md §1, §4

## Preconditions
- The Dashboard webview is open in VS Code.

## Scenario / Interaction Steps
1. The user switches to the Sources & Catalog section in the Dashboard to add, remove, export, or import sources across global and project scopes.
2. Expanding a source sends requestCatalog {sourceId, scope} and receives catalogData containing folders, artifacts, installed-in badges, and any resolver diagnostics.
3. The user previews an artifact or triggers single-artifact, folder, or whole-source installation via plain-identifier provider methods.

## Automated Verification Command
```bash
node --test out/engine/configTransfer.test.js out/ui/ui.test.js
```

## Acceptance Criteria
- [ ] `DashboardPanel` renders section tabs and updates content incrementally via `postMessage` (`sourcesData`, `catalogData`, `recommendationsData`, `inventoryData`) without full-HTML page reloads.
- [ ] `requestCatalog` disambiguates sources by `{ sourceId, scope }` and includes `DiagnosticTreeItem` entries alongside folders and artifacts.
- [ ] Source export (`buildScopeExport`, `buildSourceExport`) and import (`parseExportedConfigFile`, `mergeScopeConfig`) validate schema versions and merge sources and recommendations without duplicates.

## AI Validation Log

