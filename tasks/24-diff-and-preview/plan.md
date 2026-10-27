# 24 — Diff-vs-original + preview-before-install — Implementation plan

> **Derived from spec:** [`../specs/phase-6-spec.md`](../specs/phase-6-spec.md) §4.2

Tasks (each = one commit):

## Tasks

### 24.1 - Diff-vs-original command

- **Status:** `delivered` (merged 94b8609 2026-09-08; commit 96505a8) · **Short:** Diff vs original command · **Size:** M · **Depends on:** 23.2 · **Spec:** [24.1-diff-vs-original.md](24.1-diff-vs-original.md)
- **Goal:** Add a `diffAgainstOriginal` command on modified managed items and differing unmanaged items that resolves the upstream original via `resolveAndTranslate` and opens `vscode.diff`.

### 24.2 - Preview-before-install action

- **Status:** `delivered` (merged b8e8959 2026-09-07; commit 2614f6d) · **Short:** Preview before install action · **Size:** M · **Depends on:** 06, 07 · **Spec:** [24.2-preview-before-install.md](24.2-preview-before-install.md)
- **Goal:** Add a `Preview` option to the install confirmation flow using a `TextDocumentContentProvider` to inspect `prepared.content` read-only without writing to disk.

## Task order and gating

- **24.1 depends on 23.2** (needs the shared accessor migrated into `drift.ts`/`discovery.ts` so diff has a single place to call for the "original" content, and so `hook`/`rule` diffing isn't built against code slated to change).
- **24.2 has no dependency on this initiative's own 24.1**, or on initiative 23 — it can be dispatched immediately in parallel with everything else in Phase 6.
