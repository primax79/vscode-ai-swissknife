# 33 — Dashboard: Sources & Catalog section — Summary

> **Closed on:** 2026-10-27 (registry tidy; verifier ai-coding-tools-c1)  
> **Initiative:** 33 — Dashboard: Sources & Catalog section  
> **Status:** ✅ Done and merged into main

Summary written at closure from the plan and the git history; the per-task specs in this folder hold the detail.

## What was built

- **33.1 Sources list + CRUD** — merged 8f93b35 2026-09-08. Render the scope-grouped source list in the Dashboard's Sources & Catalog section with Add, Remove, Export, Export All, and Import wired to `SourcesTreeDataProvider`.
- **33.2 Lazy catalog browsing** — merged eddad66 2026-09-08. Implement on-demand source expansion via `requestCatalog{sourceId, scope}` and `catalogData` messages rendering nested folders, artifacts, and diagnostics.
- **33.3 Preview action** — merged f55e7de 2026-09-08. Wire `previewArtifact` from Dashboard catalog rows to open a read-only preview editor tab via `AvailableTreeDataProvider`.
- **33.4 Install actions** — merged 0d68bf7 2026-09-08. Wire single-artifact, folder, and whole-source install actions from the Dashboard catalog to the decoupled `doInstall*` methods on `AvailableTreeDataProvider`.
- **33.5 "Installed in" badges + catalog refresh** — merged 357c20b 2026-09-08. Display per-artifact installed-in assistant badges on catalog rows, wire `refreshCatalog`, and trigger cross-provider refresh after mutations.

## Verification

- Every task's work is merged into `main` (evidence: the commits named above, from `git log --grep '<id>'`).
- `npm test` on `main` at 5e85109 (2026-10-27): 577 tests, 576 pass, 0 fail, 1 opt-in skip (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errors.
