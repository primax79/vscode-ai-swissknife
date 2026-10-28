# 32 — Dashboard: scheletro strutturale — Piano di implementazione

> **Derivato dalla specifica:** [`../specs/phase-9-spec.md`](../../specs/phase-9-spec.md) §3.3, §3.4, §5

**Depends on:** 28 (integrata), 29 (Fase 8 — **completamente integrata il 2026-09-08**,
confermato su `main` al commit `80a9bd8`, inclusa la registrazione di provider/viste guidata
dal registro in `activate()` di 29.4 che anche il task 32.1 modifica).

Task (ciascuno = un commit):

## Tasks

## Ordine dei task e dipendenze

- **32.1 non ha dipendenze da 32.2/32.3** (pura modifica di costruttore/cablaggio) — può essere avviato per primo o in parallelo.
- **32.2 dipende da 32.1** (il guscio richiede i nuovi provider nello scope anche se inutilizzati fino alle Iniziative 33/34).
- **32.3 dipende da 32.2** (devono esistere le sezioni/i punti di montaggio prima di decidere cosa viene aggiornato in modo incrementale rispetto a cosa viene ri-renderizzato).
- Questa intera iniziativa, insieme all'Iniziativa 31, blocca le Iniziative 33 e 34.

**Nota sulla delega:** pacchettizzazione espansa (secondo `tasks/AGENTS.md`), un file
di task per passaggio di consegne. Indirizzare l'agente al singolo file del task + `specs/phase-9-spec.md`
(§3.3, §3.4, §5) + `tasks/CONTEXT.md`.

## Chiusi

### 32.1 - Cablaggio dei provider

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Cablaggio provider della Dashboard · **Size:** S · **Depends on:** 28, 29 · **Use cases:** UC024 · **Spec:** [32.1-provider-wiring.md](32.1-provider-wiring.md)
- **Goal:** Passare `SourcesTreeDataProvider`, `AvailableTreeDataProvider` e una callback di refresh incrociato a `DashboardPanel` e aggiornare i punti di chiamata in `extension.ts`.

### 32.2 - Guscio di navigazione a sezioni + punto di accesso New Artifact

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Guscio delle sezioni della Dashboard · **Size:** M · **Depends on:** 32.1 · **Use cases:** UC024 · **Spec:** [32.2-section-shell.md](32.2-section-shell.md)
- **Goal:** Aggiungere i tab di sezione di primo livello (Overview, Installed, Sources & Catalog, Recommendations) e il punto di accesso `+ New Artifact`, suddividendo `getHtml()` in template per singola sezione.

### 32.3 - Modello di aggiornamento incrementale

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Aggiornamenti incrementali Dashboard · **Size:** M · **Depends on:** 32.2 · **Use cases:** UC024 · **Spec:** [32.3-incremental-updates.md](32.3-incremental-updates.md)
- **Goal:** Sostituire la riassegnazione integrale di `webview.html` al refresh con un singolo rendering iniziale del guscio e aggiornamenti incrementali del DOM guidati da `postMessage`.
