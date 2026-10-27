# 37 — Install to multiple assistants and scopes — Implementation plan

> Source: owner idea of 2026-10-08, `_inbox/analyzed/2026-10-08-install-multi-scope-multi-assistant.md`.
> Inline plan (no separate spec), tasks expanded because it is delegated.

**Depends on:** 29 (adapter registry / `getEnabledAdapters`), 31 (action layer) — merged. Independent of 36.

## Problem (grounded)

`AvailableProvider.installArtifact` (`src/ui/availableView.ts:543-665`) and `installBatch` (`:780-908`) are two near-copies of the same flow. Each asks **one** assistant (single-pick QuickPick, `:551`/`:789`) and **one** scope (`['project','global']`, `:566`/`:804`), plans once with `planInstall`, then asks a modal confirmation whose wording branches on `plan.conflict` ("Overwrite" vs "Install"), and applies once with `applyInstall`. `installFolder`, `installSourceGroup`, `doInstall*` (Dashboard) all funnel into these two. To put one component in Claude + Kilo, global + project, the user repeats the whole flow up to 4 times.

## Target flow (owner decision)

1. **Assistants**: multi-select QuickPick (`canPickMany`) over `getEnabledAdapters()`.
2. **Scope**: Workspace / Global / **Both**.
3. **Final step**: a single summary of the cross product (assistant × scope): which targets are new, which already exist (conflict), which are unsupported (with the reason from `planInstall`), then the actions **Preview**, **Install**, **Overwrite**.

## Locked-in decisions

- Vocabulary: the `project` scope is shown to the user as **"Workspace"** (CONTEXT.md). Use the literal until 40.4's `getScopeLabel` exists, then that helper.

- The cross product is planned with the existing `planInstall` (one call per target) and applied with the existing `applyInstall` (one call per target, which already rolls back per target). No change to engine semantics.
- The single-item and batch flows are unified behind one function taking `items[]` (single = one-element batch), removing the duplication rather than extending both copies.
- Public method names and signatures (`installArtifact`, `installFolder`, `installSourceGroup`, `doInstall*`, `installBatch`) stay; only their internals change.

## Open questions (resolve with the owner before dispatching 37.2)

- ~~37-Q1~~ resolved (owner, 2026-10-08): the final modal offers `Preview` / `Install` (new targets only, existing ones skipped) / `Overwrite` (also replaces existing ones); with no conflicts only `Install` (plus `Preview`) is shown.
- ~~37-Q2~~ resolved (owner, 2026-10-08): whether a workspace is open is known before the scope step, so with no workspace the scope step offers only Global (Workspace and Both are not shown, with a one-line hint "open a folder to enable workspace scope"). No fallback or skip logic after the choice.
- ~~37-Q3~~ resolved (owner, 2026-10-08): no preselection and no persisted "last used" state; the multi-select starts with nothing checked.

## Tasks

### 37.2 - Unified multi-select install flow in `availableView.ts`

- **Status:** `open` · **Short:** Multi-select install flow · **Size:** M · **Depends on:** 37.1 · **Spec:** [37.2-multi-select-flow.md](37.2-multi-select-flow.md)
- **Goal:** Unify `installArtifact` and `installBatch` in `src/ui/availableView.ts` behind a single flow with multi-select assistants, Workspace/Global/Both scope selection, and a summary modal with Preview/Install/Overwrite.

### 37.3 - Per-target outcome reporting and partial-failure handling

- **Status:** `open` · **Short:** Per-target install outcome report · **Size:** S · **Depends on:** 37.2 · **Spec:** [37.3-result-reporting.md](37.3-result-reporting.md)
- **Goal:** Replace per-flow install notifications with a single summary notification (`applied / skipped / unsupported / failed`), a "Show details" output channel on failure, and a single final refresh.

## Closed

### 37.1 - Engine helper: plan the assistant × scope matrix and summarize it

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Install matrix engine helper · **Size:** M · **Depends on:** - · **Spec:** [37.1-target-matrix.md](37.1-target-matrix.md)
- **Goal:** Create `src/engine/installMatrix.ts` with `planInstallMatrix` and `applyInstallMatrix` to plan and sequentially apply installations across an assistant × scope cross-product.
