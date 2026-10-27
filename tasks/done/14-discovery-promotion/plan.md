# 14 — Discovery & promotion — Implementation plan

> **Derived from spec:** [`../specs/phase-3-spec.md`](../../specs/phase-3-spec.md) · [`../../SPEC.md`](../../../SPEC.md)

Tasks (each = one commit):

## Tasks

## Closed

### 14.1 - Inventory scanner for unmanaged artifacts

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Unmanaged inventory scanner · **Size:** M · **Depends on:** 13 · **Spec:** [14.1-inventory-scanner.md](14.1-inventory-scanner.md)
- **Goal:** Implement `scanInstalledInventory` in `src/engine/discovery.ts` detecting unmanaged `ObservedArtifact`s across all assistants and scopes and matching them against registered sources.

### 14.2 - Promotion engine

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Unmanaged promotion engine · **Size:** S · **Depends on:** 14.1 · **Spec:** [14.2-promotion-engine.md](14.2-promotion-engine.md)
- **Goal:** Implement `promoteObservedArtifact` in `src/engine/discovery.ts` computing the canonical content hash and persisting a `ManagedInstallation` record in `state.json`.

### 14.3 - UI integration

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Discovery and promotion UI · **Size:** S · **Depends on:** 14.2 · **Spec:** [14.3-promotion-ui.md](14.3-promotion-ui.md)
- **Goal:** Render unmanaged items in the Installed view and provide the `Promote to Managed` command and inline action.
