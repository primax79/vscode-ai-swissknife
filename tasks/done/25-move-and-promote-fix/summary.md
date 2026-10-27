# 25 — Azione Move + correzione della disambiguazione di Promote — Riepilogo

> **Closed on:** 2026-10-27 (riordino del registro; verificatore ai-coding-tools-c1)  
> **Initiative:** 25 — Azione Move + correzione della disambiguazione di Promote  
> **Status:** ✅ Completato e unito in main

Riepilogo scritto alla chiusura a partire dal piano e dalla cronologia git; le specifiche dei singoli task in questa cartella contengono i dettagli.

## Cosa è stato realizzato

- **25.1 Discovery: raccogliere tutti i candidati di corrispondenza** — unito in 7059e75 2026-09-07; commit 34095c3. Modificare il ciclo di corrispondenza del rilevamento da un singolo `match` sovrascritto a un elenco `candidates` che scansiona tutti e 5 i tipi di sorgente e tutti i pacchetti in ciascuna sorgente.
- **25.2 UI di Promote: visibilità basata sui candidati + disambiguazione** — unito in e920b8e 2026-09-08; commit 5154eb9. Subordinare la visibilità dell'azione Promote al numero di candidati (`:one` / `:many`), mostrare un `QuickPick` quando corrispondono più candidati e rimuovere il fallback `'local-promotion'`.
- **25.3 promoteAllIdentical: saltare gli elementi con più candidati** — unito in e920b8e 2026-09-08; assorbito nel commit 5154eb9. Fare in modo che il percorso di promozione massiva `promoteAllIdentical` della Dashboard agisca solo sugli elementi a singolo candidato e segnali come saltati gli elementi con più candidati.
- **25.4 Primitive di Move: metodo removeMcpServer dell'adapter + helper di soft-delete** — unito in 6958726 2026-09-07; commit c188f3d. Aggiungere `removeMcpServer(id, loc)` all'interfaccia `Adapter` e a tutti e 5 gli adapter, e aggiungere `softDeletePath` in `src/engine/softDelete.ts` per spostare gli artefatti su file/directory in `.ai-swissknife/_deleted/`.
- **25.5 Comando "Move to..."** — unito in f5abc82 2026-09-08; commit e1fb1ba. Collegare il comando `moveItem` ("Move to...") in `installedView.ts` usando `planSync` per l'installazione nella destinazione e le primitive di `25.4` per la rimozione dell'origine con `manual-recovery-required` in caso di fallimento parziale.

## Verification

- Il lavoro di ogni task è stato unito in `main` (evidenza: i commit indicati sopra, da `git log --grep '<id>'`).
- `npm test` su `main` a 5e85109 (2026-10-27): 577 test, 576 superati, 0 falliti, 1 saltato opzionale (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errori.
