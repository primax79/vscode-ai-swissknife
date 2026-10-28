# 34 — Dashboard: sezione Recommendations + parità delle azioni di Installed — Piano di implementazione

> **Derivato dalla specifica:** [`../specs/phase-9-spec.md`](../../specs/phase-9-spec.md) §1 (obiettivi 2-3), §4, §4.1

**Depends on:** 31 (intera iniziativa, integrata), 32 (intera iniziativa, integrata). Indipendente
dall'Iniziativa 33 — sezioni diverse, nessun codice condiviso — può essere eseguita prima,
dopo o in parallelo ad essa.

Task (ciascuno = un commit):

## Tasks

## Ordine dei task e dipendenze

- **34.1 e 34.2 sono indipendenti tra loro** (sezioni/dati diversi) — avviabili in parallelo.
- **34.3 dipende da entrambi** (è il passaggio di integrazione/verifica su tutto ciò che questa iniziativa e l'Iniziativa 33 hanno aggiunto).

**Nota sulla delega:** pacchettizzazione espansa (secondo `tasks/AGENTS.md`), un file
di task per passaggio di consegne. Indirizzare l'agente al singolo file del task + `specs/phase-9-spec.md`
(§1, §4, §4.1) + `tasks/CONTEXT.md` + i pertinenti file di task dell'Iniziativa 31
per le firme esatte dei metodi `do*` utilizzati.

## Chiusi

### 34.1 - Sezione Recommendations

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Sezione Recommendations della Dashboard · **Size:** M · **Depends on:** 31.3, 32 · **Spec:** [34.1-recommendations-section.md](34.1-recommendations-section.md)
- **Goal:** Esporre per `resolveRecommendations` i bucket `pending` e `broken` nel tab Recommendations della Dashboard con le azioni installa singolo, installa tutti e rimuovi suggerimento.

### 34.2 - Uninstall + Update-to-latest nel pannello di dettaglio

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Uninstall e Update nel dettaglio · **Size:** S · **Depends on:** 31.1, 31.4 · **Spec:** [34.2-uninstall-update-parity.md](34.2-uninstall-update-parity.md)
- **Goal:** Estendere il pannello di dettaglio di Installed con le azioni Uninstall e Update-to-latest usando la nuova risoluzione lato server tramite chiave di identità composita stabile.

### 34.3 - Cablaggio del refresh incrociato

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Verifica refresh incrociato · **Size:** S · **Depends on:** 34.1, 34.2 · **Spec:** [34.3-cross-refresh.md](34.3-cross-refresh.md)
- **Goal:** Verificare e garantire che ogni mutazione di stato attivata dalla Dashboard aggiorni la barra di stato e i tree provider della sidebar.
