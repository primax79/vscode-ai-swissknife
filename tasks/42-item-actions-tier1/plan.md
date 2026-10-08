# 42 — Item actions, Tier 1 remainder — Implementation plan

> Source: `specs/actions-study.md` (owner decisions 2026-10-08: Tier 1 yes, no action registry; trash UI, inline icon limit and Tier 2/3 delegated to the architect: "mi fido di te", result to be evaluated together afterwards).
> Inline plan, tasks expanded because they are delegated. Complements **39.2** (parity, Remove soft/hard, Recommend on rows), which already covers actions A1, A2, A5, A18 of the study.

**Depends on:** 39.2 (remove), 40.2 (rows), 40.4 (scope vocabulary and icons).

## Locked-in decisions

- No registry/abstraction: buttons and menu entries are added by hand (study section 3).
- **AS-Q3 resolved (owner, 2026-10-08): all three trash surfaces**: a QuickPick command (42.1), a Dashboard Trash tab (42.4) and a sidebar Trash view (42.5), all on the same engine functions (`listTrash` / `restoreFromTrash`). Sidebar note: it is one dedicated, collapsed `Trash` view (not a node inside every assistant view), shown only when the trash is not empty, so the compact sidebar stays clean when there is nothing to restore.
- **AS-Q4 resolved (owner, 2026-10-08):** always inline **Favorite, Update, Uninstall** (enabled/disabled by state, stable positions); everything else applicable to the state in the **context menu**. Unmanaged rows get their own fixed trio Promote / Diff / Remove. Dashboard rows: same trio + an overflow `...` menu. Compact rows are icon-only; the detail panel has icon + label.
- Tier 2/3 actions (update all, repair, unmanage, revert, bulk selection, align/compare places) are **not** in this initiative; they are evaluated with the owner after Tier 1 ships (`AS-Q5`).

## Tasks

| Task | Title | Depends on | Size |
| --- | --- | --- | --- |
| [42.1](42.1-restore-from-trash.md) | Restore from trash + Empty trash: engine (`listTrash`, `restoreFromTrash`, `deleteFromTrash`, `emptyTrash`) and commands | 39.2 | M |
| [42.4](42.4-dashboard-trash-tab.md) | Dashboard Trash tab: list, Restore, Delete permanently, Empty trash | 42.1, 40.4 | M |
| [42.5](42.5-sidebar-trash-view.md) | Sidebar Trash view (collapsed, only when not empty): list, Restore, Delete permanently, Empty trash | 42.1 | S |
| [42.2](42.2-navigation-helpers.md) | Navigation helpers: reveal in Finder, copy path, open source repo/commit | 40.2 | S |
| [42.3](42.3-surface-policy.md) | Fixed inline trio (Favorite/Update/Uninstall; unmanaged: Promote/Diff/Remove) + context menu by state + Dashboard row overflow | 39.2, 40.2, 42.2 | M |
