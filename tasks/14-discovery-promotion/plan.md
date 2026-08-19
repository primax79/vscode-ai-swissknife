# 14 — Discovery & promotion — Implementation plan

> **Derived from spec:** [`../specs/phase-3-spec.md`](../specs/phase-3-spec.md) · [`../../SPEC.md`](../../SPEC.md)

Tasks (each = one commit):

1. **[14.1 — Inventory scanner for unmanaged artifacts](14.1-inventory-scanner.md)**: implement `scanInstalledInventory` in `src/engine/discovery.ts` detecting unmanaged `ObservedArtifact`s across all assistants and scopes.
2. **[14.2 — Promotion engine](14.2-promotion-engine.md)**: implement `promoteObservedArtifact` in `src/engine/discovery.ts` computing content hash and persisting to `state.json`.
3. **[14.3 — UI integration](14.3-promotion-ui.md)**: render unmanaged items in Installed view and provide `AI Swissknife: Promote to Managed` command and inline action.
