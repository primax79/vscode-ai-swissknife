# 39 — Dashboard Installed tab: bug, action parity, status clarity — Implementation plan

> Source: owner feedback with screenshot, `_inbox/analyzed/2026-10-08-dashboard-installed-feedback.md`.
> Inline plan, tasks expanded because it is delegated. Follow-up of initiative 35 (hands-on fixes).

**Depends on:** 31, 32, 34, 35 — merged.

> **Order:** 39.1 first (bug), then 39.4 (detail panel layout/action bar), then initiative 40 (restructures the same rows into a collapsible tree), then 39.2/39.3, whose buttons and badges are placed in 40's child rows. 39.3 step 1 (data investigation) does not depend on 40 and can run any time.

## Findings (grounded)

1. **`[object Object]` is a bug.** `postMessage({ command: 'inventoryData', rowsHtml: { managedRowsHtml, observedRowsHtml } })` (`src/ui/dashboard.ts:715-722`) but the client handler does `tbody.innerHTML = msg.rowsHtml` on `#unifiedTable` (`:2034`), i.e. it assigns the whole object, which stringifies. `#observedTableBody` is never updated by that message, so the Unmanaged table only reflects the first HTML render, not later refreshes.
2. **Action gap, Dashboard vs sidebar.** Sidebar (`package.json:~366-440`): observed items have Promote, Diff (when `:different`), Sync, Edit; installed items have Update, Diff (when modified), Sync, Move, Edit, Recommend/Unrecommend, Uninstall. Dashboard: an unmanaged row has only `Promote` (`:696-699`) and its detail panel only Promote (`:2178-2181`); a managed detail has Copy, Move, Edit, Update, Uninstall (`:2182-2187`) but no Preview, no Diff button (only the conditional `#diffSection`), no Sync, no Recommend. The handlers for `previewInstalledArtifact` (`:297`) and `diffInstalledArtifact` (`:311`) exist; only the buttons are missing. Nothing offers removal of an *unmanaged* item, in either surface.
3. **Green vs yellow.** Both are *unmanaged* items whose content was compared by canonical hash with a registered source (`src/engine/discovery.ts:225-255`): green `badge-success` = identical to source (`:683`), yellow `badge-warning` = differs from source (`:687`). They look alike because the badge is a small low-contrast pill whose only distinguishing signal is two words ("identical to" / "differs from"), and yellow reads as "warning" although "differs" is the normal state of a custom local item. The row action is the same `Promote` for both, though the consequence differs (identical: attach provenance; differs: promote a local copy that will show as modified, `src/ui/installedView.ts:655-658`).
4. **Suspicious data, to check not to assume:** in the screenshot 41 of 45 unmanaged items are "differs from gcube-ai-toolkit" while they are named like that toolkit's own skills (`gcube-changelog-updater`, ...). That may be real divergence or a hash/translation artefact (extra files, whitespace, frontmatter order). 39.3 verifies it before the badge wording is touched.

5. **Detail panel is incomprehensible** (owner screenshot): origin of any observed item is the hard-coded string "local, no known origin" (`dashboard.ts:546`) even when the row says "differs from gcube-ai-toolkit"; Diff (`⇄`) and Promote (`⇧`) are two unlabeled icon buttons in unrelated blocks; no location, no state in words. See 39.4.

## Locked-in decisions

- Icon-only buttons with tooltips (35.5).
- No change to engine semantics of discovery/drift/promote.

## Open questions (resolve with the owner)

- Q1. **Removal of unmanaged items**: you asked for Uninstall; today nothing deletes an unmanaged item (the engine has `src/engine/softDelete.ts`). Proposal: add "Delete (move to trash)" for unmanaged rows using soft-delete, with a modal confirmation, in both Dashboard and sidebar. Alternative: Dashboard parity only, no deletion of unmanaged.
- ~~Q3~~ resolved (owner, 2026-10-08): icon-only applies to the compact tree rows (collapsed object rows, chips, row buttons); the detail panel keeps icon **and** short text label on its actions, because it is where the user asks "what does this do?".
- Q2. **Status vocabulary** (for 39.3). Proposal: *identical* → green "Identical to <source>" with a ✓; *differs* → neutral/info (not yellow) "Custom · differs from <source>" with a one-click Diff; reserve yellow for "modified locally" of managed items. Alternative: keep colors, only improve contrast/labels.

## Tasks

| Task | Title | Depends on | Size |
| --- | --- | --- | --- |
| [39.1](39.1-fix-inventory-rows.md) | Fix `[object Object]` and keep the Unmanaged table in sync | - | S |
| [39.2](39.2-action-parity.md) | Dashboard action parity with the sidebar (preview, diff, sync, recommend, edit, delete) | 39.1, 39.4, 40.2, Q1 | M |
| [39.4](39.4-detail-panel.md) | Detail panel: computed origin, state in words, location, one labeled action bar | 39.1 | M |
| [39.3](39.3-status-clarity.md) | Verify "differs" data, then clarify identical/differs badges | 39.1, 40.2, Q2 | S |
