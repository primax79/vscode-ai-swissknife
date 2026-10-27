# 07 — Minimal UI (3 views) — Summary

> **Closed on:** 2026-10-27 (registry tidy; verifier ai-coding-tools-c1)  
> **Initiative:** 07 — Minimal UI (3 views)  
> **Status:** ✅ Done and merged into main

Summary written at closure from the plan and the git history; the per-task specs in this folder hold the detail.

## What was built

- **07.1 Activity Bar container + Sources view** — merged 634b8ee 2026-08-19; commit 1a39b7a. Add the `ai-swissknife` Activity Bar container, reusable multi-root workspace folder picker, and registry-backed `SourcesTreeDataProvider` with add/remove/reload commands.
- **07.2 Available view (browse + install command)** — merged 634b8ee 2026-08-19; commit 1a39b7a. Implement `AvailableTreeDataProvider` displaying resolved packages, artifacts, and diagnostics with preview and conflict-checked installation.
- **07.3 Installed view (registry-backed)** — merged 634b8ee 2026-08-19; commit 1a39b7a. Implement `InstalledTreeDataProvider` listing `ManagedInstallation` records from `state.json` grouped by assistant and scope.

## Verification

- Every task's work is merged into `main` (evidence: the commits named above, from `git log --grep '<id>'`).
- `npm test` on `main` at 5e85109 (2026-10-27): 577 tests, 576 pass, 0 fail, 1 opt-in skip (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errors.
