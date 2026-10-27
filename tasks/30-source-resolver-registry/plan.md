# 30 — Source-resolver registry — Implementation plan

> **Derived from spec:** [`../specs/adapter-and-source-registries.md`](../specs/adapter-and-source-registries.md)

## Tasks

## Task order and gating

- **30.1 gates 30.2** (can't wrap modules into a shape not yet defined).
- **30.2 gates 30.3** (nothing to aggregate/migrate to until the wrapper objects exist).
- **30.3 gates 30.4** (30.4 depends on the registry module 30.3 creates).
- Independent of initiative 29 (adapter registry) — different modules, no shared code; may run before, after, or in parallel with it.

**Delegation note:** expanded packaging (per `tasks/AGENTS.md`), one task
file per hand-off. Point the agent at the one task file + the spec +
`tasks/CONTEXT.md`.

## Closed

### 30.1 - `SourceResolver` interface

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** SourceResolver interface · **Size:** S · **Depends on:** 04, 11, 20 · **Spec:** [30.1-source-resolver-interface.md](30.1-source-resolver-interface.md)
- **Goal:** Define the shared `SourceResolver` interface (`type`, `displayName`, `iconThemeId`, `resolve`, `resolveArtifactContent`) in `src/sources/types.ts`.

### 30.2 - Wrap the five resolver modules

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Wrap resolver modules · **Size:** S · **Depends on:** 30.1 · **Spec:** [30.2-wrap-resolver-modules.md](30.2-wrap-resolver-modules.md)
- **Goal:** Export one `SourceResolver`-conforming object per source type wrapping each module's existing functions additively.

### 30.3 - `src/sources/registry.ts` + migrate dispatch sites

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Source registry and migration · **Size:** M · **Depends on:** 30.2 · **Spec:** [30.3-source-registry-and-migration.md](30.3-source-registry-and-migration.md)
- **Goal:** Aggregate the five source resolvers into `src/sources/registry.ts` and replace `source.type` dispatch chains in `discovery.ts`, `drift.ts`, and `availableView.ts`.

### 30.4 - Migrate `sourcesView.ts`'s icon switch

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Migrate source icon switch · **Size:** S · **Depends on:** 30.3 · **Spec:** [30.4-migrate-icon-switch.md](30.4-migrate-icon-switch.md)
- **Goal:** Replace `sourcesView.ts`'s `getSourceTypeIcon` switch with an `iconThemeId` lookup in `src/sources/registry.ts`.
