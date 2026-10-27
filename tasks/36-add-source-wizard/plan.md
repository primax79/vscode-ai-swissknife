# 36 — Add-source wizard — Implementation plan

> Source: owner idea of 2026-10-08, `_inbox/analyzed/2026-10-08-add-source-wizard.md`.
> Small, well-grounded UX rewrite of one method; no separate spec (inline
> option of `tasks/AGENTS.md`), tasks expanded because it is delegated.

**Depends on:** 29, 30 (resolver registry), 31 (Dashboard action layer) — all merged.

## Problem (grounded)

`SourcesProvider.addSource(forceScope?)` (`src/ui/sourcesView.ts:173-280`) asks, in
this order: scope → type → **id** → display name → location (url or path) →
ref choice (branch/tag/default, then a further input) — up to 7 prompts, with
the least-informative questions (id, name) first and the most-informative one
(location) fifth. Nothing is derived from the location.

## Target flow (owner decision, revised 2026-10-08)

1. **Type** (QuickPick of `ALL_SOURCE_RESOLVERS`, using each resolver's `displayName`/`iconThemeId` instead of raw ids).
2. **Scope(s)**: multi-select Global and/or Workspace (at least one). Skipped when `forceScope` is passed (Dashboard `+` buttons, `recommendations.ts:271`).
3. **Location**: git types and `remote-url` ask one URL shared by all selected scopes. `local-folder` asks **one path per selected scope, independently** (each validated against its own scope constraint, so a global path under home and a project path inside the workspace can differ).
4. **Details, prefilled from the location**: `id` (slug of repo/folder name, from the first location entered) and `name`; one input box each, Enter accepts. Branch/tag is not asked by default for git types (default branch assumed); pinning is reachable only via an explicit optional step (Q2).
5. Write one `DesiredSource` per selected scope, same id/name/type, with that scope's own location.

## Locked-in decisions

- Vocabulary: the `project` scope is shown to the user as **"Workspace"** (CONTEXT.md). Use the literal until 40.4's `getScopeLabel` exists, then that helper.

- Type first, then scope(s), then location (owner, revised). Why: asking scope(s) up front lets `local-folder` ask the right path for each scope, which removes the old "Both only when one path fits both constraints" workaround.
- `local-folder` locations are per scope; git/remote-url are shared.
- `addSource(forceScope?)` keeps its signature and return value (`Source | undefined`; when several scopes are written, return the first): three callers depend on it (`extension.ts:242`, `dashboard.ts:127`, `recommendations.ts:271`).
- Wizard logic that does not need `vscode` (derivation, validation) lives in a pure module so it is unit-testable without the extension host.

## Open questions (resolve with the owner before 36.2/36.3 are dispatched)

- ~~36-Q1 ("Both" + `local-folder`)~~ resolved: scope(s) asked up front, path asked independently per scope.
- ~~36-Q2~~ resolved (owner, 2026-10-08): branch/tag pin is out of the main flow; default branch is assumed; pinning is an optional "Advanced: pin to branch/tag" step.
- ~~36-Q3~~ resolved (owner, 2026-10-08): same id already in a chosen scope → modal "Replace?" per scope instead of the silent overwrite at `src/ui/sourcesView.ts:268`; answering No skips that scope only.
- ~~36-Q4~~ resolved (owner, 2026-10-08, revised): the workspace is known before the scope step, so with no workspace the scope multi-select offers only Global (Workspace not shown, with a one-line hint). No drop-after-selection logic.

## Tasks

### 36.1 - Pure helper: validate location + derive id/name

- **Status:** `delivered` (merged 4a77022 2026-10-08) · **Short:** Validate location and derive defaults · **Size:** S · **Depends on:** - · **Spec:** [36.1-derive-source-defaults.md](36.1-derive-source-defaults.md)
- **Goal:** Create `src/sources/sourceDefaults.ts` exporting `validateLocation` and `deriveSourceDefaults` to validate URLs/paths and derive source `id` and `name` without `vscode` imports.

### 36.2 - Rewrite `addSource` as the type → scope(s) → location → details wizard (single scope)

- **Status:** `delivered` (merged 193b865 2026-10-08) · **Short:** Add-source wizard flow · **Size:** M · **Depends on:** 36.1 · **Spec:** [36.2-wizard-flow.md](36.2-wizard-flow.md)
- **Goal:** Rewrite `SourcesProvider.addSource(forceScope?)` into a type → scope → location → prefilled id/name wizard flow with default branch assumption and optional branch/tag pinning.

### 36.3 - Multi-scope selection (one write per scope, per-scope local paths) + duplicate-id handling

- **Status:** `delivered` (merged 1c73989 2026-10-09) · **Short:** Multi-scope add-source wizard · **Size:** S · **Depends on:** 36.2 · **Spec:** [36.3-scope-both.md](36.3-scope-both.md)
- **Goal:** Turn the add-source scope step into a multi-select (Global and/or Workspace), ask per-scope paths for `local-folder`, and prompt "Replace?" on duplicate source IDs per scope.
