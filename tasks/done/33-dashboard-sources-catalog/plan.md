# 33 — Dashboard: sezione Sources & Catalog — Piano di implementazione

> **Derivato dalla specifica:** [`../specs/phase-9-spec.md`](../../specs/phase-9-spec.md) §1 (obiettivo 1), §4, §4.1

**Depends on:** 31 (intera iniziativa, integrata), 32 (intera iniziativa, integrata).

Task (ciascuno = un commit):

## Tasks

## Ordine dei task e dipendenze

- **33.1 non ha dipendenze da 33.2-33.5** — l'elenco delle sorgenti in sé non richiede l'esistenza della navigazione del catalogo.
- **33.2 dipende da 33.1** (serve una riga sorgente renderizzata per poterla espandere in un catalogo).
- **33.3 e 33.4 dipendono entrambi da 33.2** (servono le righe del catalogo per l'anteprima/l'installazione) — sono indipendenti tra loro, avviabili in parallelo.
- **33.5 dipende da 33.4** (i badge riflettono lo stato di installazione; il cablaggio del refresh segue l'integrazione delle azioni di installazione).

**Nota sulla delega:** pacchettizzazione espansa (secondo `tasks/AGENTS.md`), un file
di task per passaggio di consegne. Indirizzare l'agente al singolo file del task + `specs/phase-9-spec.md`
(§1, §4, §4.1) + `tasks/CONTEXT.md` + i pertinenti file di task dell'Iniziativa 31
per le firme esatte dei metodi `do*` utilizzati.

## Chiusi

### 33.1 - Elenco delle sorgenti + CRUD

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Elenco sorgenti e CRUD · **Size:** M · **Depends on:** 31, 32 · **Spec:** [33.1-sources-list-crud.md](33.1-sources-list-crud.md)
- **Goal:** Renderizzare l'elenco delle sorgenti raggruppato per scope nella sezione Sources & Catalog della Dashboard con Add, Remove, Export, Export All e Import collegati a `SourcesTreeDataProvider`.

### 33.2 - Navigazione lazy del catalogo

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Navigazione lazy del catalogo · **Size:** M · **Depends on:** 33.1 · **Spec:** [33.2-catalog-browsing.md](33.2-catalog-browsing.md)
- **Goal:** Implementare l'espansione su richiesta delle sorgenti tramite i messaggi `requestCatalog{sourceId, scope}` e `catalogData` renderizzando cartelle annidate, artefatti e diagnostica.

### 33.3 - Azione di anteprima

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Azione di anteprima nel catalogo · **Size:** S · **Depends on:** 33.2 · **Spec:** [33.3-preview-action.md](33.3-preview-action.md)
- **Goal:** Collegare `previewArtifact` dalle righe del catalogo della Dashboard per aprire un tab editor di anteprima in sola lettura tramite `AvailableTreeDataProvider`.

### 33.4 - Azioni di installazione

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Azioni di installazione dal catalogo · **Size:** M · **Depends on:** 31.2, 33.2 · **Spec:** [33.4-install-actions.md](33.4-install-actions.md)
- **Goal:** Collegare le azioni di installazione di singolo artefatto, cartella e intera sorgente dal catalogo della Dashboard ai metodi disaccoppiati `doInstall*` su `AvailableTreeDataProvider`.

### 33.5 - Badge "Installed in" + aggiornamento del catalogo

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Badge installazioni e refresh · **Size:** S · **Depends on:** 33.4 · **Spec:** [33.5-installed-badges-refresh.md](33.5-installed-badges-refresh.md)
- **Goal:** Mostrare sulle righe del catalogo i badge per artefatto degli assistenti in cui è installato, collegare `refreshCatalog` e attivare il refresh incrociato tra provider dopo le mutazioni.
