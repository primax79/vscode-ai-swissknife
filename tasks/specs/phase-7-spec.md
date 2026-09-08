# Spec — Sidebar Navigation Unification

> **Status:** Accepted, directly authored + implemented in the same pass
> (no external multi-engine review round — narrow, mechanical refactor of
> code fully re-read during authoring; verified with the full gate instead).
> **Parent Spec:** [`SPEC.md`](../../SPEC.md) §3 (Feature Area B — Management)
> **Pre-requisite:** Phase 6 (Initiatives 23-27) completed and merged.
> **Supersedes (narrowly):** the `CONTEXT.md` locked-in decision "Sidebar =
> action, Dashboard = state/detail/cross-reference" (2026-09-07,
> `specs/phase-6-spec.md` §3) is **not reversed** by this spec — the
> Dashboard remains the only place for rich per-item detail, diff, and
> cross-framework lookup. What this spec revisits is narrower: Phase 6's
> non-goal "no restructuring of the sidebar tree hierarchies"
> (`specs/phase-6-spec.md` §2) is lifted for two specific, hands-on-tested
> navigation frictions below — both are still "navigate to act," not "see
> full state."

## 0. Why this exists

Direct user testing of the packaged `.vsix` (2026-09-08) surfaced two
structural sidebar frictions that Phase 6's spec review (desk review, not
hands-on use) could not have caught:

1. **Sources and Available are two separate tree views, with a hidden
   coupling.** Today `Available` shows nothing until the user selects a
   row in `Sources` (`src/extension.ts`'s `sourcesTreeView.onDidChangeSelection`
   wires `availableProvider.setFilterSource(...)`,
   `src/ui/availableView.ts:198-201`). A user has to already know this
   indirect mechanic; the two views read as unrelated until it "clicks."
   The user's explicit ask: fold `Available`'s content-browsing into
   `Sources` as one tree, so expanding a source directly shows what it has.
2. **`Installed` has no per-kind grouping.** Every installed item under one
   `"${assistant} (${scope})"` group renders flat
   (`src/ui/installedView.ts:220-230`), kind shown only in the item's
   `description` string. For a source/assistant with many items across
   several kinds, scanning for "just the skills" means reading every row.

Both are pure navigation-ergonomics fixes within the existing "sidebar
browses, Dashboard explains" split — no new per-item detail surface, no
new webview, nothing moves out of the Dashboard.

## 1. Non-goals

- **No change to the Dashboard.** `DashboardPanel` (initiative 26) keeps
  owning per-item detail, diff, and cross-framework lookup untouched.
- **No change to `Installed`'s top-level `"${assistant} (${scope})"`
  grouping** — only an additional level *inside* it.
