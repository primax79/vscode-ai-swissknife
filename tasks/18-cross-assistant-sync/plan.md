# 18 — Cross-assistant sync — Implementation plan

> **Derived from spec:** [`../specs/phase-4-spec.md`](../specs/phase-4-spec.md) §4 · [`../../SPEC.md`](../../SPEC.md) §3.5

Tasks (each = one commit):

1. **[18.1 — `planSync` engine core](18.1-sync-engine-core.md)**: implement `planSync` in a new `src/engine/sync.ts`, reusing the existing per-kind translators and producing the same `SupportedInstallPlan`/`UnsupportedInstallPlan` shape `planInstall` already produces.
2. **[18.2 — Conflict policy & on-the-fly promotion](18.2-sync-conflict-and-promotion.md)**: add a skip/overwrite/cancel conflict prompt reusable for single-item and batch sync, and support syncing an `ObservedArtifact` by promoting it first via the existing promotion engine (initiative 14).
3. **[18.3 — "Copy to..." UI action](18.3-sync-ui-integration.md)**: add the sync action to Installed view and Dashboard, target assistant/scope picker, batch sync, and verify.
