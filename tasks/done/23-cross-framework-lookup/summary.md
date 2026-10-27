# 23 — Ricerca di identità cross-framework + accessor condiviso dei contenuti — Riepilogo

> **Closed on:** 2026-10-27 (riordino del registro; verificatore ai-coding-tools-c1)  
> **Initiative:** 23 — Ricerca di identità cross-framework + accessor condiviso dei contenuti  
> **Status:** ✅ Completato e unito in main

Riepilogo scritto alla chiusura a partire dal piano e dalla cronologia git; le specifiche dei singoli task in questa cartella contengono i dettagli.

## Cosa è stato realizzato

- **23.1 Estrarre l'accessor condiviso dei contenuti resolve+translate** — unito in ab02786 2026-09-07; commit a820f3b. Estrarre `resolveContentFromSource` e le chiamate di traduzione per tipo da `plan.ts` in un accessor condiviso dei contenuti `resolveAndTranslate` che supporti tutti e 5 i tipi di sorgente e i 6 tipi di artefatto.
- **23.2 Migrare drift.ts e discovery.ts sull'accessor condiviso** — unito in 6bd0da3 2026-09-08; commit 77f6a4a. Sostituire la logica inline di risoluzione e traduzione in `drift.ts` e `discovery.ts` con chiamate a `resolveAndTranslate`, colmando la lacuna di drift/rilevamento per `hook` e `rule`.
- **23.3 Funzione di ricerca di identità cross-framework** — unito in d0e6160 2026-09-07; commit 7c95667. Implementare `findRelatedInstallations` in `src/engine/crossFrameworkLookup.ts` per trovare tutti i record `ManagedInstallation` che rappresentano lo stesso artefatto logico tra assistenti e scope.

## Verification

- Il lavoro di ogni task è stato unito in `main` (evidenza: i commit indicati sopra, da `git log --grep '<id>'`).
- `npm test` su `main` a 5e85109 (2026-10-27): 577 test, 576 superati, 0 falliti, 1 saltato opzionale (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errori.
