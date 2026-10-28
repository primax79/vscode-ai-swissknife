# 23 — Ricerca di identità cross-framework + accessor condiviso dei contenuti — Piano di implementazione

> **Derived from spec:** [`../specs/phase-6-spec.md`](../../specs/phase-6-spec.md) §4.1, §4.2 (metà accessor), §3

Task (ciascuno = un commit):

## Tasks

## Ordine dei task e vincoli di sequenza

- **23.1 blocca 23.2** (23.2 chiama ciò che 23.1 estrae).
- **23.3 è indipendente** da 23.1/23.2 — legge solamente `ManagedInstallation[]`, senza alcuna risoluzione delle sorgenti.
- L'iniziativa 24 (diff) dipende da 23.2; il pannello di dettaglio dell'iniziativa 26 dipende da 23.3. L'anteprima (24.2) e il resto della Fase 6 non dipendono affatto da questa iniziativa.

## Closed

### 23.1 - Estrarre l'accessor condiviso dei contenuti resolve+translate

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Accessor condiviso resolveAndTranslate · **Size:** M · **Depends on:** 13, 14 · **Use cases:** UC017 · **Spec:** [23.1-shared-content-accessor.md](23.1-shared-content-accessor.md)
- **Goal:** Estrarre `resolveContentFromSource` e le chiamate di traduzione per tipo da `plan.ts` in un accessor condiviso dei contenuti `resolveAndTranslate` che supporti tutti e 5 i tipi di sorgente e i 6 tipi di artefatto.

### 23.2 - Migrare drift.ts e discovery.ts sull'accessor condiviso

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Migrazione drift e discovery · **Size:** M · **Depends on:** 23.1 · **Use cases:** UC017 · **Spec:** [23.2-migrate-drift-discovery.md](23.2-migrate-drift-discovery.md)
- **Goal:** Sostituire la logica inline di risoluzione e traduzione in `drift.ts` e `discovery.ts` con chiamate a `resolveAndTranslate`, colmando la lacuna di drift/rilevamento per `hook` e `rule`.

### 23.3 - Funzione di ricerca di identità cross-framework

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Ricerca identità cross-framework · **Size:** S · **Depends on:** 13, 14 · **Use cases:** UC017 · **Spec:** [23.3-cross-framework-lookup.md](23.3-cross-framework-lookup.md)
- **Goal:** Implementare `findRelatedInstallations` in `src/engine/crossFrameworkLookup.ts` per trovare tutti i record `ManagedInstallation` che rappresentano lo stesso artefatto logico tra assistenti e scope.
