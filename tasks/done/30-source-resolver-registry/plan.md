# 30 — Registro dei risolutori di sorgenti — Piano di implementazione

> **Derivato dalla specifica:** [`../specs/adapter-and-source-registries.md`](../../specs/adapter-and-source-registries.md)

## Tasks

## Ordine dei task e dipendenze

- **30.1 blocca 30.2** (non è possibile incapsulare i moduli in una forma non ancora definita).
- **30.2 blocca 30.3** (non c'è nulla da aggregare/verso cui migrare finché non esistono gli oggetti wrapper).
- **30.3 blocca 30.4** (30.4 dipende dal modulo del registro creato da 30.3).
- Indipendente dall'iniziativa 29 (registro degli adapter) — moduli diversi, nessun codice condiviso; può essere eseguita prima, dopo o in parallelo ad essa.

**Nota sulla delega:** pacchettizzazione espansa (secondo `tasks/AGENTS.md`), un file
di task per passaggio di consegne. Indirizzare l'agente al singolo file del task + la specifica +
`tasks/CONTEXT.md`.

## Chiusi

### 30.1 - Interfaccia `SourceResolver`

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Interfaccia SourceResolver · **Size:** S · **Depends on:** 04, 11, 20 · **Use cases:** UC023 · **Spec:** [30.1-source-resolver-interface.md](30.1-source-resolver-interface.md)
- **Goal:** Definire l'interfaccia condivisa `SourceResolver` (`type`, `displayName`, `iconThemeId`, `resolve`, `resolveArtifactContent`) in `src/sources/types.ts`.

### 30.2 - Incapsulare i cinque moduli risolutori

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Incapsulamento dei moduli risolutori · **Size:** S · **Depends on:** 30.1 · **Use cases:** UC023 · **Spec:** [30.2-wrap-resolver-modules.md](30.2-wrap-resolver-modules.md)
- **Goal:** Esportare un oggetto conforme a `SourceResolver` per ciascun tipo di sorgente che incapsuli in modo aggiuntivo le funzioni esistenti di ogni modulo.

### 30.3 - `src/sources/registry.ts` + migrazione dei punti di dispatch

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Registro delle sorgenti e migrazione · **Size:** M · **Depends on:** 30.2 · **Use cases:** UC023 · **Spec:** [30.3-source-registry-and-migration.md](30.3-source-registry-and-migration.md)
- **Goal:** Aggregare i cinque risolutori di sorgenti in `src/sources/registry.ts` e sostituire le catene di dispatch su `source.type` in `discovery.ts`, `drift.ts` e `availableView.ts`.

### 30.4 - Migrare lo switch delle icone di `sourcesView.ts`

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Migrazione switch icone sorgenti · **Size:** S · **Depends on:** 30.3 · **Use cases:** UC023 · **Spec:** [30.4-migrate-icon-switch.md](30.4-migrate-icon-switch.md)
- **Goal:** Sostituire in `sourcesView.ts` lo switch `getSourceTypeIcon` con una ricerca di `iconThemeId` in `src/sources/registry.ts`.
