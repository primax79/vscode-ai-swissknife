# 34 — Dashboard: sezione Recommendations + parità delle azioni di Installed — Riepilogo

> **Closed on:** 2026-10-27 (riordino del registro; verificatore ai-coding-tools-c1)  
> **Initiative:** 34 — Dashboard: sezione Recommendations + parità delle azioni di Installed  
> **Status:** ✅ Completata e integrata in main

Riepilogo scritto alla chiusura a partire dal piano e dalla cronologia git; le specifiche per singolo task in questa cartella contengono i dettagli.

## Cosa è stato realizzato

- **34.1 Sezione Recommendations** — integrato 0ab3fc1 2026-09-08. Esporre per `resolveRecommendations` i bucket `pending` e `broken` nel tab Recommendations della Dashboard con le azioni installa singolo, installa tutti e rimuovi suggerimento.
- **34.2 Uninstall + Update-to-latest nel pannello di dettaglio** — integrato 7e94ce1 2026-09-08. Estendere il pannello di dettaglio di Installed con le azioni Uninstall e Update-to-latest usando la nuova risoluzione lato server tramite chiave di identità composita stabile.
- **34.3 Cablaggio del refresh incrociato** — integrato d546732 2026-09-09. Verificare e garantire che ogni mutazione di stato attivata dalla Dashboard aggiorni la barra di stato e i tree provider della sidebar.

## Verification

- Il lavoro di ogni task è integrato in `main` (evidenza: i commit indicati sopra, da `git log --grep '<id>'`).
- `npm test` su `main` a 5e85109 (2026-10-27): 577 test, 576 superati, 0 falliti, 1 saltato opzionale (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errori.
