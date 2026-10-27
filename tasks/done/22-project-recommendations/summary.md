# 22 — Installazioni consigliate a livello di progetto — Riepilogo

> **Closed on:** 2026-10-27 (riordino del registro; verificatore ai-coding-tools-c1)  
> **Initiative:** 22 — Installazioni consigliate a livello di progetto  
> **Status:** ✅ Completato e unito in main

Riepilogo scritto alla chiusura a partire dal piano e dalla cronologia git; le specifiche dei singoli task in questa cartella contengono i dettagli.

## Cosa è stato realizzato

- **22.1 Comandi recommend/unrecommend + decorazione dell'albero** — unito in 66952f8 2026-09-07; commit 903c814. Aggiungere azioni del menu contestuale sugli elementi Available e Installed per scrivere o rimuovere voci `DesiredInstallation` nel manifesto del progetto con una decorazione Recommended e l'aggiornamento di entrambe le viste.
- **22.2 Motore di risoluzione delle raccomandazioni** — unito in 716cdbc 2026-09-07; commit d170427. Implementare la funzione pura `resolveRecommendations` in `src/engine/recommendations.ts` classificando `desiredInstallations` rispetto a `state.json` e ai tentativi di risoluzione delle sorgenti in `satisfied`, `pending` e `broken`.
- **22.3 Comando "Install Recommended" + filtro "Recommended" nella vista Available** — unito in 0b01b26 2026-09-07; commit 2b45d66. Aggiungere il comando `aiSwissknife.installRecommended` e il raggruppamento `Recommended` in `AvailableTreeDataProvider` usando l'installazione sull'assistente/scope di destinazione specifico di ciascuna voce.
- **22.4 Rilevamento all'apertura del workspace + notifica** — unito in 1612940 2026-09-07; commit 4252ad6. Collegare all'attivazione un controllo esclusivamente locale delle raccomandazioni non soddisfatte che offra `Install All`, `Review` e `Don't ask again for this workspace`.
- **22.5 Igiene Git per il manifesto condiviso** — unito in 8ff9218 2026-09-07; commit fde6da7. Garantire che `writeManifest` a livello di progetto accodi in modo non distruttivo il percorso `state.json` del progetto a un `.gitignore` esistente.

## Verification

- Il lavoro di ogni task è stato unito in `main` (evidenza: i commit indicati sopra, da `git log --grep '<id>'`).
- `npm test` su `main` a 5e85109 (2026-10-27): 577 test, 576 superati, 0 falliti, 1 saltato opzionale (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errori.
