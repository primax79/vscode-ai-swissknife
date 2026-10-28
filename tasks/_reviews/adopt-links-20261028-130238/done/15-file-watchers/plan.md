# 15 — File watcher per la coerenza — Piano di implementazione

> **Derived from spec:** [`../specs/phase-3-spec.md`](../../specs/phase-3-spec.md) · [`../../SPEC.md`](../../../SPEC.md)

Task (ciascuno = un commit):

## Tasks

## Closed

### 15.1 - File system watcher con refresh sottoposto a debounce

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** File system watcher con debounce · **Size:** S · **Depends on:** 13 · **Spec:** [15.1-file-watchers.md](15.1-file-watchers.md)
- **Goal:** Implementare `setupFileWatchers` in `src/ui/watchers.ts` con refresh sottoposto a debounce di 250ms su `.claude/`, `.kilo/`, `.github/` e `.ai-swissknife/`.

### 15.2 - Integrazione nel ciclo di vita dell'estensione

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Ciclo di vita dei watcher · **Size:** XS · **Depends on:** 15.1 · **Spec:** [15.2-watcher-lifecycle.md](15.2-watcher-lifecycle.md)
- **Goal:** Registrare i file system watcher in `src/extension.ts` garantendo una pulizia corretta alla disattivazione dell'estensione.
