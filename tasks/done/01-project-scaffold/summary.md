# 01 — Scaffold del progetto — Riepilogo

> **Closed on:** 2026-10-27 (riordino del registro; verificatore ai-coding-tools-c1)  
> **Initiative:** 01 — Scaffold del progetto  
> **Status:** ✅ Completato e unito in main

Riepilogo scritto alla chiusura a partire dal piano e dalla cronologia git; le specifiche per singolo task in questa cartella contengono i dettagli.

## Cosa è stato realizzato

- **01.1 package.json + strumenti di build** — unito 30246bc 2026-08-18. Creare `package.json`, `tsconfig.json` e uno script di build basato su esbuild affinché l'estensione possa compilare.
- **01.2 Entry point e attivazione dell'estensione** — unito ae7e2bb 2026-08-18. Fornire un `src/extension.ts` minimale che si attivi in modo pulito nell'Extension Development Host con la struttura di cartelle che le iniziative successive popoleranno.
- **01.3 Configurazione lint/format + controllo degli script npm** — unito 9844f67 2026-08-18. Configurare script `eslint`, `typecheck` e `build` funzionanti come gate di verifica standard.

## Verification

- Il lavoro di ogni task è stato unito in `main` (evidenza: i commit indicati sopra, da `git log --grep '<id>'`).
- `npm test` su `main` a 5e85109 (2026-10-27): 577 test, 576 superati, 0 falliti, 1 saltato opt-in (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errori.
