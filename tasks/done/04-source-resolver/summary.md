# 04 — Resolver delle sorgenti (git-custom + local-folder) — Riepilogo

> **Closed on:** 2026-10-27 (riordino del registro; verificatore ai-coding-tools-c1)  
> **Initiative:** 04 — Resolver delle sorgenti (git-custom + local-folder)  
> **Status:** ✅ Completato e unito in main

Riepilogo scritto alla chiusura a partire dal piano e dalla cronologia git; le specifiche per singolo task in questa cartella contengono i dettagli.

## Cosa è stato realizzato

- **04.1 Rilevamento del formato + resolver per cartella locale** — unito 6b6c5fe 2026-08-18; commit 42e92f4. Attraversare un albero di directory senza richiedere un manifest (`findSkillDirs`) e risolvere sorgenti `local-folder` in `Package[]` contenenti artefatti `skill`.
- **04.2 Resolver git-custom** — unito 7904ab6 2026-08-18; commit 24be057. Risolvere sorgenti `git-custom` tramite clone/fetch in una directory di cache locale con pin di branch/tag/commit e riutilizzando il rilevamento del formato di `04.1`.
- **04.3 Hardening del resolver + fixture portabili** — unito ad662b7 2026-08-19; commit 1ca2e87. Restituire `SourceResolution { packages, diagnostics }` dai resolver, serializzare il checkout Git e le letture del contenuto sotto un unico mutex e sostituire i percorsi di test specifici della macchina con fixture committate.

## Verification

- Il lavoro di ogni task è stato unito in `main` (evidenza: i commit indicati sopra, da `git log --grep '<id>'`).
- `npm test` su `main` a 5e85109 (2026-10-27): 577 test, 576 superati, 0 falliti, 1 saltato opt-in (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errori.
