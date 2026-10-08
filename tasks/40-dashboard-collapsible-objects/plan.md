# 40 — Dashboard Installed: one collapsible row per object, one child per place — Implementation plan

> Source: owner idea of 2026-10-08, `_inbox/analyzed/2026-10-08-collapsible-installed-rows.md`; owner decisions on the collapsed view and on unification taken the same day (below).
> Inline plan, tasks expanded because it is delegated. Restructures the area that 39 touches: **do 39.1 first, then 40, then 39.2/39.3** (their buttons and badges go into the new rows).

**Depends on:** 35 (matrix view), 39.1 (inventory message fix).

## Problem (grounded)

- Managed items are grouped by `(object, scope)` (`groupByIdentityAndScope`, `src/engine/crossFrameworkLookup.ts:70`): the same skill installed globally and in the project is two parents. Parent rows toggle with `toggleFolder` (`src/ui/dashboard.ts:1736`), start collapsed, and show only assistant icons with a "checking…" badge; there is no expand-all / collapse-all.
- Unmanaged items live in a separate flat table (`#observedTable`, `:1197-1215`) with no grouping.
- The managed matrix HTML is built **twice**: in the `update()` fast path (`:618-672`) and in `getHtml()` (`:1267-1330`). The `[object Object]` bug (39.1) is a symptom of that duplication.

## Target (owner decisions)

- **One tree.** One parent row per object `(kind, name)`; child rows are the *places* where it is actually present: one per `(assistant, scope)`, each with its own state — managed up-to-date / update available / modified locally / missing on disk, or unmanaged identical / differs / local only. The separate Unmanaged table goes away; the existing Membership filter (All / Managed / Unmanaged) filters child rows.
- **Collapsed row** = kind pill, name, a compact **strip of place chips** (the assistant's **icon only, never its name** — same icons as the env filter pills and the current matrix, `getAssistantIconPath` in `src/ui/assistantIcons.ts` — plus the **scope icon** (globe = Global, folder = Workspace, from 40.4) placed right next to the assistant icon, the pair colored by that place's state; the assistant name and scope word appear only in the tooltip) and **one badge with the worst state**, plus a place count in the tooltip. Parents start collapsed.
- **Scope icons.** Global and Workspace get their own icons (single source of truth, `scopeIcons.ts`), always shown **paired with the environment icon** wherever a place is identified (collapsed chips, child rows, the env/scope filters). The user-facing label of the `project` scope is "Workspace" (CONTEXT.md decision, not "Project" or "Local").
- **Filter bar.** Scope and Membership become pill groups like Env (no `<select>`s), and Env, Scope, Membership, Kind are shown as four labelled, visually separated groups (owner feedback with screenshot, 2026-10-08).
- **Expand all / Collapse all** buttons in the Installed toolbar (icon-only, 35.5), and the expand/collapse state of each parent survives data refreshes.

## Locked-in decisions

- Filters apply to child rows (place level): a parent is visible iff at least one of its children passes; non-matching children are hidden while the others stay. Text filter matches the parent name.
- Parent-level `data-*` attributes (kind, name, worst status, set of assistants/scopes/memberships) are derived from the children so sort and the header stats keep working; stats count **places**, not objects (as today they count installations/observations).
- One server-side renderer for both the initial HTML and the `inventoryData` update; the client never builds row HTML.
- No change to discovery/drift/promote engine semantics.

## Open questions

None.

## Tasks

| Task | Title | Depends on | Size |
| --- | --- | --- | --- |
| [40.1](40.1-installed-tree-model.md) | Pure model: build the object → places tree from managed + observed | - | M |
| [40.2](40.2-single-renderer.md) | One server-side renderer: collapsed row (chip strip + worst state), child rows per place, filters/sort/detail adapted | 40.1, 40.4, 39.1 | L |
| [40.3](40.3-expand-collapse-all.md) | Expand all / Collapse all + collapse state kept across refreshes | 40.2 | S |
| [40.5](40.5-filter-bar.md) | Filter bar: Env/Scope/Membership/Kind as visually grouped pill groups (replaces the `<select>`s) | 40.2, 40.4 | S |
| [40.4](40.4-scope-icons.md) | Scope vocabulary (Global/Workspace) + icons as a shared module — **run before 40.2** | - | S |
