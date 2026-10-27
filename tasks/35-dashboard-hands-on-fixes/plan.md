# 35 — Dashboard: hands-on testing fixes — Implementation plan

> Driven directly by user feedback after hands-on `.vsix` testing of Phase 9
> (initiatives 31-34), same pattern as Phase 7 revisiting Phase 6. No
> separate spec file — narrow, well-grounded UI fixes, documented here
> directly per `tasks/AGENTS.md`'s "packaged inline... for small/medium
> initiatives" option.

**Depends on:** 31-34 (all merged).

## Feedback (verbatim, translated)

1. Opening the Dashboard shows a black screen until the first data fetch
   completes — needs an instant empty-table-with-loader shell instead.
2. The Overview tab is empty (`getOverviewHtml()` is a literal placeholder,
   `src/ui/dashboard.ts:636-640`).
3. The Installed tab's flat table is visually poor.
4. Missing: a per-tool comparison view (skills/agents/etc.) showing, for
   each artifact, which assistants/frameworks have it installed — to
   compare environments.
5. Missing diff and preview quick-actions (currently diff only reachable
   through the detail panel's conditional `#diffSection`,
   `src/ui/dashboard.ts:939-940`; no preview at all for already-installed
   items).
6. Missing an Update quick-action in the table row itself (only `Edit`
   exists per row, `:530,1011`; Update/Uninstall are detail-panel-only
   since Initiative 34.2).
7. No column sorting (kind/name/scope/status) in the Installed view.
8. (Screenshot) The Sources & Catalog artifact rows are ragged/misaligned
   — free-wrapping flex layout, not a real table.
9. Use icons instead of text labels on Dashboard buttons throughout,
   unless text is genuinely indispensable.

**User decision (asked directly, not assumed):** items 3+4 collapse into
one redesign — the per-tool comparison matrix **replaces** the flat table
as the Installed section's primary view, not an added toggle. Clicking a
row still opens the existing detail panel (origin, diff, cross-framework,
Copy/Move/Edit/Uninstall/Update) — no functionality is lost, only
reorganized for cross-environment comparison. Follow-up clarification:
statuses can differ per assistant for the same artifact, so each
artifact needs a sub-row per assistant, not a single collapsed cell.

Tasks (each = one commit):

## Tasks

### 35.1 - Instant loading shell

- **Status:** `delivered` (merged 4a46e04 2026-09-09) · **Short:** Instant loading shell · **Size:** S · **Depends on:** 31, 32, 33, 34 · **Spec:** [35.1-instant-loading-shell.md](35.1-instant-loading-shell.md)
- **Goal:** Synchronously render an instant loading shell with theme styles and a spinner when the Dashboard opens so it never flashes a blank screen while data loads.

### 35.2 - Overview tab content

- **Status:** `delivered` (merged 366aeb2 2026-09-09) · **Short:** Overview tab content · **Size:** S · **Depends on:** 31, 32, 33, 34 · **Spec:** [35.2-overview-content.md](35.2-overview-content.md)
- **Goal:** Replace the Overview tab placeholder with an at-a-glance landing view showing summary stat chips and items needing attention.

### 35.3 - Installed matrix view

- **Status:** `delivered` (merged 7f3b8b9 2026-09-09) · **Short:** Installed matrix view · **Size:** L · **Depends on:** 35.1, 35.2, 35.4 · **Spec:** [35.3-installed-matrix-view.md](35.3-installed-matrix-view.md)
- **Goal:** Replace the Installed flat table with an expandable per-artifact comparison matrix with sub-rows per assistant, quick actions (Preview, Diff, Update), and column sorting.

### 35.4 - Catalog rows as a real table

- **Status:** `delivered` (merged 1afb012 2026-09-09) · **Short:** Catalog grid table · **Size:** S · **Depends on:** 31, 32, 33, 34 · **Spec:** [35.4-catalog-as-table.md](35.4-catalog-as-table.md)
- **Goal:** Convert Sources & Catalog artifact and folder rows from free-wrapping flex layouts to a fixed-column CSS grid table.

### 35.5 - Icon-only buttons across the Dashboard

- **Status:** `delivered` (merged e656d24 2026-09-09) · **Short:** Icon-only dashboard buttons · **Size:** S · **Depends on:** 35.1, 35.2, 35.3, 35.4 · **Spec:** [35.5-icon-only-buttons.md](35.5-icon-only-buttons.md)
- **Goal:** Replace text labels with compact Unicode icon buttons and tooltips across all Dashboard sections where text is not indispensable.

## Task order and gating

- **35.1, 35.2, 35.4 are independent of each other and of 35.3**
  (different sections/methods) — dispatch in parallel.
- **35.3 is the large one** — dispatch after 35.1/35.2/35.4 land, to
  avoid concurrent worktrees all touching `dashboard.ts`'s shared shell/
  CSS at once (same file-overlap caution used throughout Phase 9).
- **35.5 is strictly last** — depends on all four others being merged,
  since it sweeps the final button set they produce.

**Delegation note:** same pattern as Phase 9 — `kilo_implement` with
`isolation='worktree'`, `google/gemini-3.1-pro-preview-customtools`, real
diff review before merge, full gate (`typecheck && lint && test && build`,
zero warnings) before and after merge.
