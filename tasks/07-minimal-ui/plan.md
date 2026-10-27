# 07 — Minimal UI (3 views) — Implementation plan

> **Derived from spec:** [../specs/foundations.md](../specs/foundations.md)

Tasks (each = one commit; hand one file at a time to a delegated agent):

## Tasks

### 07.1 - Activity Bar container + Sources view

- **Status:** `delivered` (merged 634b8ee 2026-08-19; commit 1a39b7a) · **Short:** Activity Bar and Sources view · **Size:** M · **Depends on:** 02.3 · **Spec:** [07.1-sources-view.md](07.1-sources-view.md)
- **Goal:** Add the `ai-swissknife` Activity Bar container, reusable multi-root workspace folder picker, and registry-backed `SourcesTreeDataProvider` with add/remove/reload commands.

### 07.2 - Available view (browse + install command)

- **Status:** `delivered` (merged 634b8ee 2026-08-19; commit 1a39b7a) · **Short:** Available view and install command · **Size:** M · **Depends on:** 04.3, 06.1, 06.2, 07.1 · **Spec:** [07.2-available-view.md](07.2-available-view.md)
- **Goal:** Implement `AvailableTreeDataProvider` displaying resolved packages, artifacts, and diagnostics with preview and conflict-checked installation.

### 07.3 - Installed view (registry-backed)

- **Status:** `delivered` (merged 634b8ee 2026-08-19; commit 1a39b7a) · **Short:** Registry-backed Installed view · **Size:** S · **Depends on:** 02.3, 07.1, 07.2 · **Spec:** [07.3-installed-view.md](07.3-installed-view.md)
- **Goal:** Implement `InstalledTreeDataProvider` listing `ManagedInstallation` records from `state.json` grouped by assistant and scope.

## Shared decisions

Shared decisions for this initiative that every task must honour:

- Three plain `vscode.TreeDataProvider`-based views (SPEC.md §4 "Tree
  view in Activity Bar"), **not** webviews — Phase 1 explicitly excludes
  the dashboard/form-editor webviews (`specs/foundations.md` non-goals).
- All three views live under one new Activity Bar container (like
  `references/agent-hub/package.json`'s `viewsContainers.activitybar`
  entry, but with `id: "ai-swissknife"`) — add this container once, in
  task 07.1, not duplicated across tasks.
- `projectRoot` for any `scope: 'project'` operation is resolved at the
  UI layer — this is the one place that resolution is allowed to happen
  (every lower layer takes it as an explicit parameter, per
  `CONTEXT.md`'s pure-Node constraint). **Revised (second Codex review,
  finding I5)**: don't default to `workspaceFolders[0]` — in a
  multi-root workspace, prompt the user to pick which folder; with zero
  folders, disable/hide project-scope actions. See `07.1` for the picker
  this task's other views should reuse rather than duplicate.
- **Revised (finding I4)**: "refresh" is two different, differently-named
  actions — `07.1`'s `reloadRegistry` (re-read the manifest file from
  disk, no network) and `07.2`'s `refreshCatalog` (actually resolve/fetch
  sources, real network/git activity). Don't conflate them under one
  "Refresh" command or name.
- Available catalog leaves retain Source + Package + Artifact, and carry
  resolver diagnostics to the tree. Every dismissed/cancelled preview or
  conflict-policy picker aborts; only explicit Install may call apply, once.
- Source removal checks both machine-local installations and manifest
  `desiredInstallations`. Confirmed removal also removes dependent desired
  entries, but never uninstalls files or deletes local state records.
- This initiative depends on 06 (install engine, revised — see its
  `plan.md`) for the Available view's install action, but the Sources
  view (07.1) only depends on 02 (registry, hardened by 02.3) and can be
  built and tested before 06 lands if delegated separately.
