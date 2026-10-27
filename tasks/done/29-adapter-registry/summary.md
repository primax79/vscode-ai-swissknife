# 29 — Adapter registry & enabled-assistants config — Summary

> **Closed on:** 2026-10-27 (registry tidy; verifier ai-coding-tools-c1)  
> **Initiative:** 29 — Adapter registry & enabled-assistants config  
> **Status:** ✅ Done and merged into main

Summary written at closure from the plan and the git history; the per-task specs in this folder hold the detail.

## What was built

- **29.1 `Adapter` gains `displayName`/`iconId`** — merged 4d7d654 2026-09-08. Add `displayName` and `iconId` descriptive fields directly onto the `Adapter` interface and its five adapter implementations.
- **29.2 `src/adapters/registry.ts`** — merged de6c9f3 2026-09-08. Create `src/adapters/registry.ts` as the single source of truth exporting `ALL_ADAPTERS`, `getAdapter`, and `getAdapterWithHomeRoot`.
- **29.3 Migrate every duplicated adapter-selection site** — merged 8cb71e5 2026-09-08. Delete duplicated `getAdapter()` copies and assistant literal arrays across the codebase and replace them with calls into `src/adapters/registry.ts`.
- **29.4 Enabled-assistants VS Code setting** — merged c2be2a0 2026-09-08. Add `aiSwissknife.enabledAssistants` VS Code configuration, `getEnabledAdapters()`, and registry-driven sidebar view registration with per-view `when` context keys.
- **29.5 "Configure enabled assistants" command** — merged 80a9bd8 2026-09-08. Add the `aiSwissknife.configureEnabledAssistants` multi-select QuickPick command and reshape `aiSwissknife.enabledAssistants` to an object of booleans.

## Verification

- Every task's work is merged into `main` (evidence: the commits named above, from `git log --grep '<id>'`).
- `npm test` on `main` at 5e85109 (2026-10-27): 577 tests, 576 pass, 0 fail, 1 opt-in skip (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errors.
