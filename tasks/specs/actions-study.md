# Study: item actions on both surfaces (sidebar tree and Dashboard)

Status: **for owner evaluation**, nothing here is decided or scheduled. Triggered by the owner (2026-10-08): uninstall buttons are missing, wanted both in the compact (sidebar) view and in the Dashboard; "study all useful actions and we evaluate them".
Method: inventory read from `package.json` (commands + `view/item/context` menus), the Dashboard `message` switch (`src/ui/dashboard.ts:126-340`), `installedView.ts`, `softDelete.ts`, `drift.ts`. Row-level button presence was verified only for the Dashboard **Installed** section; for the Dashboard Sources/Recommendations tabs only the existence of the message handler was verified (marked "handler").

## 1. What exists today

Item states in play: managed {up-to-date, update-available, modified-locally, modified-and-update-available, missing-on-disk}, unmanaged {identical, differs, local-only}, available (catalog), recommended.

| Action | Sidebar (compact) | Dashboard |
| --- | --- | --- |
| Install (one / folder / whole source) | Available items: inline | Catalog: handlers `installArtifact`, `installFolder`, `installSourceGroup` |
| Preview file | Available: inline | Installed place rows (managed only); catalog handler |
| Diff vs original | Installed modified, observed `:different`: inline | Place rows (managed, when modified); detail `#diffSection` |
| Update to latest | Installed: inline (always shown, even when up to date) | Place rows (when update available); detail (when update available) |
| Promote to managed | Observed: inline | Unmanaged rows and detail; "Promote N identical" toolbar |
| Copy to other assistant/scope | Installed + observed: inline | Managed detail only |
| Move | Installed: inline | Managed detail only |
| Edit | Installed + observed: inline | Managed detail only (row: none) |
| Recommend / Unrecommend | Installed + available: inline | Recommendations tab only (unrecommend) |
| **Uninstall** | **Installed: inline (last icon)** | **Managed detail panel only; no row button; nothing for unmanaged** |
| Check drift | Installed title bar | Toolbar |
| Refresh catalog / installed | Title bars | Toolbar |
| Source: add / remove / export / import / open in Dashboard | Sources title + inline | Sources tab (handlers) |
| Create new artifact | Installed title bar | Toolbar (handler) |

Observations (all verified in code):

1. **Uninstall is already a soft-delete**: `removeManagedInstallation` calls `softDeletePath` (`installedView.ts:~782`), which moves the item to `<.ai-swissknife>/_deleted/<kind>/<name>-<timestamp>/`. But the confirmation says "This deletes it from disk" (`installedView.ts:803`) and **nothing can restore** from `_deleted/`. Recoverable in theory, not in practice, and the message is misleading.
2. **Unmanaged items cannot be removed anywhere.** `softDeletePath` would work for them.
3. **Sidebar and Dashboard diverge** in both directions: sidebar lacks multi-place views; Dashboard lacks Copy/Move/Edit/Recommend/Uninstall on rows and Sync/Edit/Diff for unmanaged.
4. **Update is shown in the sidebar even when nothing is available** (no state predicate in the `when` clause for `updateItem`), the Dashboard shows it only when relevant.
5. **Several states have no remedy**: `missing-on-disk` (record exists, files gone), `modified-locally` (diff but no revert), unmanaged (no "stop tracking" inverse of Promote exists for managed).
6. No multi-select / bulk action on items on either surface (only Promote-all-identical and Install-all-in-source/folder exist).
7. Icon crowding: up to 5 inline icons on an installed sidebar row (`inline@1..5`), which is the practical ceiling of a tree row.

## 2. Candidate actions

Value = how often the owner would use it / how much pain it removes; Cost = implementation size; Risk = data-loss or semantic risk. Already planned work is marked **(planned: NN)**.

