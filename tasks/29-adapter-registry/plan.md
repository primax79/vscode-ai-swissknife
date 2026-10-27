# 29 — Adapter registry & enabled-assistants config — Implementation plan

> **Derived from spec:** [`../specs/adapter-and-source-registries.md`](../specs/adapter-and-source-registries.md)

## Tasks

### 29.1 - `Adapter` gains `displayName`/`iconId`

- **Status:** `delivered` (merged 4d7d654 2026-09-08) · **Short:** Adapter display and icon fields · **Size:** S · **Depends on:** - · **Spec:** [29.1-adapter-interface-fields.md](29.1-adapter-interface-fields.md)
- **Goal:** Add `displayName` and `iconId` descriptive fields directly onto the `Adapter` interface and its five adapter implementations.

### 29.2 - `src/adapters/registry.ts`

- **Status:** `delivered` (merged de6c9f3 2026-09-08) · **Short:** Adapter registry module · **Size:** S · **Depends on:** 29.1 · **Spec:** [29.2-adapter-registry-module.md](29.2-adapter-registry-module.md)
- **Goal:** Create `src/adapters/registry.ts` as the single source of truth exporting `ALL_ADAPTERS`, `getAdapter`, and `getAdapterWithHomeRoot`.

### 29.3 - Migrate every duplicated adapter-selection site

- **Status:** `delivered` (merged 8cb71e5 2026-09-08) · **Short:** Migrate adapter call sites · **Size:** M · **Depends on:** 29.2 · **Spec:** [29.3-migrate-call-sites.md](29.3-migrate-call-sites.md)
- **Goal:** Delete duplicated `getAdapter()` copies and assistant literal arrays across the codebase and replace them with calls into `src/adapters/registry.ts`.

### 29.4 - Enabled-assistants VS Code setting

- **Status:** `delivered` (merged c2be2a0 2026-09-08) · **Short:** Enabled assistants setting · **Size:** M · **Depends on:** 29.3 · **Spec:** [29.4-enabled-assistants-setting.md](29.4-enabled-assistants-setting.md)
- **Goal:** Add `aiSwissknife.enabledAssistants` VS Code configuration, `getEnabledAdapters()`, and registry-driven sidebar view registration with per-view `when` context keys.

### 29.5 - "Configure enabled assistants" command

- **Status:** `delivered` (merged 80a9bd8 2026-09-08) · **Short:** Configure assistants command · **Size:** S · **Depends on:** 29.4 · **Spec:** [29.5-configure-command.md](29.5-configure-command.md)
- **Goal:** Add the `aiSwissknife.configureEnabledAssistants` multi-select QuickPick command and reshape `aiSwissknife.enabledAssistants` to an object of booleans.

## Task order and gating

- **29.1 gates 29.2** (the registry module imports the enriched interface/classes; not strictly required for `getAdapter`/`getAdapterWithHomeRoot` to type-check without the new fields, but 29.2's own point is moot without them, so do 29.1 first).
- **29.2 gates 29.3** (there is nothing to migrate call sites *to* until the registry exists).
- **29.3 gates 29.4** (29.4 iterates `ALL_ADAPTERS` inside `extension.ts`'s `activate()` — cleanest once that file's own duplicated literal arrays are already gone per 29.3, so the two changes to the same file don't fight each other).
- **29.4 gates 29.5** (the command writes to the setting 29.4 declares).
- Independent of initiative 30 (source-resolver registry) — no shared code, may run in either order or in parallel.

**Delegation note:** each task below is scoped for a single `kilo_implement`
hand-off (expanded packaging, per `tasks/AGENTS.md`). Point the agent at the
one task file + this spec + `tasks/CONTEXT.md` — not the whole `tasks/`
tree.
