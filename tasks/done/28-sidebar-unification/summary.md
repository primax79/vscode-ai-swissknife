# Iniziativa 28 — Unificazione della navigazione nella sidebar — Riepilogo

> **Closed on:** 2026-10-27 (riordino del registro; verificatore ai-coding-tools-c1)  
> **Initiative:** Iniziativa 28 — Unificazione della navigazione nella sidebar  
> **Status:** ✅ Completata e integrata in main

Riepilogo scritto alla chiusura a partire dal piano e dalla cronologia git; le specifiche per singolo task in questa cartella contengono i dettagli.

## Cosa è stato realizzato

- **28.1 Unire Sources + Available in un unico albero** — integrato 979e456 2026-09-08. Unificare `SourcesTreeDataProvider` e `AvailableTreeDataProvider` in un singolo albero nella sidebar in modo che l'espansione di una sorgente mostri direttamente il contenuto del suo catalogo senza accoppiamento selezione-filtro.
- **28.2 Raggruppamento per tipo in Installed** — integrato 979e456 2026-09-08. Aggiungere un livello intermedio di raggruppamento per tipo (`KindGroupItem`) sotto ciascun gruppo assistente/scope in `InstalledTreeDataProvider`.

## Verification

- Il lavoro di ogni task è integrato in `main` (evidenza: i commit indicati sopra, da `git log --grep '<id>'`).
- `npm test` su `main` a 5e85109 (2026-10-27): 577 test, 576 superati, 0 falliti, 1 saltato opzionale (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errori.
