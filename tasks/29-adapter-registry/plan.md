# 29 — Adapter registry & enabled-assistants config — Implementation plan

> **Derived from spec:** [`../specs/adapter-and-source-registries.md`](../specs/adapter-and-source-registries.md)

Tasks (each = one commit):

1. **[29.1 — `Adapter` gains `displayName`/`iconId`](29.1-adapter-interface-fields.md)**: add the two new fields to the interface and implement them on all five adapter classes.
2. **[29.2 — `src/adapters/registry.ts`](29.2-adapter-registry-module.md)**: new module aggregating the five singletons, `getAdapter`, `getAdapterWithHomeRoot`.
3. **[29.3 — Migrate every duplicated adapter-selection site](29.3-migrate-call-sites.md)**: replace the four verbatim `getAdapter()` copies and the independent ternaries/literal-arrays with calls into 29.2's registry.
4. **[29.4 — Enabled-assistants VS Code setting](29.4-enabled-assistants-setting.md)**: `contributes.configuration`, `getEnabledAdapters()`, registry-driven provider/view registration in `extension.ts`, per-view `when` context keys.
5. **[29.5 — "Configure enabled assistants" command](29.5-configure-command.md)**: discoverable multi-select QuickPick on top of 29.4's setting.

**Task order and gating:**

- **29.1 gates 29.2** (the registry module imports the enriched interface/classes; not strictly required for `getAdapter`/`getAdapterWithHomeRoot` to type-check without the new fields, but 29.2's own point is moot without them, so do 29.1 first).
- **29.2 gates 29.3** (there is nothing to migrate call sites *to* until the registry exists).
- **29.3 gates 29.4** (29.4 iterates `ALL_ADAPTERS` inside `extension.ts`'s `activate()` — cleanest once that file's own duplicated literal arrays are already gone per 29.3, so the two changes to the same file don't fight each other).
- **29.4 gates 29.5** (the command writes to the setting 29.4 declares).
- Independent of initiative 30 (source-resolver registry) — no shared code, may run in either order or in parallel.

**Delegation note:** each task below is scoped for a single `kilo_implement`
hand-off (expanded packaging, per `tasks/AGENTS.md`). Point the agent at the
one task file + this spec + `tasks/CONTEXT.md` — not the whole `tasks/`
tree.
