# 04 — Resolver delle sorgenti (git-custom + local-folder) — Piano di implementazione

> **Derivato dalla specifica:** [../specs/foundations.md](../../specs/foundations.md)

Task (ciascuno = un commit; passare un file alla volta a un agente delegato):

## Tasks

## Decisioni condivise

Decisioni condivise per questa iniziativa che ogni task deve rispettare:

- I resolver producono `SourceResolution { packages, diagnostics }` (i pacchetti
  contengono `Artifact[]`, SPEC.md §4) — non scrivono mai nelle directory di
  configurazione di un assistente (quello spetta al motore di installazione,
  iniziativa 06) e non toccano mai il registro (quello è lo store
  dell'iniziativa 02, usato successivamente dalla 06).
- `git-custom` (04.2) deve riutilizzare la logica di rilevamento del formato di
  04.1 sul checkout locale che produce, senza duplicarla — una Source
  git-custom è, dopo il clone, esattamente una cartella locale sotto ogni
  aspetto rilevante per il rilevamento.
- **Rivisto (seconda revisione Codex, `../_inbox/analyzed/
  codex-analysis-2.md`, rilievo B7)**: i test originali di 04.1/04.2 eseguivano
  asserzioni su percorsi dal vivo, mutabili e specifici della macchina (il
  conteggio esatto di `~/.claude/skills/`, percorsi assoluti
  `/Users/Alfredo/...`) — questo passava qui ma non è portabile per altri
  collaboratori, per la CI o per questa stessa macchina dopo che il numero di
  skill cambia. `04.3` sostituisce tali asserzioni con un piccolo corpus di
  fixture **committate** (`src/sources/__fixtures__/`) corredate di note di
  provenienza — "basare i test su artefatti reali e tracciati nella provenienza"
  e "mantenere i test portabili" non sono in contraddizione; non tornare a fare
  asserzioni su `~/.claude/skills/` in nessun task successivo al completamento
  di `04.3`.
- Questa iniziativa dipende dai tipi di dominio completati in 02.1. `04.3`
  dipende inoltre da `03.4` per il contratto del codec/detector e da `02.3` per
  `resolveArtifactContent` tipizzato, `ResolvedRevision` e il mutex Git
  condiviso. Viene completato dopo entrambi.

## Chiusi

### 04.1 - Rilevamento del formato + resolver per cartella locale

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Resolver cartella locale e rilevamento · **Size:** M · **Depends on:** 02.1 · **Use cases:** UC001 · **Spec:** [04.1-local-folder-resolver.md](04.1-local-folder-resolver.md)
- **Goal:** Attraversare un albero di directory senza richiedere un manifest (`findSkillDirs`) e risolvere sorgenti `local-folder` in `Package[]` contenenti artefatti `skill`.

### 04.2 - Resolver git-custom

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Resolver per sorgenti git-custom · **Size:** M · **Depends on:** 04.1 · **Use cases:** UC001 · **Spec:** [04.2-git-custom-resolver.md](04.2-git-custom-resolver.md)
- **Goal:** Risolvere sorgenti `git-custom` tramite clone/fetch in una directory di cache locale con pin di branch/tag/commit e riutilizzando il rilevamento del formato di `04.1`.

### 04.3 - Hardening del resolver + fixture portabili

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Diagnostiche del resolver e fixture · **Size:** M · **Depends on:** 04.2, 02.3, 03.4 · **Use cases:** UC001 · **Spec:** [04.3-hardening.md](04.3-hardening.md)
- **Goal:** Restituire `SourceResolution { packages, diagnostics }` dai resolver, serializzare il checkout Git e le letture del contenuto sotto un unico mutex e sostituire i percorsi di test specifici della macchina con fixture committate.
