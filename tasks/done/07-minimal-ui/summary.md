# 07 — UI minimale (3 viste) — Riepilogo

> **Closed on:** 2026-10-27 (riordino del registro; verificatore ai-coding-tools-c1)  
> **Initiative:** 07 — UI minimale (3 viste)  
> **Status:** ✅ Completato e unito in main

Riepilogo scritto alla chiusura a partire dal piano e dalla cronologia git; le specifiche per singolo task in questa cartella contengono i dettagli.

## Cosa è stato realizzato

- **07.1 Contenitore Activity Bar + vista Sources** — unito 634b8ee 2026-08-19; commit 1a39b7a. Aggiungere il contenitore dell'Activity Bar `ai-swissknife`, il selettore riutilizzabile della cartella per workspace multi-root e il `SourcesTreeDataProvider` basato sul registro con i comandi di aggiunta/rimozione/ricaricamento.
- **07.2 Vista Available (navigazione + comando di installazione)** — unito 634b8ee 2026-08-19; commit 1a39b7a. Implementare `AvailableTreeDataProvider` mostrando i pacchetti risolti, gli artefatti e le diagnostiche con anteprima e installazione controllata rispetto ai conflitti.
- **07.3 Vista Installed (basata sul registro)** — unito 634b8ee 2026-08-19; commit 1a39b7a. Implementare `InstalledTreeDataProvider` elencando i record `ManagedInstallation` da `state.json` raggruppati per assistente e scope.

## Verification

- Il lavoro di ogni task è stato unito in `main` (evidenza: i commit indicati sopra, da `git log --grep '<id>'`).
- `npm test` su `main` a 5e85109 (2026-10-27): 577 test, 576 superati, 0 falliti, 1 saltato opt-in (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errori.
