# 25 — Move action + Promote disambiguation fix — Implementation plan

> **Derived from spec:** [`../specs/phase-6-spec.md`](../specs/phase-6-spec.md) §4.3, §4.4

Tasks (each = one commit):

## Tasks

### 25.1 - Discovery: collect all match candidates

- **Status:** `delivered` (merged 7059e75 2026-09-07; commit 34095c3) · **Short:** Collect all discovery match candidates · **Size:** M · **Depends on:** 14 · **Spec:** [25.1-discovery-candidates.md](25.1-discovery-candidates.md)
- **Goal:** Change the discovery matching loop from a single overwritten `match` to a `candidates` list scanning all 5 source types and all packages in each source.

### 25.2 - Promote UI: candidate-based visibility + disambiguation

- **Status:** `delivered` (merged e920b8e 2026-09-08; commit 5154eb9) · **Short:** Promote candidate disambiguation · **Size:** M · **Depends on:** 25.1 · **Spec:** [25.2-promote-ui-fix.md](25.2-promote-ui-fix.md)
- **Goal:** Gate Promote action visibility on candidate count (`:one` / `:many`), prompt with a `QuickPick` when multiple candidates match, and remove the `'local-promotion'` fallback.

### 25.3 - promoteAllIdentical: skip multi-candidate items

- **Status:** `delivered` (merged e920b8e 2026-09-08; absorbed into commit 5154eb9) · **Short:** Skip multi-candidate bulk promote · **Size:** S · **Depends on:** 25.1, 25.2 · **Spec:** [25.3-promote-all-identical-fix.md](25.3-promote-all-identical-fix.md)
- **Goal:** Make the Dashboard's `promoteAllIdentical` bulk-promote path act only on single-candidate items and report multi-candidate items as skipped.

### 25.4 - Move primitives: removeMcpServer adapter method + soft-delete helper

- **Status:** `delivered` (merged 6958726 2026-09-07; commit c188f3d) · **Short:** Move and soft-delete primitives · **Size:** M · **Depends on:** 10, 21 · **Spec:** [25.4-move-primitives.md](25.4-move-primitives.md)
- **Goal:** Add `removeMcpServer(id, loc)` to the `Adapter` interface and all 5 adapters, and add `softDeletePath` in `src/engine/softDelete.ts` to move file/directory artifacts into `.ai-swissknife/_deleted/`.

### 25.5 - "Move to..." command

- **Status:** `delivered` (merged f5abc82 2026-09-08; commit e1fb1ba) · **Short:** Move to command · **Size:** M · **Depends on:** 18, 25.4 · **Spec:** [25.5-move-command.md](25.5-move-command.md)
- **Goal:** Wire the `moveItem` ("Move to...") command in `installedView.ts` using `planSync` for the target install and `25.4`'s primitives for origin removal with `manual-recovery-required` on partial failure.

## Task order and gating

- **25.1 gates 25.2 gates 25.3** — the Promote fix chain.
- **25.4 gates 25.5** — the Move primitives chain, independent of the Promote chain.
- 25.1-25.3 and 25.4-25.5 can be dispatched in parallel (two independent worktrees) since they touch different files (`discovery.ts`/`package.json`/`dashboard.ts` vs. `adapters/*.ts`/`installedView.ts`).
