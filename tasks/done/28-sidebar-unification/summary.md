# Initiative 28 — Sidebar Navigation Unification — Summary

> **Closed on:** 2026-10-27 (registry tidy; verifier ai-coding-tools-c1)  
> **Initiative:** Initiative 28 — Sidebar Navigation Unification  
> **Status:** ✅ Done and merged into main

Summary written at closure from the plan and the git history; the per-task specs in this folder hold the detail.

## What was built

- **28.1 Merge Sources + Available into one tree** — merged 979e456 2026-09-08. Unify `SourcesTreeDataProvider` and `AvailableTreeDataProvider` into a single sidebar tree so expanding a source shows its catalog content directly without select-to-filter coupling.
- **28.2 Installed kind-grouping** — merged 979e456 2026-09-08. Add an intermediate per-kind grouping level (`KindGroupItem`) under each assistant/scope group in `InstalledTreeDataProvider`.

## Verification

- Every task's work is merged into `main` (evidence: the commits named above, from `git log --grep '<id>'`).
- `npm test` on `main` at 5e85109 (2026-10-27): 577 tests, 576 pass, 0 fail, 1 opt-in skip (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errors.
