# 15 — File watchers for consistency — Implementation plan

> **Derived from spec:** [`../specs/phase-3-spec.md`](../specs/phase-3-spec.md) · [`../../SPEC.md`](../../SPEC.md)

Tasks (each = one commit):

## Tasks

## Closed

### 15.1 - File system watchers with debounced refresh

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Debounced file system watchers · **Size:** S · **Depends on:** 13 · **Spec:** [15.1-file-watchers.md](15.1-file-watchers.md)
- **Goal:** Implement `setupFileWatchers` in `src/ui/watchers.ts` with 250ms debounced refresh over `.claude/`, `.kilo/`, `.github/`, and `.ai-swissknife/`.

### 15.2 - Extension lifecycle wiring

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Watcher lifecycle wiring · **Size:** XS · **Depends on:** 15.1 · **Spec:** [15.2-watcher-lifecycle.md](15.2-watcher-lifecycle.md)
- **Goal:** Register file system watchers in `src/extension.ts` ensuring clean disposal on extension deactivation.
