# 47 — Update all — Summary

> **Closed on:** 2026-10-27 (registry tidy; verifier ai-coding-tools-c1)  
> **Initiative:** 47 — Update all  
> **Status:** ✅ Done and merged into main

Summary written at closure from the plan and the git history; the per-task specs in this folder hold the detail.

## What was built

- **47.1 Engine: `planUpdate` extracted from the UI, `planUpdateAll` / `applyUpdateAll`** — merged fe12536 2026-10-08. Extract `planUpdate` into `src/engine/update.ts` and implement `planUpdateAll` and `applyUpdateAll` with once-per-source resolution and trash backup for locally modified items.
- **47.4 Drift check resolves each source once (was once per item: N git fetches)** — merged 0b2e558 2026-10-09. Add `checkDriftForAll` in `src/engine/drift.ts` so a drift check over multiple installations resolves each source once per run instead of once per item.
- **47.3 Hold an item out of Update all (flag, engine bucket, UI toggle and marker)** — committed 26fde17 on a task branch, merged into main in 5e85109 (2026-10-27). Add an optional `held` flag on `ManagedInstallation`, a `held` bucket in `planUpdateAll`, and Hold/Release UI toggles and pin markers so held items are skipped by Update all.
- **47.2 UI: command, per-environment sidebar button, Dashboard button on the filtered selection, summary modal and result report** — merged 553a5d6 2026-10-09. Add the `aiSwissknife.updateAll` command, per-environment sidebar buttons, and Dashboard toolbar/stat-card triggers with a confirmation summary modal and per-item result report.

## Verification

- Every task's work is merged into `main` (evidence: the commits named above, from `git log --grep '<id>'`).
- `npm test` on `main` at 5e85109 (2026-10-27): 577 tests, 576 pass, 0 fail, 1 opt-in skip (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errors.
