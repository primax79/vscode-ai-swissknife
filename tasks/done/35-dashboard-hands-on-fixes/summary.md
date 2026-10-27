# 35 — Dashboard: correzioni dai test pratici — Riepilogo

> **Closed on:** 2026-10-27 (riordino del registro; verificatore ai-coding-tools-c1)  
> **Initiative:** 35 — Dashboard: correzioni dai test pratici  
> **Status:** ✅ Completata e integrata in main

Riepilogo scritto alla chiusura a partire dal piano e dalla cronologia git; le specifiche per singolo task in questa cartella contengono i dettagli.

## Cosa è stato realizzato

- **35.1 Guscio di caricamento istantaneo** — integrato 4a46e04 2026-09-09. Renderizzare in modo sincrono un guscio di caricamento istantaneo con gli stili del tema e uno spinner all'apertura della Dashboard, così che non mostri mai una schermata vuota durante il caricamento dei dati.
- **35.2 Contenuto del tab Overview** — integrato 366aeb2 2026-09-09. Sostituire il segnaposto del tab Overview con una vista iniziale a colpo d'occhio che mostra chip statistici di riepilogo e gli elementi che richiedono attenzione.
- **35.3 Vista a matrice per Installed** — integrato 7f3b8b9 2026-09-09. Sostituire la tabella piatta di Installed con una matrice di confronto espandibile per artefatto dotata di sotto-righe per assistente, azioni rapide (Preview, Diff, Update) e ordinamento per colonna.
- **35.4 Righe del catalogo come vera tabella** — integrato 1afb012 2026-09-09. Convertire le righe di artefatti e cartelle di Sources & Catalog da layout flex a ritorno a capo libero a una tabella CSS Grid a colonne fisse.
- **35.5 Pulsanti con sola icona in tutta la Dashboard** — integrato e656d24 2026-09-09. Sostituire le etichette di testo con pulsanti compatti a icona Unicode e tooltip in tutte le sezioni della Dashboard dove il testo non è indispensabile.

## Verification

- Il lavoro di ogni task è integrato in `main` (evidenza: i commit indicati sopra, da `git log --grep '<id>'`).
- `npm test` su `main` a 5e85109 (2026-10-27): 577 test, 576 superati, 0 falliti, 1 saltato opzionale (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errori.
