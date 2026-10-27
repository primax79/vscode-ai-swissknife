# 32 — Dashboard: scheletro strutturale — Riepilogo

> **Closed on:** 2026-10-27 (riordino del registro; verificatore ai-coding-tools-c1)  
> **Initiative:** 32 — Dashboard: scheletro strutturale  
> **Status:** ✅ Completata e integrata in main

Riepilogo scritto alla chiusura a partire dal piano e dalla cronologia git; le specifiche per singolo task in questa cartella contengono i dettagli.

## Cosa è stato realizzato

- **32.1 Cablaggio dei provider** — integrato 57b1aac 2026-09-08. Passare `SourcesTreeDataProvider`, `AvailableTreeDataProvider` e una callback di refresh incrociato a `DashboardPanel` e aggiornare i punti di chiamata in `extension.ts`.
- **32.2 Guscio di navigazione a sezioni + punto di accesso New Artifact** — integrato 01614ea 2026-09-08. Aggiungere i tab di sezione di primo livello (Overview, Installed, Sources & Catalog, Recommendations) e il punto di accesso `+ New Artifact`, suddividendo `getHtml()` in template per singola sezione.
- **32.3 Modello di aggiornamento incrementale** — integrato b5316d8 2026-09-08. Sostituire la riassegnazione integrale di `webview.html` al refresh con un singolo rendering iniziale del guscio e aggiornamenti incrementali del DOM guidati da `postMessage`.

## Verification

- Il lavoro di ogni task è integrato in `main` (evidenza: i commit indicati sopra, da `git log --grep '<id>'`).
- `npm test` su `main` a 5e85109 (2026-10-27): 577 test, 576 superati, 0 falliti, 1 saltato opzionale (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errori.
