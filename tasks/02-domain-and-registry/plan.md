# 02 — Domain types + registry store — Implementation plan

> **Derived from spec:** [../specs/foundations.md](../specs/foundations.md)

Tasks (each = one commit; hand one file at a time to a delegated agent):

## Tasks

### 02.1 - Core domain types

- **Status:** `delivered` (merged eb779ca 2026-08-18) · **Short:** Core domain types · **Size:** S · **Depends on:** 01 · **Spec:** [02.1-domain-types.md](02.1-domain-types.md)
- **Goal:** Define every core entity from the spec (`AssistantId`, `ItemKind`, `Scope`, `Source`, `Package`, `Artifact`, `ManagedInstallation`, `ObservedArtifact`) as TypeScript interfaces in `src/domain/types.ts`.

### 02.2 - Registry store (read/write JSON, global + project)

- **Status:** `delivered` (merged 6b6c5fe 2026-08-18; commit 7c2c036) · **Short:** Registry JSON store · **Size:** S · **Depends on:** 02.1 · **Spec:** [02.2-registry-store.md](02.2-registry-store.md)
- **Goal:** Implement pure-Node atomic JSON read/write functions for the registry at global and project scopes.

### 02.3 - Persistence and resolved-artifact model (hardening)

- **Status:** `delivered` (merged 29fe38b 2026-08-19) · **Short:** Portable persistence and hardening · **Size:** M · **Depends on:** 02.2, 03.4 · **Spec:** [02.3-hardening.md](02.3-hardening.md)
- **Goal:** Split persistence into shareable `manifest.json` (`DesiredSource`, `desiredInstallations`) and machine-local `state.json` under `.ai-swissknife`, and add typed `ResolvedArtifact<CanonicalSkill>` content resolution and a shared Git cache mutex.

## Shared decisions

Shared decisions for this initiative that every task must honour:

- Types only in 02.1 — zero logic, zero I/O. All file/JSON I/O is 02.2/02.3.
- All 6 `ItemKind` values are declared even though only `skill` gets real
  behavior in this Phase (`rule` is deferred to Phase 2 for the
  resolver/install/UI path, see `tasks/CONTEXT.md` — the adapters stay,
  see `specs/foundations.md` non-goals) — the union type itself is cheap
  and shared, don't leave it artificially narrow.
- **Revised (second Codex review, `../_inbox/analyzed/
  codex-analysis-2.md`, findings B3/I13)**: the data directory is
  `~/.ai-swissknife/` (global) / `<workspace>/.ai-swissknife/` (project),
  **not** `.ai-toolkit` — renamed in 02.3 before any real user has data
  under the old name. Each level now holds **two** files, not one:
  `manifest.json` (shareable, versionable — portable `DesiredSource[]` +
  `desiredInstallations` + `schemaVersion`, no absolute project paths or
  other machine-specific fields) and `state.json` (machine-local —
  `ManagedInstallation[]` + `schemaVersion`, never committed). See 02.3
  for the exact functions. `ObservedArtifact` is still never persisted in
  either file (SPEC.md §4) — later initiatives (discovery, Phase 3) will
  define its own cache structure.
- This initiative depends on 01 (needs `tsconfig.json`/`package.json` to
  exist so the new files typecheck and build). The open 02.3 hardening
  task additionally depends on 03.4's shared skill codec; completed 02.1/
  02.2 remain the domain/store foundation that 03.4 already uses.
