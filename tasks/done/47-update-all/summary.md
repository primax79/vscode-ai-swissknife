# 47 — Aggiorna tutto (Update all) — Riepilogo

> **Closed on:** 2026-10-27 (riordino del registro; verificatore ai-coding-tools-c1)  
> **Initiative:** 47 — Aggiorna tutto (Update all)  
> **Status:** ✅ Completata e unita in main

Riepilogo scritto alla chiusura a partire dal piano e dalla cronologia git; le specifiche dei singoli task in questa cartella contengono i dettagli.

## Cosa è stato realizzato

- **47.1 Motore: `planUpdate` estratto dalla UI, `planUpdateAll` / `applyUpdateAll`** — unito in fe12536 il 2026-10-08. Estrarre `planUpdate` in `src/engine/update.ts` e implementare `planUpdateAll` e `applyUpdateAll` con risoluzione una sola volta per sorgente e backup nel cestino per gli elementi modificati localmente.
- **47.4 Il controllo di drift risolve ciascuna sorgente una sola volta (prima era una per elemento: N git fetch)** — unito in 0b2e558 il 2026-10-09. Aggiungere `checkDriftForAll` in `src/engine/drift.ts` così che un controllo di drift su più installazioni risolva ciascuna sorgente una sola volta per esecuzione invece di una volta per elemento.
- **47.3 Bloccare (hold) un elemento escludendolo da Update all (flag, contenitore nel motore, toggle e indicatore nella UI)** — committato in 26fde17 su un branch di task, unito in main in 5e85109 (2026-10-27). Aggiungere un flag opzionale `held` su `ManagedInstallation`, un contenitore `held` in `planUpdateAll`, e i toggle UI Hold/Release e gli indicatori a spillo così che gli elementi bloccati vengano saltati da Update all.
- **47.2 UI: comando, pulsante nella barra laterale per ambiente, pulsante nella Dashboard sulla selezione filtrata, modale di riepilogo e report dei risultati** — unito in 553a5d6 il 2026-10-09. Aggiungere il comando `aiSwissknife.updateAll`, i pulsanti nella barra laterale per ambiente e gli attivatori nella barra degli strumenti/scheda statistica della Dashboard con una modale di riepilogo di conferma e un report dei risultati per elemento.

## Verification

- Il lavoro di ogni task è stato unito in `main` (evidenza: i commit indicati sopra, da `git log --grep '<id>'`).
- `npm test` su `main` a 5e85109 (2026-10-27): 577 test, 576 passati, 0 falliti, 1 saltato opt-in (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errori.
