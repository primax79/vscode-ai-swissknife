# 30 — Source-resolver registry — Implementation plan

> **Derived from spec:** [`../specs/adapter-and-source-registries.md`](../specs/adapter-and-source-registries.md)

Tasks (each = one commit):

1. **[30.1 — `SourceResolver` interface](30.1-source-resolver-interface.md)**: define the shared shape in `src/sources/types.ts`, after re-verifying the five modules' real `resolveArtifactContent` signatures (the spec flags this as unconfirmed).
2. **[30.2 — Wrap the five resolver modules](30.2-wrap-resolver-modules.md)**: one `SourceResolver`-conforming object per module, additive (existing free-function exports untouched).
3. **[30.3 — `src/sources/registry.ts` + migrate dispatch sites](30.3-source-registry-and-migration.md)**: aggregate the five, replace the `if`/`else-if` `source.type` dispatch chains in `discovery.ts` and `availableView.ts` (and any others a fresh grep finds).
4. **[30.4 — Migrate `sourcesView.ts`'s icon switch](30.4-migrate-icon-switch.md)**: `getSourceTypeIcon` reads `iconThemeId` from the registry instead of its own `switch`.

**Task order and gating:**

- **30.1 gates 30.2** (can't wrap modules into a shape not yet defined).
- **30.2 gates 30.3** (nothing to aggregate/migrate to until the wrapper objects exist).
- **30.3 gates 30.4** (30.4 depends on the registry module 30.3 creates).
- Independent of initiative 29 (adapter registry) — different modules, no shared code; may run before, after, or in parallel with it.

**Delegation note:** expanded packaging (per `tasks/AGENTS.md`), one task
file per hand-off. Point the agent at the one task file + the spec +
`tasks/CONTEXT.md`.
