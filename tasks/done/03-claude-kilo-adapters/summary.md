# 03 — Claude + Kilo adapters (skill+rule) — Summary

> **Closed on:** 2026-10-27 (registry tidy; verifier ai-coding-tools-c1)  
> **Initiative:** 03 — Claude + Kilo adapters (skill+rule)  
> **Status:** ✅ Done and merged into main

Summary written at closure from the plan and the git history; the per-task specs in this folder hold the detail.

## What was built

- **03.1 Adapter interface** — merged 6b6c5fe 2026-08-18; commit 391338b. Define the shared `Adapter` contract and canonical in-memory models (`CanonicalSkill`, `CanonicalRule`, `ConversionDiagnostic`) in `src/adapters/types.ts`.
- **03.2 Claude Code adapter** — merged 7904ab6 2026-08-18; commit 00f520c. Implement `ClaudeAdapter` in `src/adapters/claude.ts` covering `skill` and `rule` read/write/list at global and project scopes.
- **03.3 Kilo Code adapter** — merged 57d90dd 2026-08-18. Implement `KiloAdapter` in `src/adapters/kilo.ts` covering `skill` and `rule` read/write/list at global and project scopes.
- **03.4 Shared skill codec, path validation, directory payload (hardening)** — merged 4ee210d 2026-08-19; commit 886bf31. Create a shared skill codec in `src/adapters/codec.ts` that loads the full skill directory payload (`files` + executable modes), validates safe relative paths, and surfaces malformed skills as structured diagnostics.

## Verification

- Every task's work is merged into `main` (evidence: the commits named above, from `git log --grep '<id>'`).
- `npm test` on `main` at 5e85109 (2026-10-27): 577 tests, 576 pass, 0 fail, 1 opt-in skip (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errors.
