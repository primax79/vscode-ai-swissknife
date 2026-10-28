# 17 — Webview dell'editor a modulo — Piano di implementazione

> **Derived from spec:** [`../specs/phase-4-spec.md`](../../specs/phase-4-spec.md) §3 · [`../../SPEC.md`](../../../SPEC.md) §3.4, §4

Task (ciascuno = un commit):

## Tasks

## Closed

### 17.1 - Registro degli schemi dei campi e struttura della webview

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Schema modulo e struttura pannello · **Size:** M · **Depends on:** 08, 09, 10, 16 · **Spec:** [17.1-form-schema-and-panel.md](17.1-form-schema-and-panel.md)
- **Goal:** Implementare gli schemi dei campi per tipo e `FormEditorPanel` in `src/ui/formEditor.ts` con la gestione dei messaggi `load`, `save` e `cancel`.

### 17.2 - Modulo strutturato, validazione e lettura/scrittura diretta tramite adapter

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Campi modulo e I/O adapter · **Size:** M · **Depends on:** 17.1 · **Spec:** [17.2-form-fields-and-io.md](17.2-form-fields-and-io.md)
- **Goal:** Mostrare i campi strutturati del modulo per tipo, validare rispetto ai modelli canonici, leggere/scrivere tramite i codec degli adapter preservando `extraFields` e aggiornare in `state.json` il valore `contentHash` al salvataggio.

### 17.3 - Comandi di creazione/modifica e integrazione

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Comandi e UI form editor · **Size:** S · **Depends on:** 17.2 · **Spec:** [17.3-form-editor-integration.md](17.3-form-editor-integration.md)
- **Goal:** Registrare i comandi `aiSwissknife.createArtifact` e `aiSwissknife.editArtifact` e collegare l'azione Edit dalla vista Installed e dalla Dashboard.
