# 03 — Adapter Claude + Kilo (skill+rule) — Riepilogo

> **Closed on:** 2026-10-27 (riordino del registro; verificatore ai-coding-tools-c1)  
> **Initiative:** 03 — Adapter Claude + Kilo (skill+rule)  
> **Status:** ✅ Completato e unito in main

Riepilogo scritto alla chiusura a partire dal piano e dalla cronologia git; le specifiche per singolo task in questa cartella contengono i dettagli.

## Cosa è stato realizzato

- **03.1 Interfaccia Adapter** — unito 6b6c5fe 2026-08-18; commit 391338b. Definire il contratto condiviso `Adapter` e i modelli canonici in memoria (`CanonicalSkill`, `CanonicalRule`, `ConversionDiagnostic`) in `src/adapters/types.ts`.
- **03.2 Adapter Claude Code** — unito 7904ab6 2026-08-18; commit 00f520c. Implementare `ClaudeAdapter` in `src/adapters/claude.ts` coprendo lettura/scrittura/elenco di `skill` e `rule` negli scope globale e di progetto.
- **03.3 Adapter Kilo Code** — unito 57d90dd 2026-08-18. Implementare `KiloAdapter` in `src/adapters/kilo.ts` coprendo lettura/scrittura/elenco di `skill` e `rule` negli scope globale e di progetto.
- **03.4 Codec condiviso delle skill, validazione dei percorsi, payload della directory (hardening)** — unito 4ee210d 2026-08-19; commit 886bf31. Creare un codec condiviso delle skill in `src/adapters/codec.ts` che carichi l'intero payload della directory della skill (`files` + permessi di esecuzione), validi percorsi relativi sicuri ed esponga le skill malformate come diagnostiche strutturate.

## Verification

- Il lavoro di ogni task è stato unito in `main` (evidenza: i commit indicati sopra, da `git log --grep '<id>'`).
- `npm test` su `main` a 5e85109 (2026-10-27): 577 test, 576 superati, 0 falliti, 1 saltato opt-in (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errori.
