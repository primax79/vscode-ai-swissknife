# 38 — Per-source refresh — Summary

> **Closed on:** 2026-10-27 (registry tidy; verifier ai-coding-tools-c1)  
> **Initiative:** 38 — Per-source refresh  
> **Status:** ✅ Done and merged into main

Summary written at closure from the plan and the git history; the per-task specs in this folder hold the detail.

## What was built

- **38.1 `AvailableProvider.refreshSource` (single-source re-resolve, in-place cache update)** — merged 19ea67d 2026-10-08. Add `AvailableTreeDataProvider.refreshSource(sourceId, scope)` to re-resolve a single source, update its cached group in place, and recompute recommendations without re-fetching other sources.
- **38.2 Sidebar inline command + Dashboard row button wired to it** — merged 42d016f 2026-10-09. Wire `aiSwissknife.refreshSource` as an inline action on sidebar source items and as an icon-only `↻` button on each Dashboard source row.

## Verification

- Every task's work is merged into `main` (evidence: the commits named above, from `git log --grep '<id>'`).
- `npm test` on `main` at 5e85109 (2026-10-27): 577 tests, 576 pass, 0 fail, 1 opt-in skip (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errors.
