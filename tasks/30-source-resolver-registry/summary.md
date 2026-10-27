# 30 — Source-resolver registry — Summary

> **Closed on:** 2026-10-27 (registry tidy; verifier ai-coding-tools-c1)  
> **Initiative:** 30 — Source-resolver registry  
> **Status:** ✅ Done and merged into main

Summary written at closure from the plan and the git history; the per-task specs in this folder hold the detail.

## What was built

- **30.1 `SourceResolver` interface** — merged cbfbb8f 2026-09-08. Define the shared `SourceResolver` interface (`type`, `displayName`, `iconThemeId`, `resolve`, `resolveArtifactContent`) in `src/sources/types.ts`.
- **30.2 Wrap the five resolver modules** — merged f2bda26 2026-09-08. Export one `SourceResolver`-conforming object per source type wrapping each module's existing functions additively.
- **30.3 `src/sources/registry.ts` + migrate dispatch sites** — merged 06a5a21 2026-09-08. Aggregate the five source resolvers into `src/sources/registry.ts` and replace `source.type` dispatch chains in `discovery.ts`, `drift.ts`, and `availableView.ts`.
- **30.4 Migrate `sourcesView.ts`'s icon switch** — merged 0196694 2026-09-08. Replace `sourcesView.ts`'s `getSourceTypeIcon` switch with an `iconThemeId` lookup in `src/sources/registry.ts`.

## Verification

- Every task's work is merged into `main` (evidence: the commits named above, from `git log --grep '<id>'`).
- `npm test` on `main` at 5e85109 (2026-10-27): 577 tests, 576 pass, 0 fail, 1 opt-in skip (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errors.
