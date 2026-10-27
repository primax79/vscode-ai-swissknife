# 02 — Tipi di dominio + store del registro — Riepilogo

> **Closed on:** 2026-10-27 (riordino del registro; verificatore ai-coding-tools-c1)  
> **Initiative:** 02 — Tipi di dominio + store del registro  
> **Status:** ✅ Completato e unito in main

Riepilogo scritto alla chiusura a partire dal piano e dalla cronologia git; le specifiche per singolo task in questa cartella contengono i dettagli.

## Cosa è stato realizzato

- **02.1 Tipi di dominio fondamentali** — unito eb779ca 2026-08-18. Definire ogni entità fondamentale della specifica (`AssistantId`, `ItemKind`, `Scope`, `Source`, `Package`, `Artifact`, `ManagedInstallation`, `ObservedArtifact`) come interfacce TypeScript in `src/domain/types.ts`.
- **02.2 Store del registro (lettura/scrittura JSON, globale + progetto)** — unito 6b6c5fe 2026-08-18; commit 7c2c036. Implementare funzioni puro-Node di lettura/scrittura JSON atomica per il registro negli scope globale e di progetto.
- **02.3 Modello di persistenza e artefatti risolti (hardening)** — unito 29fe38b 2026-08-19. Suddividere la persistenza in `manifest.json` condivisibile (`DesiredSource`, `desiredInstallations`) e `state.json` locale alla macchina sotto `.ai-swissknife`, e aggiungere la risoluzione tipizzata del contenuto `ResolvedArtifact<CanonicalSkill>` e un mutex condiviso per la cache Git.

## Verification

- Il lavoro di ogni task è stato unito in `main` (evidenza: i commit indicati sopra, da `git log --grep '<id>'`).
- `npm test` su `main` a 5e85109 (2026-10-27): 577 test, 576 superati, 0 falliti, 1 saltato opt-in (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errori.
