# 31 — Dashboard: disaccoppiamento del livello di azione dei provider — Riepilogo

> **Closed on:** 2026-10-27 (riordino del registro; verificatore ai-coding-tools-c1)  
> **Initiative:** 31 — Dashboard: disaccoppiamento del livello di azione dei provider  
> **Status:** ✅ Completata e integrata in main

Riepilogo scritto alla chiusura a partire dal piano e dalla cronologia git; le specifiche per singolo task in questa cartella contengono i dettagli.

## Cosa è stato realizzato

- **31.1 `doUpdateInstallation`/`doUninstallItem`** — integrato e7be2b1 2026-09-08. Estrarre i metodi pubblici che accettano un semplice `ManagedInstallation`, `doUpdateInstallation` e `doUninstallItem`, su `InstalledTreeDataProvider` così che i messaggi della webview possano invocarli.
- **31.2 Disaccoppiare i metodi di installazione di `availableView.ts`** — integrato bc1b26d 2026-09-08. Fornire a `installFolder`, `installSourceGroup` e `installArtifact` punti di ingresso basati su identificatori semplici su `AvailableTreeDataProvider` e rendere pubblico `installBatch`.
- **31.3 Gestori recommend/unrecommend basati su identificatori** — integrato 69cf6bf 2026-09-08. Estrarre i gestori recommend e unrecommend basati su identificatori in `src/ui/recommendations.ts` affinché non dipendano da verifiche su `TreeItem` tramite `instanceof`.
- **31.4 Identità stabile degli elementi + verifica di non regressione** — integrato f4bc36d 2026-09-08. Introdurre una chiave di identità composita `{assistant, scope, kind, name}` con nuova risoluzione lato server e verificare la piena parità delle azioni della sidebar.

## Verification

- Il lavoro di ogni task è integrato in `main` (evidenza: i commit indicati sopra, da `git log --grep '<id>'`).
- `npm test` su `main` a 5e85109 (2026-10-27): 577 test, 576 superati, 0 falliti, 1 saltato opzionale (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errori.
