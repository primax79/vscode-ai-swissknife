# 33 — Dashboard: Sources & Catalog section — Implementation plan

> **Derived from spec:** [`../specs/phase-9-spec.md`](../specs/phase-9-spec.md) §1 (goal 1), §4, §4.1

**Depends on:** 31 (all of it, merged), 32 (all of it, merged).

Tasks (each = one commit):

## Tasks

## Task order and gating

- **33.1 has no dependency on 33.2-33.5** — the source list itself doesn't need catalog browsing to exist.
- **33.2 depends on 33.1** (need a rendered source row to expand into a catalog).
- **33.3 and 33.4 both depend on 33.2** (need catalog rows to preview/install) — independent of each other, dispatch in parallel.
- **33.5 depends on 33.4** (badges reflect install state; refresh wiring follows install actions landing).

**Delegation note:** expanded packaging (per `tasks/AGENTS.md`), one task
file per hand-off. Point the agent at the one task file + `specs/phase-9-spec.md`
(§1, §4, §4.1) + `tasks/CONTEXT.md` + the relevant Initiative 31 task
file(s) for the exact `do*` method signatures being consumed.

## Closed

### 33.1 - Sources list + CRUD

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Sources list and CRUD · **Size:** M · **Depends on:** 31, 32 · **Spec:** [33.1-sources-list-crud.md](33.1-sources-list-crud.md)
- **Goal:** Render the scope-grouped source list in the Dashboard's Sources & Catalog section with Add, Remove, Export, Export All, and Import wired to `SourcesTreeDataProvider`.

### 33.2 - Lazy catalog browsing

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Lazy catalog browsing · **Size:** M · **Depends on:** 33.1 · **Spec:** [33.2-catalog-browsing.md](33.2-catalog-browsing.md)
- **Goal:** Implement on-demand source expansion via `requestCatalog{sourceId, scope}` and `catalogData` messages rendering nested folders, artifacts, and diagnostics.

### 33.3 - Preview action

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Catalog preview action · **Size:** S · **Depends on:** 33.2 · **Spec:** [33.3-preview-action.md](33.3-preview-action.md)
- **Goal:** Wire `previewArtifact` from Dashboard catalog rows to open a read-only preview editor tab via `AvailableTreeDataProvider`.

### 33.4 - Install actions

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Catalog install actions · **Size:** M · **Depends on:** 31.2, 33.2 · **Spec:** [33.4-install-actions.md](33.4-install-actions.md)
- **Goal:** Wire single-artifact, folder, and whole-source install actions from the Dashboard catalog to the decoupled `doInstall*` methods on `AvailableTreeDataProvider`.

### 33.5 - "Installed in" badges + catalog refresh

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Installed badges and refresh · **Size:** S · **Depends on:** 33.4 · **Spec:** [33.5-installed-badges-refresh.md](33.5-installed-badges-refresh.md)
- **Goal:** Display per-artifact installed-in assistant badges on catalog rows, wire `refreshCatalog`, and trigger cross-provider refresh after mutations.
