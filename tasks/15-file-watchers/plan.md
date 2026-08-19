# 15 — File watchers for consistency — Implementation plan

> **Derived from spec:** [`../specs/phase-3-spec.md`](../specs/phase-3-spec.md) · [`../../SPEC.md`](../../SPEC.md)

Tasks (each = one commit):

1. **[15.1 — File system watchers with debounced refresh](15.1-file-watchers.md)**: implement `setupFileWatchers` in `src/ui/watchers.ts` with 250ms debouncing over `.claude/`, `.kilo/`, `.github/`, and `.ai-swissknife/`.
2. **[15.2 — Extension lifecycle wiring](15.2-watcher-lifecycle.md)**: register watchers in `src/extension.ts` ensuring clean disposal on deactivation.
