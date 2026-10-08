# 41 — "Install elsewhere" from a Dashboard row — Implementation plan

> Source: owner idea of 2026-10-08, `_inbox/analyzed/2026-10-08-dashboard-installed-feedback.md` (Idea 6).
> Inline plan, tasks expanded because it is delegated.

**Depends on:** 37.1, 37.2 (assistant × scope matrix + unified multi-select install flow), 40.2 (tree rows), 40.4 (scope vocabulary/icons).

## Need (owner)

From a row seen in the Dashboard, install it into another environment/scope **without searching for it in the Sources**: a button that proposes the other envs and scopes, "as from the source".

## Problem (grounded)

- The only per-item way to put an installed item elsewhere in the Dashboard is `Copy to...` (`⧉`, `doSyncItem`, `src/ui/installedView.ts:557-621`), reachable only from the **managed** detail panel (`dashboard.ts:2182`). It copies the *local files of that copy* (no source provenance, no manifest entry), asks one assistant and one scope in two separate QuickPicks, lists all enabled assistants including the one it already is in, and does not know which places already have the item. Unmanaged rows can only use it from the sidebar (`syncItem`).
- Installing "from the source" exists only through the Sources tree / catalog (`AvailableProvider.installArtifact`, `src/ui/availableView.ts:543`), i.e. exactly the search the owner wants to avoid. `resolveArtifactById(sourceId, scope, artifactId)` (`:698`) already maps a managed installation back to its catalog item.

## Target

An icon-only button **"Install to other environments"** (`+`-style, tooltip, 35.5/Q3 rule) on each place row and on the object's collapsed row:

1. Resolve the artifact's **source origin**: managed → `(sourceId, artifactId)` of the installation; unmanaged → the match candidate (if several candidates, ask which); no origin (local only) → fall back to copying the content of the clicked place (existing `planSync`), and say so in the picker title.
2. Propose the **missing places**: every enabled assistant × {Global, Workspace} minus the places where this object is already present (those are not offered; places the kind is unsupported for are listed disabled with the reason from `planInstall`). Workspace entries are absent when no workspace is open (37 plan Q2). Nothing preselected.
3. Hand the chosen places to the unified install flow of 37.2 (final summary with Preview / Install / Overwrite, per-target result reporting of 37.3). Installing from a source records provenance as any install from the catalog does.

## Locked-in decisions

- "As from the source" = the **source's current version**, not the local, possibly modified copy; the local copy is the origin only when no source exists. The existing `Copy to...` stays (it clones this exact copy) and is not removed.
- The button on the **object** row (collapsed) appears only when the object has a registered source; local-only objects get it on their place rows (origin = that place).
- The place picker is a multi-select QuickPick of `(assistant, scope)` pairs with the assistant icon and the scope icon (40.4); it never lists an existing place.
- The same button also appears for unmanaged rows (installing from the matched source also makes the new places managed; the unmanaged original is left alone and can be promoted separately).

## Open questions

- ~~41-Q1~~ resolved (owner, 2026-10-08): an unmanaged item that differs from its source is installed from the **source's version**; the picker title states "from <source>"; the local version stays available via `Copy to...`.

## Tasks

| Task | Title | Depends on | Size |
| --- | --- | --- | --- |
| [41.1](41.1-missing-places-model.md) | Pure model: origin resolution + missing places for an object/place | 37.1 | M |
| [41.2](41.2-dashboard-button-and-flow.md) | Button on rows + place picker + hand-off to the 37.2 flow | 41.1, 37.2, 40.2 | M |
