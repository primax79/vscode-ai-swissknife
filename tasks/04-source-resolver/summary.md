# 04 — Source resolver (git-custom + local-folder) — Summary

> **Closed on:** 2026-10-27 (registry tidy; verifier ai-coding-tools-c1)  
> **Initiative:** 04 — Source resolver (git-custom + local-folder)  
> **Status:** ✅ Done and merged into main

Summary written at closure from the plan and the git history; the per-task specs in this folder hold the detail.

## What was built

- **04.1 Format detection + local-folder resolver** — merged 6b6c5fe 2026-08-18; commit 42e92f4. Walk a directory tree without requiring a manifest (`findSkillDirs`) and resolve `local-folder` sources into `Package[]` containing `skill` artifacts.
- **04.2 git-custom resolver** — merged 7904ab6 2026-08-18; commit 24be057. Resolve `git-custom` sources by cloning/fetching into a local cache directory with branch/tag/commit pinning and reusing `04.1`'s format detection.
- **04.3 Resolver hardening + portable fixtures** — merged ad662b7 2026-08-19; commit 1ca2e87. Return `SourceResolution { packages, diagnostics }` from resolvers, serialize Git checkout and content reads under one mutex, and replace machine-specific test paths with committed fixtures.

## Verification

- Every task's work is merged into `main` (evidence: the commits named above, from `git log --grep '<id>'`).
- `npm test` on `main` at 5e85109 (2026-10-27): 577 tests, 576 pass, 0 fail, 1 opt-in skip (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errors.
