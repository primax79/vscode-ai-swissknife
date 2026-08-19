# 17 — Form editor webview — Implementation plan

> **Derived from spec:** [`../specs/phase-4-spec.md`](../specs/phase-4-spec.md) §3 · [`../../SPEC.md`](../../SPEC.md) §3.4, §4

Tasks (each = one commit):

1. **[17.1 — Field schema registry & webview scaffold](17.1-form-schema-and-panel.md)**: implement per-kind field schemas and `FormEditorPanel` in `src/ui/formEditor.ts` (message protocol: `load`, `save`, `cancel`), mirroring `DashboardPanel`'s pattern.
2. **[17.2 — Structured form, validation & direct adapter read/write](17.2-form-fields-and-io.md)**: render fields per kind, validate against the canonical model, read/write through each adapter's own parse/serialize functions (not `planInstall`), preserve `extraFields` in a read-only raw panel, update `state.json`'s content hash on save.
3. **[17.3 — Create/edit commands & integration](17.3-form-editor-integration.md)**: register `aiSwissknife.createArtifact` / `aiSwissknife.editArtifact`, wire the "Edit" action from Installed view and Dashboard, and verify.
