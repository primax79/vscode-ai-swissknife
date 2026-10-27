# Initiative 28 — Sidebar Navigation Unification

Driven by [`specs/phase-7-spec.md`](../../specs/phase-7-spec.md). Implemented
directly (not delegated to Kilo) — both tasks are mechanical
composition/restructuring of code fully re-read during spec authoring, and
review overhead would cost more than it'd catch. Verified with the full
gate (`typecheck && lint && test && build`) plus manual diff review, same
bar as every delegated task in this project.

Two independent tasks, each one commit:

## Tasks

## Closed

### 28.1 - Merge Sources + Available into one tree

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Merge Sources and Available · **Size:** M · **Depends on:** 16, 22
- **Goal:** Unify `SourcesTreeDataProvider` and `AvailableTreeDataProvider` into a single sidebar tree so expanding a source shows its catalog content directly without select-to-filter coupling.

**Scope:**
- `src/ui/sourcesView.ts`: `SourcesTreeDataProvider` takes an injected
  `AvailableTreeDataProvider`; `SourceTreeItem` union expands to include
  the `Available` node types (minus `AvailableSourceGroupItem` and the
  deleted `AvailablePlaceholderItem`); `getChildren`/`getTreeItem` handle
  `ScopeGroupItem`/`SourceItem` directly and delegate everything else;
  `addSource`/`removeSource` also invalidate the injected provider's
  catalog cache.
- `src/ui/availableView.ts`: add `getCachedSourceGroups()`/
  `getCachedRecommendedGroup()` accessors; `installSourceGroup` takes a
  `SourceItem` (type-only import from `sourcesView.ts`, no runtime cycle)
  instead of `AvailableSourceGroupItem`; delete `filterSource`/
  `setFilterSource`/`AvailablePlaceholderItem`.
- `src/extension.ts`: construct `availableProvider` before
  `sourcesProvider`, inject it; drop the `aiSwissknife.available`
  `registerTreeDataProvider` call and the `sourcesTreeView.
  onDidChangeSelection` wiring; update the `installSourceGroup` command
  registration's param type.
- `package.json`: drop the `aiSwissknife.available` view; retarget every
  `view == aiSwissknife.available` menu `when` to
  `view == aiSwissknife.sources`; `installSourceGroup`'s `when` becomes
  `viewItem == sourceItem`.
- `src/ui/ui.test.ts`: update provider construction call sites; add
  coverage for the merged tree (a `SourceItem`'s children resolve to its
  diagnostics+hierarchy; the root includes a `RecommendedGroupItem` when
  present).

**Verification:**
- `npm run typecheck && npm run lint && npm test && npm run build` all
  green.
- Manual read of the final `getChildren`/`getTreeItem` in
  `sourcesView.ts` confirms every `AvailableTreeItem` subtype from the old
  `Available` root is still reachable (diagnostics, folders, artifacts,
  recommended/broken) with no dropped branch.
- `grep -n "aiSwissknife.available"` across `package.json`/`src/` returns
  nothing (fully removed, not left dangling).

### 28.2 - Installed kind-grouping

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Installed kind grouping · **Size:** S · **Depends on:** -
- **Goal:** Add an intermediate per-kind grouping level (`KindGroupItem`) under each assistant/scope group in `InstalledTreeDataProvider`.

**Scope:**
- `src/ui/installedView.ts`: new `KindGroupItem` class; `InstalledGroupItem`
  and `UnmanagedGroupItem` children go through an intermediate per-kind
  grouping step (stable kind order, only non-empty groups rendered); kind
  icons reuse the existing per-item mapping.
- `src/ui/ui.test.ts`: update/extend the `InstalledTreeDataProvider` suite
  for the new intermediate level.

**Verification:**
- `npm run typecheck && npm run lint && npm test && npm run build` all
  green.
- Manual check: an installation set spanning 3+ kinds under one
  assistant/scope renders one `KindGroupItem` per kind present, none for
  kinds absent, and each item's own contextValue/commands are unchanged
  from before (grouping is purely structural).
