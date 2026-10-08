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

- Q1. **Meaning of "Overwrite at the end".** Proposal: the final modal offers `Install` (new targets only, existing ones skipped) and `Overwrite` (also replaces existing ones); with no conflicts only `Install` is shown. Alternative: only a single confirm with a checkbox.
- ~~Q2~~ resolved (owner, 2026-10-08): whether a workspace is open is known before the scope step, so with no workspace the scope step offers only Global (Workspace and Both are not shown, with a one-line hint "open a folder to enable workspace scope"). No fallback or skip logic after the choice.
- ~~Q3~~ resolved (owner, 2026-10-08): no preselection and no persisted "last used" state; the multi-select starts with nothing checked.

## Tasks

| Task | Title | Depends on | Size |
| --- | --- | --- | --- |
| [37.1](37.1-target-matrix.md) | Engine helper: plan the assistant × scope matrix and summarize it | - | M |
| [37.2](37.2-multi-select-flow.md) | Unified multi-select install flow in `availableView.ts` | 37.1, Q1-Q3 | M |
| [37.3](37.3-result-reporting.md) | Per-target outcome reporting and partial-failure handling | 37.2 | S |
