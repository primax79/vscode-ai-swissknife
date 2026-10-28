# 20 — Sorgenti `remote-url` e `git-single-item` — Piano di implementazione

> **Derived from spec:** [`../specs/phase-4-spec.md`](../../specs/phase-4-spec.md) §6 · [`../../SPEC.md`](../../../SPEC.md) §1

Task (ciascuno = un commit):

## Tasks

## Closed

### 20.1 - Resolver `git-single-item`

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Resolver sorgente git-single-item · **Size:** M · **Depends on:** 04, 11 · **Use cases:** UC013 · **Spec:** [20.1-git-single-item-resolver.md](20.1-git-single-item-resolver.md)
- **Goal:** Implementare `src/sources/gitSingleItem.ts` riutilizzando il meccanismo di clone/checkout/mutex di `gitCustom.ts` e trattando la radice del repository estratto come un singolo `Artifact`.

### 20.2 - Resolver `remote-url`

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Resolver sorgente remote-url · **Size:** M · **Depends on:** 04 · **Use cases:** UC013 · **Spec:** [20.2-remote-url-resolver.md](20.2-remote-url-resolver.md)
- **Goal:** Implementare `src/sources/remoteUrl.ts` per il recupero HTTP(S) di un singolo file di artefatto o manifesto con caching basato su hash.

### 20.3 - Collegamento nella vista Sources e verifica

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Collegamento UI tipi sorgente · **Size:** S · **Depends on:** 20.1, 20.2 · **Use cases:** UC013 · **Spec:** [20.3-source-types-ui.md](20.3-source-types-ui.md)
- **Goal:** Estendere il flusso Add Source, la risoluzione del catalogo e la pianificazione dell'installazione per supportare le sorgenti `git-single-item` e `remote-url`.
