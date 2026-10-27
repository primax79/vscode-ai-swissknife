# 36 — Add-source wizard — Summary

> **Closed on:** 2026-10-27 (registry tidy; verifier ai-coding-tools-c1)  
> **Initiative:** 36 — Add-source wizard  
> **Status:** ✅ Done and merged into main

Summary written at closure from the plan and the git history; the per-task specs in this folder hold the detail.

## What was built

- **36.1 Pure helper: validate location + derive id/name** — merged 4a77022 2026-10-08. Create `src/sources/sourceDefaults.ts` exporting `validateLocation` and `deriveSourceDefaults` to validate URLs/paths and derive source `id` and `name` without `vscode` imports.
- **36.2 Rewrite `addSource` as the type → scope(s) → location → details wizard (single scope)** — merged 193b865 2026-10-08. Rewrite `SourcesProvider.addSource(forceScope?)` into a type → scope → location → prefilled id/name wizard flow with default branch assumption and optional branch/tag pinning.
- **36.3 Multi-scope selection (one write per scope, per-scope local paths) + duplicate-id handling** — merged 1c73989 2026-10-09. Turn the add-source scope step into a multi-select (Global and/or Workspace), ask per-scope paths for `local-folder`, and prompt "Replace?" on duplicate source IDs per scope.

## Verification

- Every task's work is merged into `main` (evidence: the commits named above, from `git log --grep '<id>'`).
- `npm test` on `main` at 5e85109 (2026-10-27): 577 tests, 576 pass, 0 fail, 1 opt-in skip (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errors.
