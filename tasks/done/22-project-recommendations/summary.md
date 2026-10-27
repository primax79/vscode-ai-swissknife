# 22 — Project-scoped recommended installations — Summary

> **Closed on:** 2026-10-27 (registry tidy; verifier ai-coding-tools-c1)  
> **Initiative:** 22 — Project-scoped recommended installations  
> **Status:** ✅ Done and merged into main

Summary written at closure from the plan and the git history; the per-task specs in this folder hold the detail.

## What was built

- **22.1 Recommend/unrecommend commands + tree decoration** — merged 66952f8 2026-09-07; commit 903c814. Add context-menu actions on Available and Installed items to write or remove `DesiredInstallation` entries in the project manifest with a Recommended decoration and dual-view refresh.
- **22.2 Recommendation resolution engine** — merged 716cdbc 2026-09-07; commit d170427. Implement pure `resolveRecommendations` in `src/engine/recommendations.ts` classifying `desiredInstallations` against `state.json` and source resolution attempts into `satisfied`, `pending`, and `broken`.
- **22.3 "Install Recommended" command + Available-view "Recommended" filter** — merged 0b01b26 2026-09-07; commit 2b45d66. Add the `aiSwissknife.installRecommended` command and the `Recommended` grouping in `AvailableTreeDataProvider` using per-entry target assistant/scope installation.
- **22.4 Workspace-open detection + notification** — merged 1612940 2026-09-07; commit 4252ad6. Wire a local-only unsatisfied-recommendations check on activation offering `Install All`, `Review`, and `Don't ask again for this workspace`.
- **22.5 Git hygiene for the shared manifest** — merged 8ff9218 2026-09-07; commit fde6da7. Ensure `writeManifest` at project scope non-destructively appends the project `state.json` path to an existing `.gitignore`.

## Verification

- Every task's work is merged into `main` (evidence: the commits named above, from `git log --grep '<id>'`).
- `npm test` on `main` at 5e85109 (2026-10-27): 577 tests, 576 pass, 0 fail, 1 opt-in skip (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errors.
