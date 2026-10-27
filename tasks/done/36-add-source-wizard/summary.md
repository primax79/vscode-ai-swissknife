# 36 — Wizard di aggiunta sorgente — Riepilogo

> **Closed on:** 2026-10-27 (riordino del registro; verificatore ai-coding-tools-c1)  
> **Initiative:** 36 — Wizard di aggiunta sorgente  
> **Status:** ✅ Completata e unita in main

Riepilogo scritto alla chiusura a partire dal piano e dalla cronologia git; le specifiche dei singoli task in questa cartella contengono i dettagli.

## Cosa è stato realizzato

- **36.1 Helper puro: validazione della posizione + derivazione di id/nome** — unito in 4a77022 il 2026-10-08. Creare `src/sources/sourceDefaults.ts` che esporta `validateLocation` e `deriveSourceDefaults` per validare URL/percorsi e derivare `id` e `name` della sorgente senza importare `vscode`.
- **36.2 Riscrittura di `addSource` come wizard tipo → scope → posizione → dettagli (scope singolo)** — unito in 193b865 il 2026-10-08. Riscrivere `SourcesProvider.addSource(forceScope?)` in un flusso wizard tipo → scope → posizione → id/nome precompilati con assunzione del branch di default e fissaggio opzionale di branch/tag.
- **36.3 Selezione multi-scope (una scrittura per scope, percorsi locali per scope) + gestione degli id duplicati** — unito in 1c73989 il 2026-10-09. Trasformare il passo dello scope di aggiunta sorgente in una selezione multipla (Global e/o Workspace), chiedere percorsi per scope per `local-folder` e chiedere "Replace?" in caso di ID sorgente duplicati per scope.

## Verification

- Il lavoro di ogni task è stato unito in `main` (evidenza: i commit indicati sopra, da `git log --grep '<id>'`).
- `npm test` su `main` a 5e85109 (2026-10-27): 577 test, 576 passati, 0 falliti, 1 saltato opt-in (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errori.
