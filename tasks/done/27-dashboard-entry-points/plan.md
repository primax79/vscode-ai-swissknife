# 27 — Nuovi punti di accesso alla Dashboard — Piano di implementazione

> **Derivato dalla specifica:** [`../specs/phase-6-spec.md`](../../specs/phase-6-spec.md) §4.6

## Tasks

## Ordine dei task e dipendenze

- **27.1 non ha dipendenze in questa fase** — avviarlo immediatamente.
- **27.2 dipende da 26.1** (richiede l'esistenza della barra dei filtri/breadcrumb prima di potervi aggiungere una dimensione `Source`).

## Chiusi

### 27.1 - Funzione condivisa di conteggio elementi in sospeso + elemento nella barra di stato

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Conteggi barra di stato · **Size:** S · **Depends on:** 22 · **Use cases:** UC020 · **Spec:** [27.1-status-bar.md](27.1-status-bar.md)
- **Goal:** Fornire un elemento persistente nella barra di stato come punto di accesso alla Dashboard supportato da una funzione condivisa che calcola su richiesta i conteggi dei suggerimenti non soddisfatti e degli aggiornamenti disponibili.

### 27.2 - Azione "Open in Dashboard" per sorgente

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Salto filtrato per sorgente · **Size:** S · **Depends on:** 26.1 · **Use cases:** UC020 · **Spec:** [27.2-source-filtered-jump.md](27.2-source-filtered-jump.md)
- **Goal:** Mostrare la Dashboard con un filtro `{ sourceId, sourceScope }` pre-applicato come chip rimovibile nel breadcrumb a partire da un'azione inline/contestuale su `SourceItem`.
