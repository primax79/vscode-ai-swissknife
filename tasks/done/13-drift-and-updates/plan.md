# 13 — Rilevamento di drift e aggiornamenti — Piano di implementazione

> **Derived from spec:** [`../specs/phase-3-spec.md`](../../specs/phase-3-spec.md) · [`../../SPEC.md`](../../../SPEC.md)

Task (ciascuno = un commit):

## Tasks

## Closed

### 13.1 - Motore di analisi del drift

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Motore analisi drift locale · **Size:** M · **Depends on:** 12 · **Use cases:** UC007 · **Spec:** [13.1-drift-analyzer.md](13.1-drift-analyzer.md)
- **Goal:** Implementare `analyzeLocalDrift` in `src/engine/drift.ts` verificando l'esistenza su disco e confrontando l'hash del contenuto canonico live su disco con `installation.contentHash`.

### 13.2 - Verificatore di aggiornamenti upstream

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Verificatore aggiornamenti upstream · **Size:** M · **Depends on:** 13.1 · **Use cases:** UC007 · **Spec:** [13.2-update-checker.md](13.2-update-checker.md)
- **Goal:** Implementare `checkForUpstreamUpdate` risolvendo l'ultima revisione sorgente e l'hash del contenuto per rilevare `update-available` o `modified-and-update-available`.

### 13.3 - Indicatori di stato UI e azione di aggiornamento

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** UI drift e comando update · **Size:** S · **Depends on:** 13.2 · **Use cases:** UC007 · **Spec:** [13.3-drift-ui.md](13.3-drift-ui.md)
- **Goal:** Mostrare badge e icone dello stato di drift nella vista Installed e fornire i comandi `Update Item` e `Check Drift`.
