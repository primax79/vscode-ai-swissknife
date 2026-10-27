# 24 — Diff rispetto all'originale + anteprima prima dell'installazione — Riepilogo

> **Closed on:** 2026-10-27 (riordino del registro; verificatore ai-coding-tools-c1)  
> **Initiative:** 24 — Diff rispetto all'originale + anteprima prima dell'installazione  
> **Status:** ✅ Completato e unito in main

Riepilogo scritto alla chiusura a partire dal piano e dalla cronologia git; le specifiche dei singoli task in questa cartella contengono i dettagli.

## Cosa è stato realizzato

- **24.1 Comando di diff rispetto all'originale** — unito in 94b8609 2026-09-08; commit 96505a8. Aggiungere un comando `diffAgainstOriginal` sugli elementi gestiti modificati e sugli elementi non gestiti differenti che risolva l'originale upstream tramite `resolveAndTranslate` e apra `vscode.diff`.
- **24.2 Azione di anteprima prima dell'installazione** — unito in b8e8959 2026-09-07; commit 2614f6d. Aggiungere un'opzione `Preview` al flusso di conferma dell'installazione usando un `TextDocumentContentProvider` per ispezionare `prepared.content` in sola lettura senza scrivere su disco.

## Verification

- Il lavoro di ogni task è stato unito in `main` (evidenza: i commit indicati sopra, da `git log --grep '<id>'`).
- `npm test` su `main` a 5e85109 (2026-10-27): 577 test, 576 superati, 0 falliti, 1 saltato opzionale (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errori.
