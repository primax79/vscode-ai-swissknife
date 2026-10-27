# 01 — Scaffold del progetto — Piano di implementazione

> **Derivato dalla specifica:** [../specs/foundations.md](../../specs/foundations.md)

Task (ciascuno = un commit; passare un file alla volta a un agente delegato):

## Tasks

## Decisioni condivise

Decisioni condivise per questa iniziativa che ogni task deve rispettare:

- Basato su `references/agent-hub/` (`package.json`, `tsconfig.json`,
  `esbuild.config.js`) come precedente reale e strutturalmente simile —
  riutilizzarne la struttura senza inventare una toolchain diversa, ma
  **escludere** ciò che non serve ancora nella Fase 1: niente
  `better-sqlite3`/`@electron/rebuild` (nessun DB locale in questa tranche —
  il registro è semplice JSON secondo SPEC.md §1), nessuna configurazione di
  bundle per webview (la UI della Fase 1 è basata su `TreeDataProvider` secondo
  `specs/foundations.md`, non su una webview).
- Nome del pacchetto/publisher: usare `ai-swissknife` / lasciare `publisher`
  come segnaposto che l'utente compilerà prima della pubblicazione effettiva
  (non inventare un id publisher reale per il marketplace).
- Il repository ha già un remote configurato
  (`git@github.com:primax79/vscode-ai-swissknife.git`) e un `.gitignore`
  con `references` — estenderlo, non sostituirlo.
- Un commit per task, limitato esclusivamente ai file di quel task.

## Chiusi

### 01.1 - package.json + strumenti di build

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Pacchetto e strumenti di build · **Size:** S · **Depends on:** - · **Spec:** [01.1-package-and-build.md](01.1-package-and-build.md)
- **Goal:** Creare `package.json`, `tsconfig.json` e uno script di build basato su esbuild affinché l'estensione possa compilare.

### 01.2 - Entry point e attivazione dell'estensione

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Entry point dell'estensione · **Size:** S · **Depends on:** 01.1 · **Spec:** [01.2-extension-entry.md](01.2-extension-entry.md)
- **Goal:** Fornire un `src/extension.ts` minimale che si attivi in modo pulito nell'Extension Development Host con la struttura di cartelle che le iniziative successive popoleranno.

### 01.3 - Configurazione lint/format + controllo degli script npm

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Configurazione lint e build gate · **Size:** S · **Depends on:** 01.2 · **Spec:** [01.3-lint-and-scripts.md](01.3-lint-and-scripts.md)
- **Goal:** Configurare script `eslint`, `typecheck` e `build` funzionanti come gate di verifica standard.
