# 18 — Sincronizzazione tra assistenti — Piano di implementazione

> **Derived from spec:** [`../specs/phase-4-spec.md`](../../specs/phase-4-spec.md) §4 · [`../../SPEC.md`](../../../SPEC.md) §3.5

Task (ciascuno = un commit):

## Tasks

## Closed

### 18.1 - Nucleo del motore `planSync`

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Nucleo del motore planSync · **Size:** M · **Depends on:** 06, 13, 14 · **Spec:** [18.1-sync-engine-core.md](18.1-sync-engine-core.md)
- **Goal:** Implementare `planSync` in `src/engine/sync.ts` riutilizzando i traduttori per tipo per produrre un `PreparedInstall` a partire da un artefatto esistente installato o osservato.

### 18.2 - Politica dei conflitti e promozione al volo

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Conflitti sync e promozione · **Size:** S · **Depends on:** 18.1 · **Spec:** [18.2-sync-conflict-and-promotion.md](18.2-sync-conflict-and-promotion.md)
- **Goal:** Aggiungere la gestione dei conflitti per la sincronizzazione singola e batch e supportare la sincronizzazione di un `ObservedArtifact` promuovendolo tramite `promoteObservedArtifact`.

### 18.3 - Azione UI "Copy to..."

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Azione UI Copy to · **Size:** S · **Depends on:** 16, 18.2 · **Spec:** [18.3-sync-ui-integration.md](18.3-sync-ui-integration.md)
- **Goal:** Collegare l'azione `syncItem` ("Copy to...") e il selettore di assistente/scope di destinazione nella vista Installed e nella Dashboard.
