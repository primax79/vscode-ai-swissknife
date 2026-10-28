# 02 — Tipi di dominio + store del registro — Piano di implementazione

> **Derivato dalla specifica:** [../specs/foundations.md](../../specs/foundations.md)

Task (ciascuno = un commit; passare un file alla volta a un agente delegato):

## Tasks

## Decisioni condivise

Decisioni condivise per questa iniziativa che ogni task deve rispettare:

- Solo tipi in 02.1 — zero logica, zero I/O. Tutto l'I/O su file/JSON è in 02.2/02.3.
- Tutti i 6 valori di `ItemKind` sono dichiarati anche se solo `skill` ottiene un
  comportamento reale in questa Fase (`rule` è rimandato alla Fase 2 per il
  percorso resolver/installazione/UI, vedere `tasks/CONTEXT.md` — gli adapter
  restano, vedere i non-obiettivi in `specs/foundations.md`) — il tipo unione in
  sé è leggero e condiviso, non lasciarlo artificialmente ristretto.
- **Rivisto (seconda revisione Codex, `../_inbox/analyzed/
  codex-analysis-2.md`, rilievi B3/I13)**: la directory dei dati è
  `~/.ai-swissknife/` (globale) / `<workspace>/.ai-swissknife/` (progetto),
  **non** `.ai-toolkit` — rinominata in 02.3 prima che qualsiasi utente reale
  abbia dati sotto il vecchio nome. Ogni livello contiene ora **due** file, non
  uno: `manifest.json` (condivisibile, versionabile — `DesiredSource[]`
  portabili + `desiredInstallations` + `schemaVersion`, nessun percorso assoluto
  di progetto o altri campi specifici della macchina) e `state.json` (locale
  alla macchina — `ManagedInstallation[]` + `schemaVersion`, mai committato).
  Vedere 02.3 per le funzioni esatte. `ObservedArtifact` continua a non essere
  mai persistito in nessuno dei due file (SPEC.md §4) — le iniziative successive
  (discovery, Fase 3) definiranno la propria struttura di cache.
- Questa iniziativa dipende dalla 01 (richiede l'esistenza di
  `tsconfig.json`/`package.json` affinché i nuovi file superino typecheck e
  build). Il task di hardening 02.3 dipende inoltre dal codec condiviso delle
  skill di 03.4; i task completati 02.1/02.2 rimangono la base di dominio/store
  che 03.4 già utilizza.

## Chiusi

### 02.1 - Tipi di dominio fondamentali

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Tipi di dominio fondamentali · **Size:** S · **Depends on:** 01 · **Spec:** [02.1-domain-types.md](02.1-domain-types.md)
- **Goal:** Definire ogni entità fondamentale della specifica (`AssistantId`, `ItemKind`, `Scope`, `Source`, `Package`, `Artifact`, `ManagedInstallation`, `ObservedArtifact`) come interfacce TypeScript in `src/domain/types.ts`.

### 02.2 - Store del registro (lettura/scrittura JSON, globale + progetto)

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Store JSON del registro · **Size:** S · **Depends on:** 02.1 · **Spec:** [02.2-registry-store.md](02.2-registry-store.md)
- **Goal:** Implementare funzioni puro-Node di lettura/scrittura JSON atomica per il registro negli scope globale e di progetto.

### 02.3 - Modello di persistenza e artefatti risolti (hardening)

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Persistenza portabile e hardening · **Size:** M · **Depends on:** 02.2, 03.4 · **Spec:** [02.3-hardening.md](02.3-hardening.md)
- **Goal:** Suddividere la persistenza in `manifest.json` condivisibile (`DesiredSource`, `desiredInstallations`) e `state.json` locale alla macchina sotto `.ai-swissknife`, e aggiungere la risoluzione tipizzata del contenuto `ResolvedArtifact<CanonicalSkill>` e un mutex condiviso per la cache Git.
