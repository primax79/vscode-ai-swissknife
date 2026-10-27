# 38 — Aggiornamento per singola sorgente — Riepilogo

> **Closed on:** 2026-10-27 (riordino del registro; verificatore ai-coding-tools-c1)  
> **Initiative:** 38 — Aggiornamento per singola sorgente  
> **Status:** ✅ Completata e unita in main

Riepilogo scritto alla chiusura a partire dal piano e dalla cronologia git; le specifiche dei singoli task in questa cartella contengono i dettagli.

## Cosa è stato realizzato

- **38.1 `AvailableProvider.refreshSource` (nuova risoluzione di una singola sorgente, aggiornamento sul posto della cache)** — unito in 19ea67d il 2026-10-08. Aggiungere `AvailableTreeDataProvider.refreshSource(sourceId, scope)` per risolvere nuovamente una singola sorgente, aggiornare sul posto il suo gruppo in cache e ricalcolare le raccomandazioni senza riscaricare le altre sorgenti.
- **38.2 Comando inline nella barra laterale + pulsante sulla riga della Dashboard collegati** — unito in 42d016f il 2026-10-09. Collegare `aiSwissknife.refreshSource` come azione inline sugli elementi sorgente della barra laterale e come pulsante di sola icona `↻` su ogni riga sorgente della Dashboard.

## Verification

- Il lavoro di ogni task è stato unito in `main` (evidenza: i commit indicati sopra, da `git log --grep '<id>'`).
- `npm test` su `main` a 5e85109 (2026-10-27): 577 test, 576 passati, 0 falliti, 1 saltato opt-in (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errori.
