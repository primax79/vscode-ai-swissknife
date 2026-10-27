# 33 — Dashboard: sezione Sources & Catalog — Riepilogo

> **Closed on:** 2026-10-27 (riordino del registro; verificatore ai-coding-tools-c1)  
> **Initiative:** 33 — Dashboard: sezione Sources & Catalog  
> **Status:** ✅ Completata e integrata in main

Riepilogo scritto alla chiusura a partire dal piano e dalla cronologia git; le specifiche per singolo task in questa cartella contengono i dettagli.

## Cosa è stato realizzato

- **33.1 Elenco delle sorgenti + CRUD** — integrato 8f93b35 2026-09-08. Renderizzare l'elenco delle sorgenti raggruppato per scope nella sezione Sources & Catalog della Dashboard con Add, Remove, Export, Export All e Import collegati a `SourcesTreeDataProvider`.
- **33.2 Navigazione lazy del catalogo** — integrato eddad66 2026-09-08. Implementare l'espansione su richiesta delle sorgenti tramite i messaggi `requestCatalog{sourceId, scope}` e `catalogData` renderizzando cartelle annidate, artefatti e diagnostica.
- **33.3 Azione di anteprima** — integrato f55e7de 2026-09-08. Collegare `previewArtifact` dalle righe del catalogo della Dashboard per aprire un tab editor di anteprima in sola lettura tramite `AvailableTreeDataProvider`.
- **33.4 Azioni di installazione** — integrato 0d68bf7 2026-09-08. Collegare le azioni di installazione di singolo artefatto, cartella e intera sorgente dal catalogo della Dashboard ai metodi disaccoppiati `doInstall*` su `AvailableTreeDataProvider`.
- **33.5 Badge "Installed in" + aggiornamento del catalogo** — integrato 357c20b 2026-09-08. Mostrare sulle righe del catalogo i badge per artefatto degli assistenti in cui è installato, collegare `refreshCatalog` e attivare il refresh incrociato tra provider dopo le mutazioni.

## Verification

- Il lavoro di ogni task è integrato in `main` (evidenza: i commit indicati sopra, da `git log --grep '<id>'`).
- `npm test` su `main` a 5e85109 (2026-10-27): 577 test, 576 superati, 0 falliti, 1 saltato opzionale (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errori.
