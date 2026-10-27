# 27 — Nuovi punti di accesso alla Dashboard — Riepilogo

> **Closed on:** 2026-10-27 (riordino del registro; verificatore ai-coding-tools-c1)  
> **Initiative:** 27 — Nuovi punti di accesso alla Dashboard  
> **Status:** ✅ Completata e integrata in main

Riepilogo scritto alla chiusura a partire dal piano e dalla cronologia git; le specifiche per singolo task in questa cartella contengono i dettagli.

## Cosa è stato realizzato

- **27.1 Funzione condivisa di conteggio elementi in sospeso + elemento nella barra di stato** — integrato a11e330 2026-09-07. Fornire un elemento persistente nella barra di stato come punto di accesso alla Dashboard supportato da una funzione condivisa che calcola su richiesta i conteggi dei suggerimenti non soddisfatti e degli aggiornamenti disponibili.
- **27.2 Azione "Open in Dashboard" per sorgente** — integrato 22a5a0f 2026-09-08. Mostrare la Dashboard con un filtro `{ sourceId, sourceScope }` pre-applicato come chip rimovibile nel breadcrumb a partire da un'azione inline/contestuale su `SourceItem`.

## Verification

- Il lavoro di ogni task è integrato in `main` (evidenza: i commit indicati sopra, da `git log --grep '<id>'`).
- `npm test` su `main` a 5e85109 (2026-10-27): 577 test, 576 superati, 0 falliti, 1 saltato opzionale (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errori.
