# 46 — Accesso CLI a ai-swissknife — Riepilogo

> **Closed on:** 2026-10-27 (riordino del registro; verificatore ai-coding-tools-c1)  
> **Initiative:** 46 — Accesso CLI a ai-swissknife  
> **Status:** ✅ Completata e unita in main

Riepilogo scritto alla chiusura a partire dal piano e dalla cronologia git; le specifiche dei singoli task in questa cartella contengono i dettagli.

## Cosa è stato realizzato

- **46.1 Scheletro della CLI + comandi in sola lettura (sources, catalog, installed, updates, item, plan-install)** — unito in 5b0bc70 il 2026-10-09. Compilare il bundle privo di `vscode` `dist/cli.js` (`ai-swissknife`) con stdout in puro JSON e i comandi in sola lettura `sources`, `catalog`, `installed`, `updates`, `item` e `plan-install`.
- **46.2 Documentazione rivolta agli agenti: blocco AGENTS.md + auto-descrizione `--help --json`** — unito in 88bd55f il 2026-10-09. Aggiungere il comando `describe` leggibile dalle macchine generato dalle definizioni dei comandi e documentare il contratto della CLI e gli esempi in `AGENTS.md`.
- **46.3 Lock inter-processo per lettura-modifica-scrittura di manifest/stato** — unito in e909ede il 2026-10-08. Implementare `withStateLock` in `src/domain/stateLock.ts` con file di lock esclusivi e recupero dei lock obsoleti attorno alle sequenze di lettura-modifica-scrittura di manifest e stato.
- **46.5 `redistribute <path|item>` v1 (installato da una cartella locale; pianificazione preventiva, `--write`)** — unito in 99a127c il 2026-10-09. Aggiungere `planRedistribute`/`applyRedistribute` e il comando CLI `redistribute` per propagare le modifiche da una sorgente `local-folder` registrata a tutte le copie installate (solo pianificazione senza `--write`).
- **46.4 Comandi di scrittura protetti da `--write`: apply-install, uninstall (soft), aggiunta/rimozione sorgente** — unito in b0872cb il 2026-10-09. Aggiungere i comandi di scrittura della CLI con pianificazione preventiva protetti da `--write` (`apply-install`, `uninstall`, `source add/remove`, `update` e `trash list/restore/empty`).

## Verification

- Il lavoro di ogni task è stato unito in `main` (evidenza: i commit indicati sopra, da `git log --grep '<id>'`).
- `npm test` su `main` a 5e85109 (2026-10-27): 577 test, 576 passati, 0 falliti, 1 saltato opt-in (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errori.
