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

1. **[35.1 — Instant loading shell](35.1-instant-loading-shell.md)**: fixes item 1.
2. **[35.2 — Overview tab content](35.2-overview-content.md)**: fixes item 2.
3. **[35.3 — Installed matrix view](35.3-installed-matrix-view.md)**: fixes items 3, 4, 5, 6, 7 together (one coherent redesign, see design spec in that task file).
4. **[35.4 — Catalog rows as a real table](35.4-catalog-as-table.md)**: fixes item 8.
5. **[35.5 — Icon-only buttons across the Dashboard](35.5-icon-only-buttons.md)**: fixes item 9, swept last across every other task's final button set.

**Task order and gating:**

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
