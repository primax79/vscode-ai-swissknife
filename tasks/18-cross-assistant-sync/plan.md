# 18 — Cross-assistant sync — Implementation plan

> **Derived from spec:** [`../specs/phase-4-spec.md`](../specs/phase-4-spec.md) §4 · [`../../SPEC.md`](../../SPEC.md) §3.5

Tasks (each = one commit):

## Tasks

### 18.1 - `planSync` engine core

- **Status:** `delivered` (merged cd26783 2026-08-19; commit 671e18e) · **Short:** planSync engine core · **Size:** M · **Depends on:** 06, 13, 14 · **Spec:** [18.1-sync-engine-core.md](18.1-sync-engine-core.md)
- **Goal:** Implement `planSync` in `src/engine/sync.ts` reusing per-kind translators to produce a `PreparedInstall` from an existing installed or observed artifact.

### 18.2 - Conflict policy & on-the-fly promotion

- **Status:** `delivered` (merged cd26783 2026-08-19; commit 671e18e) · **Short:** Sync conflict and promotion · **Size:** S · **Depends on:** 18.1 · **Spec:** [18.2-sync-conflict-and-promotion.md](18.2-sync-conflict-and-promotion.md)
- **Goal:** Add conflict handling for single and batch sync and support syncing an `ObservedArtifact` by promoting it via `promoteObservedArtifact`.

### 18.3 - "Copy to..." UI action

- **Status:** `delivered` (merged cd26783 2026-08-19; commit 671e18e) · **Short:** Copy to UI action · **Size:** S · **Depends on:** 16, 18.2 · **Spec:** [18.3-sync-ui-integration.md](18.3-sync-ui-integration.md)
- **Goal:** Wire the `syncItem` ("Copy to...") action and target assistant/scope picker into the Installed view and Dashboard.
