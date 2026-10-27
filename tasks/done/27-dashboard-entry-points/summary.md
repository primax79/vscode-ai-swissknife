# 27 — New Dashboard entry points — Summary

> **Closed on:** 2026-10-27 (registry tidy; verifier ai-coding-tools-c1)  
> **Initiative:** 27 — New Dashboard entry points  
> **Status:** ✅ Done and merged into main

Summary written at closure from the plan and the git history; the per-task specs in this folder hold the detail.

## What was built

- **27.1 Shared pending-count function + status bar item** — merged a11e330 2026-09-07. Provide a persistent status bar item as a Dashboard entry point backed by a shared function computing unsatisfied-recommendations and updates-available counts on demand.
- **27.2 "Open in Dashboard" per-source action** — merged 22a5a0f 2026-09-08. Reveal the Dashboard with a `{ sourceId, sourceScope }` filter pre-applied as a removable breadcrumb chip from an inline/context action on `SourceItem`.

## Verification

- Every task's work is merged into `main` (evidence: the commits named above, from `git log --grep '<id>'`).
- `npm test` on `main` at 5e85109 (2026-10-27): 577 tests, 576 pass, 0 fail, 1 opt-in skip (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errors.
