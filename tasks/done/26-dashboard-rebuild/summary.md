# 26 — Ricostruzione della Dashboard: tabella unificata, filtri, dettaglio — Riepilogo

> **Closed on:** 2026-10-27 (riordino del registro; verificatore ai-coding-tools-c1)  
> **Initiative:** 26 — Ricostruzione della Dashboard: tabella unificata, filtri, dettaglio  
> **Status:** ✅ Completata e integrata in main

Riepilogo scritto alla chiusura a partire dal piano e dalla cronologia git; le specifiche per singolo task in questa cartella contengono i dettagli.

## Cosa è stato realizzato

- **26.1 Tabella unificata + barra dei filtri + breadcrumb** — integrato 765f5d7 2026-09-07. Sostituire le due tabelle strutturalmente diverse della Dashboard (elementi gestiti vs. non gestiti) con un unico modello di riga unificato, un singolo badge di stato e una barra dei filtri Environment/Scope/Membership/Kind/ricerca con breadcrumb a chip rimovibili.
- **26.2 Pannello di dettaglio per elemento + gestori di azioni basati su valore** — integrato c1c85d7 2026-09-08. Aggiungere un protocollo di messaggi webview richiesta/risposta affinché la selezione di una riga apra una sezione di dettaglio che mostri origine, disponibilità del diff, presenza cross-framework e gestori di azioni Copy/Move/Promote/Edit basati su valore.

## Verification

- Il lavoro di ogni task è integrato in `main` (evidenza: i commit indicati sopra, da `git log --grep '<id>'`).
- `npm test` su `main` a 5e85109 (2026-10-27): 577 test, 576 superati, 0 falliti, 1 saltato opzionale (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errori.
