# 13 — Drift & update detection — Implementation plan

> **Derived from spec:** [`../specs/phase-3-spec.md`](../specs/phase-3-spec.md) · [`../../SPEC.md`](../../SPEC.md)

Tasks (each = one commit):

## Tasks

## Closed

### 13.1 - Drift analyzer engine

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Local drift analyzer engine · **Size:** M · **Depends on:** 12 · **Spec:** [13.1-drift-analyzer.md](13.1-drift-analyzer.md)
- **Goal:** Implement `analyzeLocalDrift` in `src/engine/drift.ts` checking disk existence and comparing live disk canonical content hash against `installation.contentHash`.

### 13.2 - Upstream update checker

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Upstream update checker · **Size:** M · **Depends on:** 13.1 · **Spec:** [13.2-update-checker.md](13.2-update-checker.md)
- **Goal:** Implement `checkForUpstreamUpdate` resolving the latest source revision and content hash to detect `update-available` or `modified-and-update-available`.

### 13.3 - UI status indicators & update action

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Drift UI and update command · **Size:** S · **Depends on:** 13.2 · **Spec:** [13.3-drift-ui.md](13.3-drift-ui.md)
- **Goal:** Render drift status badges and icons in the Installed view and provide `Update Item` and `Check Drift` commands.
