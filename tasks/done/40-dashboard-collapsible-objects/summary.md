# 40 — Dashboard Installed: one collapsible row per object, one child per place — Summary

> **Closed on:** 2026-10-27 (registry tidy; verifier ai-coding-tools-c1)  
> **Initiative:** 40 — Dashboard Installed: one collapsible row per object, one child per place  
> **Status:** ✅ Done and merged into main

Summary written at closure from the plan and the git history; the per-task specs in this folder hold the detail.

## What was built

- **40.1 Pure model: build the object → places tree from managed + observed** — merged 259c313 2026-10-09. Create `src/engine/installedTree.ts` exporting `buildInstalledTree` to group managed and unmanaged items into one `InstalledObject` per `(kind, name)` with sorted `Place` children and `worstState`.
- **40.2 One server-side renderer: collapsed row (chip strip + worst state), child rows per place, filters/sort/detail adapted** — merged b66e068 2026-10-09. Replace the duplicate matrix builders and separate unmanaged table with a single server-side `renderInstalledTree` rendering collapsible object parent rows with place-chip strips and child place rows.
- **40.3 Expand all / Collapse all + collapse state kept across refreshes** — committed 7b40d4f on a task branch, merged into main in 5e85109 (2026-10-27). Add Expand all and Collapse all icon buttons to the Installed toolbar and persist expanded parent identities in webview state across data refreshes.
- **40.5 Filter bar: Env/Scope/Membership/Kind as visually grouped pill groups (replaces the `<select>`s)** — merged 4412b33 2026-10-09. Replace the Scope and Membership `<select>` dropdowns and separate Kind tab row with four visually grouped, labelled pill groups (ENV, SCOPE, MEMBERSHIP, KIND).
- **40.4 Scope vocabulary (Global/Workspace) + icons as a shared module — run before 40.2** — merged bc4b935 2026-10-09. Create `src/ui/scopeIcons.ts` as the single source of truth for Global/Workspace labels and icons and replace user-facing "Project" scope strings across the UI.

## Verification

- Every task's work is merged into `main` (evidence: the commits named above, from `git log --grep '<id>'`).
- `npm test` on `main` at 5e85109 (2026-10-27): 577 tests, 576 pass, 0 fail, 1 opt-in skip (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errors.