| # | Action | Applies to | Value | Cost | Risk | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | **Uninstall everywhere it is useful** (sidebar + Dashboard rows + detail); message corrected to "moved to trash, restorable" | managed | High | S | Low | Missing today on Dashboard rows. Fold into 39.2 / 40.2. |
| A2 | **Remove unmanaged: soft (trash) and hard (permanent)** | unmanaged | High | S | Low (soft) / High (hard, irreversible, explicit confirm) | `softDeletePath` exists; hard = `fs.rm`. Decided in 39.Q1. |
| A3 | **Restore from trash** (list `_deleted/`, restore to original location, conflict prompt) | trashed items | High | M | Low | Makes A1/A2 truly safe; also needed for "undo". Needs a "Trash" view or a QuickPick. |
| A4 | **Install elsewhere from source** | any place | High | M | Low | **(planned: 41)** |
| A5 | **Copy / Move on every row, both surfaces** | managed + unmanaged | Medium | S | Low | Exists partly; parity task. |
| A6 | **Refresh one source** | source | Medium | M | Low | **(planned: 38)** |
| A7 | **Update all** (per source, per scope, or everything with an update) with one summary | managed | High | M | Medium | Uses the 37.1 apply loop; must skip `modified-locally` unless confirmed. |
| A8 | **Revert to source version** (discard local edits) | modified-locally | Medium | S | Medium | Today Diff then manual. Overwrite flow already exists in install; needs the trash for safety (A3). |
| A9 | **Repair / reinstall** | missing-on-disk | Medium | S | Low | Reinstall from the recorded source or drop the stale record (two choices). |
| A10 | **Unmanage (detach)**: stop tracking, keep files | managed | Medium | S | Low | Inverse of Promote. |
| A11 | **Align places**: pick one place as reference and overwrite the other places of the same object | object with several places | Medium | M | Medium | The collapsible tree (40) makes the need visible. Uses the 37.1 matrix with `overwrite`. |
| A12 | **Compare two places** (diff claude copy vs kilo copy) | object with several places | Medium | M | Low | Needs a "pick the other side" QuickPick; reuses the diff editor. |
| A13 | **Reveal in Finder / copy path / open source repo/commit URL** | any place | Medium | S | None | Pure navigation helpers, one handler each. |
| A14 | **Pin version** (hold at a commit, excluded from Update all) | managed | Low-Medium | M | Medium | Needs a manifest field; defer until A7 exists. |
| A15 | **Bulk selection** (checkboxes in the Dashboard tree, multi-select in the sidebar) with Uninstall/Update/Copy/Recommend on the selection | all | High | L | Medium | Biggest UX lever, biggest change; depends on the tree (40). |
| A16 | **Enable/disable** an installed item without uninstalling (e.g. move to a disabled folder) | managed | Low | M | Medium | Not every assistant supports a clean disable; skip unless asked. |
| A17 | **Export one item as a shareable file/snippet** | any | Low | S | None | `exportSource` exists for sources only. |
| A18 | **Recommend/unrecommend on Dashboard rows** | installed | Low-Medium | S | None | Parity only. |

## 3. Surface policy (no registry)

Owner decision (2026-10-08): **no action registry**, keep it simple. Sidebar menus stay in `package.json`, Dashboard buttons stay in `dashboard.ts`, each added by hand. The drift risk is handled by a plain checklist instead: the parity table in task 39.2 (one row per command x surface) is kept in the task file and a single test asserts that every Dashboard message handler has a button somewhere and that each sidebar command that applies to items has a Dashboard counterpart or an explicit "sidebar only" note.

Policy for where actions go:
- **Sidebar inline**: at most 3 icons per row, chosen by relevance to the state (e.g. Update only when an update is available, Diff only when modified/different, Uninstall always); everything else in the right-click menu.
- **Dashboard row** (compact tree rows, icon-only): the same top 3 icons plus an overflow `...` menu for the rest.
- **Dashboard detail panel**: the full set, icon + short label (39.Q3).

## 4. Suggested bundling (for evaluation, not decided)

- **Tier 1, do first** (cheap, removes the pain you named): A1, A2, A3, A13, A18 + the surface policy. This also finishes 39.2.
- **Tier 2, high leverage**: A7 (update all), A9, A10, A8, A5.
- **Tier 3, needs the tree and bulk model**: A15, A11, A12.
- **Defer**: A14, A16, A17.
- Already planned and unaffected: A4 (41), A6 (38), multi-target install (37).

## 5. Questions for the owner

**AS-Q1.** ~~Confirm Tier 1~~ resolved (owner): Tier 1 yes, **no registry**. Confirm Tier 1 as the next batch (no registry; buttons added by hand per the surface policy above).
**AS-Q2.** ~~A2~~ answered (2026-10-08): removal of unmanaged items with **both soft (trash) and hard (permanent)** modes; applied to managed Uninstall too unless the owner objects. Recorded in initiative 39 (Q1).
**AS-Q3.** ~~A3: where does the trash live in the UI: a "Trash" node in the sidebar, a command with a QuickPick, or a Dashboard section? (Recommendation: QuickPick command + a Dashboard section later.)~~ superseded: owner then chose **all three** surfaces (QuickPick command, Dashboard Trash tab, sidebar Trash view), see initiative 42.
**AS-Q4.** ~~Sidebar inline limit~~ answered (owner, 2026-10-08): always inline Favorite, Update, Uninstall (enabled/disabled by state); every other applicable action in the context menu; unmanaged rows: Promote / Diff / Remove. See initiative 42, task 42.3.
**AS-Q5.** ~~Which of A7-A12 do you actually want?~~ delegated: implement Tier 1 first (initiative 42 + 39.2), then evaluate the result together before choosing Tier 2/3.
