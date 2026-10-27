# 25 — Azione Move + correzione della disambiguazione di Promote — Piano di implementazione

> **Derived from spec:** [`../specs/phase-6-spec.md`](../../specs/phase-6-spec.md) §4.3, §4.4

Task (ciascuno = un commit):

## Tasks

## Ordine dei task e vincoli di sequenza

- **25.1 blocca 25.2 che blocca 25.3** — la catena di correzione di Promote.
- **25.4 blocca 25.5** — la catena delle primitive di Move, indipendente dalla catena di Promote.
- 25.1-25.3 e 25.4-25.5 possono essere avviati in parallelo (due worktree indipendenti) poiché toccano file diversi (`discovery.ts`/`package.json`/`dashboard.ts` contro `adapters/*.ts`/`installedView.ts`).

## Closed

### 25.1 - Discovery: raccogliere tutti i candidati di corrispondenza

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Raccolta candidati di discovery · **Size:** M · **Depends on:** 14 · **Spec:** [25.1-discovery-candidates.md](25.1-discovery-candidates.md)
- **Goal:** Modificare il ciclo di corrispondenza del rilevamento da un singolo `match` sovrascritto a un elenco `candidates` che scansiona tutti e 5 i tipi di sorgente e tutti i pacchetti in ciascuna sorgente.

### 25.2 - UI di Promote: visibilità basata sui candidati + disambiguazione

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Disambiguazione candidati in Promote · **Size:** M · **Depends on:** 25.1 · **Spec:** [25.2-promote-ui-fix.md](25.2-promote-ui-fix.md)
- **Goal:** Subordinare la visibilità dell'azione Promote al numero di candidati (`:one` / `:many`), mostrare un `QuickPick` quando corrispondono più candidati e rimuovere il fallback `'local-promotion'`.

### 25.3 - promoteAllIdentical: saltare gli elementi con più candidati

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Salto multi-candidato in promote massivo · **Size:** S · **Depends on:** 25.1, 25.2 · **Spec:** [25.3-promote-all-identical-fix.md](25.3-promote-all-identical-fix.md)
- **Goal:** Fare in modo che il percorso di promozione massiva `promoteAllIdentical` della Dashboard agisca solo sugli elementi a singolo candidato e segnali come saltati gli elementi con più candidati.

### 25.4 - Primitive di Move: metodo removeMcpServer dell'adapter + helper di soft-delete

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Primitive di Move e soft-delete · **Size:** M · **Depends on:** 10, 21 · **Spec:** [25.4-move-primitives.md](25.4-move-primitives.md)
- **Goal:** Aggiungere `removeMcpServer(id, loc)` all'interfaccia `Adapter` e a tutti e 5 gli adapter, e aggiungere `softDeletePath` in `src/engine/softDelete.ts` per spostare gli artefatti su file/directory in `.ai-swissknife/_deleted/`.

### 25.5 - Comando "Move to..."

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Comando Move to · **Size:** M · **Depends on:** 18, 25.4 · **Spec:** [25.5-move-command.md](25.5-move-command.md)
- **Goal:** Collegare il comando `moveItem` ("Move to...") in `installedView.ts` usando `planSync` per l'installazione nella destinazione e le primitive di `25.4` per la rimozione dell'origine con `manual-recovery-required` in caso di fallimento parziale.
