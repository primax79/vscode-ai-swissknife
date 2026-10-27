# 25 — Move action + Promote disambiguation fix — Summary

> **Closed on:** 2026-10-27 (registry tidy; verifier ai-coding-tools-c1)  
> **Initiative:** 25 — Move action + Promote disambiguation fix  
> **Status:** ✅ Done and merged into main

Summary written at closure from the plan and the git history; the per-task specs in this folder hold the detail.

## What was built

- **25.1 Discovery: collect all match candidates** — merged 7059e75 2026-09-07; commit 34095c3. Change the discovery matching loop from a single overwritten `match` to a `candidates` list scanning all 5 source types and all packages in each source.
- **25.2 Promote UI: candidate-based visibility + disambiguation** — merged e920b8e 2026-09-08; commit 5154eb9. Gate Promote action visibility on candidate count (`:one` / `:many`), prompt with a `QuickPick` when multiple candidates match, and remove the `'local-promotion'` fallback.
- **25.3 promoteAllIdentical: skip multi-candidate items** — merged e920b8e 2026-09-08; absorbed into commit 5154eb9. Make the Dashboard's `promoteAllIdentical` bulk-promote path act only on single-candidate items and report multi-candidate items as skipped.
- **25.4 Move primitives: removeMcpServer adapter method + soft-delete helper** — merged 6958726 2026-09-07; commit c188f3d. Add `removeMcpServer(id, loc)` to the `Adapter` interface and all 5 adapters, and add `softDeletePath` in `src/engine/softDelete.ts` to move file/directory artifacts into `.ai-swissknife/_deleted/`.
- **25.5 "Move to..." command** — merged f5abc82 2026-09-08; commit e1fb1ba. Wire the `moveItem` ("Move to...") command in `installedView.ts` using `planSync` for the target install and `25.4`'s primitives for origin removal with `manual-recovery-required` on partial failure.

## Verification

- Every task's work is merged into `main` (evidence: the commits named above, from `git log --grep '<id>'`).
- `npm test` on `main` at 5e85109 (2026-10-27): 577 tests, 576 pass, 0 fail, 1 opt-in skip (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errors.
