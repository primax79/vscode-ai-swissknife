# 26 — Dashboard rebuild: unified table, filters, detail — Summary

> **Closed on:** 2026-10-27 (registry tidy; verifier ai-coding-tools-c1)  
> **Initiative:** 26 — Dashboard rebuild: unified table, filters, detail  
> **Status:** ✅ Done and merged into main

Summary written at closure from the plan and the git history; the per-task specs in this folder hold the detail.

## What was built

- **26.1 Unified table + filter bar + breadcrumb** — merged 765f5d7 2026-09-07. Replace the Dashboard's two structurally different tables (managed vs. unmanaged) with one unified row model, a single status badge, and an Environment/Scope/Membership/Kind/search filter bar with a removable-chip breadcrumb.
- **26.2 Per-item detail panel + value-based action handlers** — merged c1c85d7 2026-09-08. Add a request/response webview message protocol so selecting a row opens a detail section showing origin, diff availability, cross-framework presence, and value-based Copy/Move/Promote/Edit action handlers.

## Verification

- Every task's work is merged into `main` (evidence: the commits named above, from `git log --grep '<id>'`).
- `npm test` on `main` at 5e85109 (2026-10-27): 577 tests, 576 pass, 0 fail, 1 opt-in skip (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errors.
