# 33 — Dashboard: Sources & Catalog section — Implementation plan

> **Derived from spec:** [`../specs/phase-9-spec.md`](../specs/phase-9-spec.md) §1 (goal 1), §4, §4.1

**Depends on:** 31 (all of it, merged), 32 (all of it, merged).

Tasks (each = one commit):

1. **[33.1 — Sources list + CRUD](33.1-sources-list-crud.md)**: scope-grouped source list with Add/Remove/Export/Export-all/Import wired to `SourcesTreeDataProvider`.
2. **[33.2 — Lazy catalog browsing](33.2-catalog-browsing.md)**: `requestCatalog{sourceId,scope}` message, nested folder/artifact/diagnostics rendering.
3. **[33.3 — Preview action](33.3-preview-action.md)**: `previewArtifact` wired from catalog rows.
4. **[33.4 — Install actions](33.4-install-actions.md)**: single artifact / folder / whole-source install, using Initiative 31.2's decoupled methods.
5. **[33.5 — "Installed in" badges + catalog refresh](33.5-installed-badges-refresh.md)**: per-artifact assistant-install indicator, `refreshCatalog` wiring, cross-refresh per `specs/phase-9-spec.md` §4.1.

**Task order and gating:**

- **33.1 has no dependency on 33.2-33.5** — the source list itself doesn't need catalog browsing to exist.
- **33.2 depends on 33.1** (need a rendered source row to expand into a catalog).
- **33.3 and 33.4 both depend on 33.2** (need catalog rows to preview/install) — independent of each other, dispatch in parallel.
- **33.5 depends on 33.4** (badges reflect install state; refresh wiring follows install actions landing).

**Delegation note:** expanded packaging (per `tasks/AGENTS.md`), one task
file per hand-off. Point the agent at the one task file + `specs/phase-9-spec.md`
(§1, §4, §4.1) + `tasks/CONTEXT.md` + the relevant Initiative 31 task
file(s) for the exact `do*` method signatures being consumed.