- **No new artifact-kind-level actions.** A kind-group node (e.g. "Skills
  (4)") is a pure navigation folder — collapse/expand only, no bulk
  install/promote/recommend at the kind-group level (that already exists
  at the source-group / folder level for Available content, and is not
  extended here).
- **No change to `Available`'s per-item actions or install/preview flow.**
  `installArtifact`, `installFolder`, `installSourceGroup`, batch install,
  preview-before-install, `recommendForWorkspace`/`unrecommendForWorkspace`
  keep their exact current logic — only *where in the tree* they're
  reachable from changes.
- **No fix to the pre-existing `sourceId`-collision-across-scope ambiguity**
  (inherited from Phase 6 §2, still out of scope here).
- **`UnmanagedGroupItem` (Installed's "unmanaged" section) gets the same
  kind-grouping as managed items, for consistency** — this is the one
  place this spec *adds* scope beyond the user's literal two asks, because
  shipping kind-grouping for managed items only, right next to a still-flat
  unmanaged section, would be a visibly inconsistent result for a small
  amount of extra, mechanical work.

## 2. Locked-in decisions

- **Composition, not a rewrite.** `AvailableTreeDataProvider`
  (`src/ui/availableView.ts`, 802 lines, already covers 5 source types,
  diagnostics, hierarchy-building, install/batch/preview, and is fully
  covered by existing tests) keeps every method and class as-is.
  `SourcesTreeDataProvider` (`src/ui/sourcesView.ts`) becomes the single
  *registered* `TreeDataProvider` for the merged view and **delegates** to
  an injected `AvailableTreeDataProvider` instance for everything below the
  `Source` level (diagnostics, folders, artifacts, the cross-source
  "Recommended" group). *Why:* the merge is a presentation change
  (which view hosts which nodes), not a logic change — re-deriving
  `buildHierarchy`/resolution/install logic a second time would duplicate
  ~500 lines and double the surface area for regressions, for a file this
  session already fully read and trusts.
- **One node per source, not two.** `AvailableSourceGroupItem` (today a
  separate wrapping tree node under the old `Available` root) is **not**
  rendered as its own visible node anymore — `SourceItem` (the existing
  `Sources`-tree node) *is* the group node now: its children are exactly
  what `AvailableSourceGroupItem`'s children were (diagnostics + hierarchy).
  `installSourceGroup`'s handler moves from taking an
  `AvailableSourceGroupItem` argument to taking a `SourceItem` and resolving
  its packages from `AvailableTreeDataProvider`'s cache by
  `(source.id, source.scope)` lookup — same data, no new resolution path.
  *Why:* a literal `Source → "Source" (again) → content` double node would
  be a confusing, redundant tree shape; collapsing them is what "merge"
  concretely means here.
- **Cache invalidation fix as a direct byproduct, not scope creep.** Adding
  or removing a source
  (`SourcesTreeDataProvider.addSource`/`removeSource`,
  `src/ui/sourcesView.ts`) currently calls only `this.refresh()` — it never
  invalidates `AvailableTreeDataProvider`'s `cachedSourceGroups`
  (`src/ui/availableView.ts:211-213`, only cleared by the explicit
  `aiSwissknife.refreshCatalog` command or an empty-cache lazy load). Once
  Sources and content are the same tree, showing a newly-added source with
  stale (or absent) content until the user manually hits "Refresh Catalog"
  would be an obviously broken result of *this* change, not a pre-existing
  quirk users tolerate today (today the two views' separateness half-hides
  it). `addSource`/`removeSource` now also call
  `availableProvider.refreshCatalog()`. *Why:* fixing it is strictly
  smaller than leaving a newly-visible bug in the merged tree.
- **Kind-group icons reuse the existing per-item icon mapping exactly**
  (`src/ui/installedView.ts:150-161`: agent→robot, command→terminal,
  mcp-server→plug, hook→zap, rule→book, skill→check) — no new icon set to
  design or maintain.
- **A kind group only renders when non-empty** — no empty "Rules (0)"
  folders, consistent with how `InstalledGroupItem`/`UnmanagedGroupItem`
  already only appear when they have members
  (`src/ui/installedView.ts:220-242`).

## 3. Feature description

### 3.1 Sources ⨯ Available merge

**Before:**
```
Sources                          Available
├─ Global Sources                ├─ Recommended (if any)
│   └─ source-a                  └─ (nothing, until a Sources row is
├─ Project Sources                   selected — then shows that one
    └─ source-b                      source's diagnostics/folders/artifacts)
```

**After (one tree, "Sources"):**
```
Sources
├─ Recommended (if any pending/broken desiredInstallations)
├─ Global Sources
│   └─ source-a  [type icon]
│       ├─ ⚠ diagnostics (if any)
│       └─ folders/artifacts (install on click, same as today)
└─ Project Sources
    └─ source-b  [type icon]
        └─ ...
```

- `SourceItem.collapsibleState` changes from `None` to `Collapsed`.
- `SourcesTreeDataProvider` constructor takes an
  `AvailableTreeDataProvider` instance (`extension.ts` constructs
  `availableProvider` first, passes it into `new
  SourcesTreeDataProvider(availableProvider)`).
- `SourcesTreeDataProvider.getChildren`:
  - root: `[RecommendedGroupItem?, ScopeGroupItem('global'), ScopeGroupItem('project')]`
    (recommended group fetched via `availableProvider`'s cache, loading it
    first if empty — mirrors the exact lazy-load `AvailableTreeDataProvider.
    getChildren` already does today).
  - `ScopeGroupItem`: unchanged (lists `SourceItem`s from the manifest).
  - `SourceItem`: look up the matching cached `AvailableSourceGroupItem` by
    `(source.id, source.scope)` (loading the catalog first if empty) and
    return `availableProvider.getChildren(matchedGroup)` — i.e. exactly the
    diagnostics+hierarchy children `Available` renders today.
  - Anything else (`AvailableFolderItem`, `DiagnosticTreeItem`,
    `RecommendedGroupItem`, `RecommendedBrokenItem`, artifact leaves):
    delegate straight to `availableProvider.getChildren(element)` —
    unchanged rendering.
- `SourcesTreeDataProvider.getTreeItem`: own rendering for
  `ScopeGroupItem`/`SourceItem` (unchanged from today, `SourceItem` keeps
  its type icon from the earlier icon fix), delegates everything else to
  `availableProvider.getTreeItem(element)`.
- `AvailableTreeDataProvider` gains two small read-only accessors
  (`getCachedSourceGroups()`, `getCachedRecommendedGroup()`) so
  `SourcesTreeDataProvider` can look up a source's resolved content without
  duplicating the private cache. `filterSource`/`setFilterSource`/
  `AvailablePlaceholderItem` are deleted (dead code once nothing drives a
  "select a source to filter" indirection — confirmed zero other
  references via `grep -rln 'setFilterSource\|filterSource\|AvailablePlaceholderItem' src`
  outside `extension.ts`/`availableView.ts`/`ui.test.ts`).
- `extension.ts`: remove the `aiSwissknife.available` `registerTreeDataProvider`
  call and the `sourcesTreeView.onDidChangeSelection` wiring entirely, since
  there is no longer a second view to drive.
- `package.json`: remove the `aiSwissknife.available` view contribution;
  every `menus` entry whose `when` was `view == aiSwissknife.available`
  moves to `view == aiSwissknife.sources` (view/title's `openDashboard`/
  `refreshCatalog`; view/item/context's `installArtifact`, `installFolder`,
  `installSourceGroup`, `recommendForWorkspace`/`unrecommendForWorkspace`
  for `availableArtifact*`); `installSourceGroup`'s `when` changes from
  `viewItem == availableSourceGroup` to `viewItem == sourceItem` (see the
  "one node per source" decision above) — this puts it alongside
  `removeSource`/`openInDashboard`, already on `sourceItem` today.

### 3.2 Installed kind-grouping

**Before:** `InstalledGroupItem("kilo-code (project)")` → flat list of 6
items, kind only in each row's description.

**After:** `InstalledGroupItem("kilo-code (project)")` → `KindGroupItem`
per kind present (`Skills (4)`, `Agents (2)`, …) → the same
`InstalledInstallationItem`s as today, unchanged rendering/commands.
Same treatment for `UnmanagedGroupItem` → `KindGroupItem` →
`ObservedArtifactItem`s.

- New class `KindGroupItem { kind: ItemKind; label: string; parentKey: string }`
  (parentKey disambiguates e.g. "kilo-code (project) managed" from
  "kilo-code (project) unmanaged" so two kind-group nodes with the same
  kind label under different parents don't collide in VS Code's tree-item
  identity).
- `InstalledTreeDataProvider.getChildren(InstalledGroupItem)`: instead of
  mapping installations straight to `InstalledInstallationItem[]`, group
  them by `kind` first, emit one `KindGroupItem` per non-empty kind
  (stable order: skill, agent, command, mcp-server, hook, rule, matching
  `ItemKind`'s declaration order), each `Collapsed`.
- `InstalledTreeDataProvider.getChildren(KindGroupItem)`: returns the
  (already-computed) installations/observed items for that kind, applying
  the exact same per-item logic (drift report lookup, `isRecommended`,
  candidate contextValue) that today's flat map applies inline — moved,
  not changed.
- Same restructuring for `UnmanagedGroupItem` → `KindGroupItem` →
  `ObservedArtifactItem`.

## 4. Grounding references (re-verified 2026-09-08 against real source)

- `src/ui/availableView.ts:176-475` — `AvailableTreeDataProvider` class,
  `getTreeItem`/`getChildren`, `filterSource` mechanic (196-209, 415-425).
- `src/ui/availableView.ts:610-631` — `installFolder`/`installSourceGroup`.
- `src/ui/sourcesView.ts:29-235` — `SourcesTreeDataProvider`,
  `SourceItem`/`ScopeGroupItem`, `addSource`/`removeSource`.
- `src/extension.ts` — `sourcesTreeView` creation and
  `onDidChangeSelection` wiring (`377-385` as of this spec's authoring);
  `registerTreeDataProvider('aiSwissknife.available', ...)`; command
  registrations for `installArtifact`/`installFolder`/`installSourceGroup`/
  `refreshCatalog`/`recommendForWorkspace`/`unrecommendForWorkspace`.
- `package.json` `contributes.views`/`contributes.menus` — every
  `view == aiSwissknife.available` entry (`view/title` and
  `view/item/context` sections).
- `src/ui/installedView.ts:57-278` — `InstalledTreeDataProvider`,
  `InstalledGroupItem`/`UnmanagedGroupItem`, the flat-map `getChildren`
  branches to restructure, the icon-per-kind mapping (150-161) to reuse.
- `src/ui/ui.test.ts` — existing coverage for both providers
  (`AvailableTreeDataProvider & buildHierarchy`,
  `InstalledTreeDataProvider`, `Recommend and Unrecommend Commands`) that
  must keep passing (updated where construction signatures change) plus
  new coverage for the merged tree and kind-grouping.
- `tasks/CONTEXT.md`'s "Sidebar = action, Dashboard = state/detail/
  cross-reference" bullet — narrowly amended (not deleted) to record this
  spec's scope-in.

## 5. Tasks

See [`28-sidebar-unification/plan.md`](../28-sidebar-unification/plan.md).
