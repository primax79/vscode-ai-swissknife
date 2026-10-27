# 17 — Form editor webview — Implementation plan

> **Derived from spec:** [`../specs/phase-4-spec.md`](../specs/phase-4-spec.md) §3 · [`../../SPEC.md`](../../SPEC.md) §3.4, §4

Tasks (each = one commit):

## Tasks

### 17.1 - Field schema registry & webview scaffold

- **Status:** `delivered` (merged 32587b2 2026-08-19; commit 1690fcb) · **Short:** Form schema and panel scaffold · **Size:** M · **Depends on:** 08, 09, 10, 16 · **Spec:** [17.1-form-schema-and-panel.md](17.1-form-schema-and-panel.md)
- **Goal:** Implement per-kind field schemas and `FormEditorPanel` in `src/ui/formEditor.ts` with `load`, `save`, and `cancel` message handling.

### 17.2 - Structured form, validation & direct adapter read/write

- **Status:** `delivered` (merged 32587b2 2026-08-19; commit 1690fcb) · **Short:** Form fields and adapter IO · **Size:** M · **Depends on:** 17.1 · **Spec:** [17.2-form-fields-and-io.md](17.2-form-fields-and-io.md)
- **Goal:** Render structured form fields per kind, validate against canonical models, read/write through adapter codecs preserving `extraFields`, and update `state.json`'s `contentHash` on save.

### 17.3 - Create/edit commands & integration

- **Status:** `delivered` (merged 32587b2 2026-08-19; commit 1690fcb) · **Short:** Form editor commands and UI · **Size:** S · **Depends on:** 17.2 · **Spec:** [17.3-form-editor-integration.md](17.3-form-editor-integration.md)
- **Goal:** Register `aiSwissknife.createArtifact` and `aiSwissknife.editArtifact` commands and wire the Edit action from the Installed view and Dashboard.
