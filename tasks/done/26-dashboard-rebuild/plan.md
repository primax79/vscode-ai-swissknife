# 26 — Ricostruzione della Dashboard: tabella unificata, filtri, dettaglio — Piano di implementazione

> **Derivato dalla specifica:** [`../specs/phase-6-spec.md`](../../specs/phase-6-spec.md) §4.5

## Tasks

## Ordine dei task e dipendenze

- **26.1 non ha dipendenze da 23-25** — avviarlo immediatamente in parallelo ad essi.
- **26.2 dipende da 26.1 e da 23.3 (ricerca cross-framework), 24.1 (disponibilità del diff) e 25.2/25.5 (azioni Promote/Move)** — è il punto di integrazione in cui tali funzionalità approdano nella UI e deve attenderle tutte.

## Chiusi

### 26.1 - Tabella unificata + barra dei filtri + breadcrumb

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Tabella unificata e filtri · **Size:** M · **Depends on:** 16 · **Use cases:** UC017, UC020 · **Spec:** [26.1-unified-table-and-filters.md](26.1-unified-table-and-filters.md)
- **Goal:** Sostituire le due tabelle strutturalmente diverse della Dashboard (elementi gestiti vs. non gestiti) con un unico modello di riga unificato, un singolo badge di stato e una barra dei filtri Environment/Scope/Membership/Kind/ricerca con breadcrumb a chip rimovibili.

### 26.2 - Pannello di dettaglio per elemento + gestori di azioni basati su valore

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Pannello di dettaglio per elemento · **Size:** M · **Depends on:** 26.1, 23, 24, 25 · **Use cases:** UC017, UC020 · **Spec:** [26.2-detail-panel.md](26.2-detail-panel.md)
- **Goal:** Aggiungere un protocollo di messaggi webview richiesta/risposta affinché la selezione di una riga apra una sezione di dettaglio che mostri origine, disponibilità del diff, presenza cross-framework e gestori di azioni Copy/Move/Promote/Edit basati su valore.
