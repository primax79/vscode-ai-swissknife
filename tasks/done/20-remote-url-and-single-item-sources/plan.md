# 20 — `remote-url` & `git-single-item` sources — Implementation plan

> **Derived from spec:** [`../specs/phase-4-spec.md`](../../specs/phase-4-spec.md) §6 · [`../../SPEC.md`](../../../SPEC.md) §1

Tasks (each = one commit):

## Tasks

## Closed

### 20.1 - `git-single-item` resolver

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** git-single-item source resolver · **Size:** M · **Depends on:** 04, 11 · **Spec:** [20.1-git-single-item-resolver.md](20.1-git-single-item-resolver.md)
- **Goal:** Implement `src/sources/gitSingleItem.ts` reusing `gitCustom.ts`'s clone/checkout/mutex machinery and treating the checked-out repository root as a single `Artifact`.

### 20.2 - `remote-url` resolver

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** remote-url source resolver · **Size:** M · **Depends on:** 04 · **Spec:** [20.2-remote-url-resolver.md](20.2-remote-url-resolver.md)
- **Goal:** Implement `src/sources/remoteUrl.ts` for HTTP(S) fetching of a single artifact file or manifest with hash-based caching.

### 20.3 - Sources-view wiring & verification

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Source types UI wiring · **Size:** S · **Depends on:** 20.1, 20.2 · **Spec:** [20.3-source-types-ui.md](20.3-source-types-ui.md)
- **Goal:** Extend the Add Source flow, catalog resolution, and install planning to support `git-single-item` and `remote-url` sources.
