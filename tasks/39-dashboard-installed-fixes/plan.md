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

- ~~39-Q1~~ resolved (owner, 2026-10-08): unmanaged items can be removed, with **both** modes: *soft* (move to the trash `_deleted/`, recoverable, the default) and *hard* (permanent deletion, irreversible). Same two modes offered for managed Uninstall (consistency; confirm with the owner if unwanted). Both in sidebar and Dashboard.
- ~~39-Q3~~ resolved (owner, 2026-10-08): icon-only applies to the compact tree rows (collapsed object rows, chips, row buttons); the detail panel keeps icon **and** short text label on its actions, because it is where the user asks "what does this do?".
- ~~39-Q2~~ resolved (owner, 2026-10-08): identical = green "✓ Identical to <source>"; differs = neutral/info "Custom · differs from <source>" (not yellow) with a one-click Diff; yellow stays for managed "modified locally".

## Tasks

### 39.2 - Dashboard action parity with the sidebar (preview, diff, sync, recommend, edit, delete)

- **Status:** `in progress` (unmanaged delete/preview added in 5e97e59 2026-10-15; missing parity table, unmanaged Edit/Sync, managed Recommend in detail, and soft/hard Remove modal on managed Uninstall) · **Short:** Dashboard action parity · **Size:** M · **Depends on:** 39.1, 39.4, 40.2 · **Spec:** [39.2-action-parity.md](39.2-action-parity.md)
- **Goal:** Bring Dashboard row and detail-panel actions to full parity with the sidebar (Preview, Diff, Sync, Move, Edit, Update, Recommend/Unrecommend, Promote, and soft/hard Remove).

### 39.3 - Verify "differs" data, then clarify identical/differs badges

- **Status:** `open` · **Short:** Clarify identical and differs badges · **Size:** S · **Depends on:** 39.1, 40.2 · **Spec:** [39.3-status-clarity.md](39.3-status-clarity.md)
- **Goal:** Verify whether unmanaged "differs from <source>" items are genuine divergences or hash artefacts, then unify sidebar and Dashboard badge wording and styling (`✓ Identical to <source>` vs neutral `Custom · differs from <source>`).

## Closed

### 39.1 - Fix `[object Object]` and keep the Unmanaged table in sync

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Fix inventoryData row rendering · **Size:** S · **Depends on:** - · **Spec:** [39.1-fix-inventory-rows.md](39.1-fix-inventory-rows.md)
- **Goal:** Fix the client-side `inventoryData` handler assigning `msg.rowsHtml` as an object to `#unifiedTable` and keep both managed and unmanaged table bodies in sync across refreshes.

### 39.4 - Detail panel: computed origin, state in words, location, one labeled action bar

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Comprehensible detail panel · **Size:** M · **Depends on:** 39.1 · **Spec:** [39.4-detail-panel.md](39.4-detail-panel.md)
- **Goal:** Restructure the Dashboard detail panel with a clear header, status in words, computed origin (including unmanaged match candidates), disk path, cross-framework list, and one labeled action bar.
