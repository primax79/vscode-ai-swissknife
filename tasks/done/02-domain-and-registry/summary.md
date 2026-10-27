# 02 — Domain types + registry store — Summary

> **Closed on:** 2026-10-27 (registry tidy; verifier ai-coding-tools-c1)  
> **Initiative:** 02 — Domain types + registry store  
> **Status:** ✅ Done and merged into main

Summary written at closure from the plan and the git history; the per-task specs in this folder hold the detail.

## What was built

- **02.1 Core domain types** — merged eb779ca 2026-08-18. Define every core entity from the spec (`AssistantId`, `ItemKind`, `Scope`, `Source`, `Package`, `Artifact`, `ManagedInstallation`, `ObservedArtifact`) as TypeScript interfaces in `src/domain/types.ts`.
- **02.2 Registry store (read/write JSON, global + project)** — merged 6b6c5fe 2026-08-18; commit 7c2c036. Implement pure-Node atomic JSON read/write functions for the registry at global and project scopes.
- **02.3 Persistence and resolved-artifact model (hardening)** — merged 29fe38b 2026-08-19. Split persistence into shareable `manifest.json` (`DesiredSource`, `desiredInstallations`) and machine-local `state.json` under `.ai-swissknife`, and add typed `ResolvedArtifact<CanonicalSkill>` content resolution and a shared Git cache mutex.

## Verification

- Every task's work is merged into `main` (evidence: the commits named above, from `git log --grep '<id>'`).
- `npm test` on `main` at 5e85109 (2026-10-27): 577 tests, 576 pass, 0 fail, 1 opt-in skip (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errors.
