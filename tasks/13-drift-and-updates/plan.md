# 13 — Drift & update detection — Implementation plan

> **Derived from spec:** [`../specs/phase-3-spec.md`](../specs/phase-3-spec.md) · [`../../SPEC.md`](../../SPEC.md)

Tasks (each = one commit):

1. **[13.1 — Drift analyzer engine](13.1-drift-analyzer.md)**: implement `analyzeDrift(installation: ManagedInstallation, homeRoot?: string): Promise<DriftReport>` in `src/engine/drift.ts` checking disk existence and computing live disk hash vs `installation.contentHash`.
2. **[13.2 — Upstream update checker](13.2-update-checker.md)**: implement `checkForUpdates(installation: ManagedInstallation, sources: Source[]): Promise<DriftReport>` resolving latest source revision and content hash to detect `update-available` or `modified-and-update-available`.
3. **[13.3 — UI status indicators & update action](13.3-drift-ui.md)**: render drift status badges/icons in Installed view and provide `AI Swissknife: Update Item` and `AI Swissknife: Check Drift` commands.
