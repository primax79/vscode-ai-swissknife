# 34 — Dashboard: Recommendations + Installed action parity — Summary

> **Closed on:** 2026-10-27 (registry tidy; verifier ai-coding-tools-c1)  
> **Initiative:** 34 — Dashboard: Recommendations + Installed action parity  
> **Status:** ✅ Done and merged into main

Summary written at closure from the plan and the git history; the per-task specs in this folder hold the detail.

## What was built

- **34.1 Recommendations section** — merged 0ab3fc1 2026-09-08. Surface `resolveRecommendations` `pending` and `broken` buckets in the Dashboard Recommendations tab with install-one, install-all, and unrecommend actions.
- **34.2 Uninstall + Update-to-latest in detail panel** — merged 7e94ce1 2026-09-08. Extend the Installed detail panel with Uninstall and Update-to-latest actions using server-side re-resolution by stable composite identity key.
- **34.3 Cross-refresh wiring** — merged d546732 2026-09-09. Audit and ensure every Dashboard-triggered state mutation refreshes the status bar and sidebar tree providers.

## Verification

- Every task's work is merged into `main` (evidence: the commits named above, from `git log --grep '<id>'`).
- `npm test` on `main` at 5e85109 (2026-10-27): 577 tests, 576 pass, 0 fail, 1 opt-in skip (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errors.
