# 02 — Domain types + registry store — Implementation plan

> **Derived from spec:** [../specs/foundations.md](../specs/foundations.md)

Tasks (each = one commit; hand one file at a time to a delegated agent):

1. [02.1 — Core domain types](02.1-domain-types.md)
2. [02.2 — Registry store (read/write JSON, global + project)](02.2-registry-store.md)

Shared decisions for this initiative that every task must honour:

- Types only in 02.1 — zero logic, zero I/O. All file/JSON I/O is 02.2.
- All 6 `ItemKind` values are declared even though only `skill`/`rule` get
  real behavior in this Phase (see `specs/foundations.md` non-goals) — the
  union type itself is cheap and shared, don't leave it artificially
  narrow.
- Global registry path: `~/.ai-toolkit/registry.json`. Project registry
  path: `<workspace>/.ai-toolkit/registry.json`. Both hold the **same
  schema** (SPEC.md §1 "Registry / Lockfile"): `{ sources: Source[],
  installations: ManagedInstallation[] }`. `ObservedArtifact` is never
  persisted in the registry (SPEC.md §4) — it stays in an in-memory/cache
  structure that later initiatives (discovery, Phase 3) will define; don't
  add a field for it now.
- This initiative depends on 01 (needs `tsconfig.json`/`package.json` to
  exist so the new files typecheck and build).
