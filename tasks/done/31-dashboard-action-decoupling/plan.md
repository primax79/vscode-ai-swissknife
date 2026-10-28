# 31 — Dashboard: disaccoppiamento del livello di azione dei provider — Piano di implementazione

> **Derivato dalla specifica:** [`../specs/phase-9-spec.md`](../../specs/phase-9-spec.md) §1.1, §7.1

**Depends on:** 28 (integrata), 29 e 30 (Fase 8, `specs/adapter-and-source-registries.md`
— **completamente integrate il 2026-09-08**, incluso 29.5; confermato su `main` al
commit `80a9bd8`). Le sezioni Ambito dei task sottostanti citano il codice reale post-merge
(`getAdapter()` al posto dei vecchi operatori ternari, ecc.) — riverificare
rispetto all'attuale `main` prima di iniziare nel caso qualcosa sia cambiato nel frattempo.

Task (ciascuno = un commit):

## Tasks

## Ordine dei task e dipendenze

- **31.1, 31.2, 31.3 sono indipendenti tra loro** (file diversi: `installedView.ts`, `availableView.ts`, `extension.ts`+`recommendations.ts`) — avviabili in parallelo.
- **31.4 dipende da tutti e tre** (la chiave di identità composita viene consumata dai metodi di 31.1; il passaggio di non regressione esercita 31.1-31.3 insieme) — non iniziare finché non sono stati integrati.
- Questa intera iniziativa blocca le Iniziative 33 e 34 (`specs/phase-9-spec.md` §7).

**Nota sulla delega:** pacchettizzazione espansa (secondo `tasks/AGENTS.md`), un file
di task per passaggio di consegne. Indirizzare l'agente al singolo file del task + `specs/phase-9-spec.md`
(nello specifico §1.1 e §7.1) + `tasks/CONTEXT.md` — non all'intero albero `tasks/`.
La sezione Ambito di ciascun task sottostante descrive la struttura di destinazione **post-Fase-8**
(dispatch basato su `getAdapter()`/registro) — se la Fase 8 non
è ancora effettivamente approdata quando inizia un task, fermarsi e riverificare rispetto all'attuale
`main` invece di tirare a indovinare quale sia la struttura reale.

## Chiusi

### 31.1 - `doUpdateInstallation`/`doUninstallItem`

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** doUpdate e doUninstall in Installed · **Size:** S · **Depends on:** 28, 29, 30 · **Use cases:** UC024, UC025 · **Spec:** [31.1-installed-do-methods.md](31.1-installed-do-methods.md)
- **Goal:** Estrarre i metodi pubblici che accettano un semplice `ManagedInstallation`, `doUpdateInstallation` e `doUninstallItem`, su `InstalledTreeDataProvider` così che i messaggi della webview possano invocarli.

### 31.2 - Disaccoppiare i metodi di installazione di `availableView.ts`

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Disaccoppiamento install in Available · **Size:** M · **Depends on:** 28, 29, 30 · **Use cases:** UC024, UC025 · **Spec:** [31.2-available-decouple-install.md](31.2-available-decouple-install.md)
- **Goal:** Fornire a `installFolder`, `installSourceGroup` e `installArtifact` punti di ingresso basati su identificatori semplici su `AvailableTreeDataProvider` e rendere pubblico `installBatch`.

### 31.3 - Gestori recommend/unrecommend basati su identificatori

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Gestori suggerimenti per id · **Size:** S · **Depends on:** 28, 29, 30 · **Use cases:** UC024, UC025 · **Spec:** [31.3-recommendation-handlers.md](31.3-recommendation-handlers.md)
- **Goal:** Estrarre i gestori recommend e unrecommend basati su identificatori in `src/ui/recommendations.ts` affinché non dipendano da verifiche su `TreeItem` tramite `instanceof`.

### 31.4 - Identità stabile degli elementi + verifica di non regressione

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Identità composita e regressione · **Size:** M · **Depends on:** 31.1, 31.2, 31.3 · **Use cases:** UC024, UC025 · **Spec:** [31.4-identity-and-regression.md](31.4-identity-and-regression.md)
- **Goal:** Introdurre una chiave di identità composita `{assistant, scope, kind, name}` con nuova risoluzione lato server e verificare la piena parità delle azioni della sidebar.
