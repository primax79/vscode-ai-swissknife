# 01 — Project scaffold — Summary

> **Closed on:** 2026-10-27 (registry tidy; verifier ai-coding-tools-c1)  
> **Initiative:** 01 — Project scaffold  
> **Status:** ✅ Done and merged into main

Summary written at closure from the plan and the git history; the per-task specs in this folder hold the detail.

## What was built

- **01.1 package.json + build tooling** — merged 30246bc 2026-08-18. Create `package.json`, `tsconfig.json`, and an esbuild-based build script so the extension can compile.
- **01.2 Extension entry point + activation** — merged ae7e2bb 2026-08-18. Provide a minimal `src/extension.ts` that activates cleanly in the Extension Development Host with the folder layout later initiatives fill in.
- **01.3 Lint/format config + npm scripts sanity check** — merged 9844f67 2026-08-18. Configure working `eslint`, `typecheck`, and `build` scripts as the standard verification gate.

## Verification

- Every task's work is merged into `main` (evidence: the commits named above, from `git log --grep '<id>'`).
- `npm test` on `main` at 5e85109 (2026-10-27): 577 tests, 576 pass, 0 fail, 1 opt-in skip (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errors.
