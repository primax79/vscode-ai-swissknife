# Spec — Dashboard Total Refactor: Sidebar Feature Parity

> **Status:** Accepted for task breakdown — Codex (round 1) and Kilo/
> gemini-3.7-flash (round 2) reviews both incorporated below.
> **Parent Spec:** [`SPEC.md`](../../SPEC.md) §3 (Feature Area B — Management)
> **Pre-requisite:** Phase 7 (Initiative 28) completed and merged. Independent
> of the pending Phase 8 (`specs/adapter-and-source-registries.md`,
> initiatives 29-30) — different files, no shared dependency either way.
> **Reviewed by:** Codex (2026-09-08, independent read-only review against
> the real source) and Kilo/gemini-3.7-flash (2026-09-08, independent
> read-only re-verification against the real source, plus a full
> `typecheck && lint && test` run — 241 tests passing). Both rounds
> converged on the same core finding; incorporated below, see the
> "Revised after multi-engine review" callouts.
> **Revisits (narrows further):** the `CONTEXT.md` locked-in decision
> "Sidebar = action, Dashboard = state/detail/cross-reference"
> (2026-09-07, `specs/phase-6-spec.md` §3, narrowed 2026-09-08 by
> `specs/phase-7-spec.md`) is **superseded on one axis and kept on the
> other**: the *split of responsibility* ("sidebar navigates, Dashboard
> explains") stops being a *split of availability*. Every user-triggerable
> action that exists in the sidebar today must also be reachable from the
> Dashboard — organized more comfortably, elegantly, structurally, and in
> more detail than the sidebar's tree/context-menu model allows. The
> sidebar itself is **not reduced** — it stays exactly as useful for users
> who prefer tree navigation. This is additive scope on the Dashboard, not
> a removal anywhere.

## 0. Why this exists

Direct user assessment after Phases 1-7: *"we've worked well on the left
panel, it covers almost every feature; the central Dashboard is pathetic
by comparison — I expect everything doable from the sidebar to also be
available, more comfortably, elegantly, structured and in more detail, in
the Dashboard."*

This is a real, verifiable gap, not a subjective impression. Grounded
against the current source (all citations below re-verified independently
by both review rounds):

- **`DashboardPanel` (`src/ui/dashboard.ts`, 1050 lines) only wires 9
  webview commands** (`refresh`, `checkDrift`, `promote`,
  `promoteAllIdentical`, `edit`, `copyItem`, `moveItem`, `diffItem`,
  `requestDetail` — `src/ui/dashboard.ts:28-105`) against a single
  `InstalledTreeDataProvider` (`src/ui/dashboard.ts:114`,
  `src/extension.ts:550,552`: both `DashboardPanel.render` call sites pass
  only that provider) — no `sourcesProvider`, no `availableProvider`
  injected at all.
- **No Sources management surface.** `SourcesTreeDataProvider.addSource`
  (`src/ui/sourcesView.ts:185`), `.removeSource` (`:294`), `.exportConfig`
  (`:340`), `.exportSource` (`:391`), `.importConfig` (`:422`) exist only
  as sidebar commands (`aiSwissknife.addSource`/`removeSource`/
  `exportConfig`/`importConfig`/`exportSource`, `src/extension.ts:399-407`).
  The Dashboard cannot add, remove, or transfer a source at all.
- **No catalog browse-and-install surface.** `AvailableTreeDataProvider`
  (`src/ui/availableView.ts`, 902 lines) owns `previewArtifact` (`:553`),
  `installArtifact` (`:569`), `installFolder` (`:702`),
  `installSourceGroup` (`:711`), `installBatch` (`:733`, **private**),
  `showPreview`/`showBatchPreview` (`:872,878`) — the entire "discover and
  install something new" workflow. None of it is reachable from the
  Dashboard; today installing anything requires the sidebar tree.
- **No Recommendations surface.** `src/ui/recommendations.ts`
  (`installResolvedArtifacts:20`, `resolveRecommendedSources:101`,
  `handleInstallRecommended:136`) has no Dashboard equivalent. **(Fixed
  after multi-engine review — citation correction, both Codex and Kilo
  independently flagged the original draft's attribution as ambiguous):**
  the `recommendForWorkspace`/`unrecommendForWorkspace` *handlers* are not
  in `recommendations.ts` at all — they are
  `handleRecommendForWorkspace` (`src/extension.ts:162-236`) and
  `handleUnrecommendForWorkspace` (`src/extension.ts:238-306`), registered
  as commands at `src/extension.ts:536-546` alongside `installRecommended`.
  A user cannot see or act on project-recommended installs from the
  Dashboard, despite Initiative 27 having added a status-bar entry point
  specifically to *reach* the Dashboard for this kind of state.
- **`Uninstall` and `Update to latest` are missing entirely from the
  Dashboard.** `InstalledTreeDataProvider.uninstallItem`
  (`src/ui/installedView.ts:817`) and `.updateInstallation` (`:472`) are
  real, working methods reused by nothing in `dashboard.ts`'s message
  switch — the detail panel's action list
  (`src/ui/dashboard.ts:1031-1042`) only ever renders `Promote` (unmanaged)
  or `Copy to...`/`Move to...`/`Edit` (managed).
- **No `createArtifact` entry point** (`aiSwissknife.createArtifact`,
  `src/extension.ts:456-493`, opens `FormEditorPanel` in create mode) — new
  artifacts can only be authored from the sidebar today.
- **Structurally flat, not "structured."** The one thing the Dashboard
  does own — the unified Installed table (Initiative 26) — is a single
  `<table>` with column filters (`src/ui/dashboard.ts:748-762`), no
  grouping by assistant/scope/kind the way the sidebar's `Installed` tree
  now has after Initiative 28.2 (`ScopeGroupItem` → `KindGroupItem`,
  `src/ui/installedView.ts:39-128`). Filtering approximates but does not
  replace a genuinely structured view.

## 1. Goals & scope

Turn `DashboardPanel` into a **superset** of every sidebar
(`Sources`+`Installed`, per Initiative 28's merged tree) capability,
reusing the same underlying domain data and engine logic the sidebar
already calls (no engine changes — see §2's non-goal and §2.1's
qualification), organized as a single-webview, multi-section experience:

1. **Sources & Catalog section** — list sources per scope (global/project)
   with inline Add/Remove/Export/Export-all/Import, and expanding a source
   shows its catalog (folders/artifacts/diagnostics — the same hierarchy
   `AvailableTreeDataProvider.getChildren` already produces,
   `src/ui/availableView.ts:482-551`, **including the diagnostics array**,
   see §4.1) with **Preview** and **Install** inline per artifact, per
   folder, and per whole source (batch).
2. **Recommendations section** — project-recommended-but-missing installs
   (`resolveRecommendations`'s `pending`/`broken` buckets,
   `src/engine/recommendations.ts:13-40`) surfaced as an actionable list:
   install one, install all, or unrecommend — not just a status-bar count.
3. **Installed section (rebuilt)** — same unified table/filter/detail
   panel from Initiative 26, restructured into collapsible
   assistant→scope→kind groups (mirroring `src/ui/installedView.ts`'s
   `ScopeGroupItem`/`KindGroupItem` model) with filters still available as
   a fast path across groups, plus **Uninstall** and **Update to latest**
   added to the per-item detail actions alongside the existing
   Copy/Move/Edit/diff/cross-framework-lookup from Initiative 26.
4. **Create entry point** — a `+ New Artifact` action opening
   `FormEditorPanel` in create mode (reusing `aiSwissknife.createArtifact`'s
   existing flow, `src/extension.ts:456-493`), reachable from the Dashboard
   header.
5. **Visual style is preserved, not reinvented.** Every new section reuses
   the CSS custom properties, pill/badge/chip/tab components, and dark
   VS Code theming already defined in `src/ui/dashboard.ts:426-673` — this
   is a structural/informational expansion of the existing design
   language, not a new one.

### 1.1 New prerequisite goal, added after multi-engine review: provider action-layer decoupling

Both Codex and Kilo/Gemini independently found the same blocking issue
(§2.1, §5 detail): most sidebar action methods are not directly callable
from a webview message handler because they are coupled to live
`TreeItem` instances, not plain domain objects. Before (or as the first
task of) any section above is wired up, the following extraction is
required — **this is UI-layer refactoring, not engine work** (see §2.1):

- `InstalledTreeDataProvider`: add `doUpdateInstallation(inst:
  ManagedInstallation)` and `doUninstallItem(inst: ManagedInstallation)`
  as public methods taking the plain domain object directly, mirroring the
  existing `doSyncItem`/`doMoveItem`/`doPromoteItem`/
  `doDiffAgainstOriginal` pattern (`src/ui/installedView.ts:573,705,648,853`).
  `updateInstallation`/`uninstallItem` (`:472,817`) become thin wrappers
  around them, unchanged for the sidebar's own callers.
  `removeManagedInstallation` (`:790`, currently `private`) needs to stay
  private — `doUninstallItem` calls it internally, same as today's
  `uninstallItem`.
- `AvailableTreeDataProvider`: `installFolder` (`:702`) must not depend on
  `AvailableFolderItem.getAllArtifacts()` (`:76`) when called with a
  plain payload — either accept a resolved artifact-id list directly, or
  do the "get all artifacts under this folder path" lookup server-side
  from the authoritative cached catalog (`getCachedSourceGroups()`) given
  a folder path + source id. `installSourceGroup` (`:711`) and
  `installBatch` (`:733`, currently `private`) need the same treatment —
  resolve from `{sourceId, scope}` against the live cache, not from a
  `SourceItem` instance. `installBatch` becomes non-private (or gets a
  public plain-identifier entry point) since the Dashboard needs it too.
- `src/extension.ts`: `handleRecommendForWorkspace`/
  `handleUnrecommendForWorkspace` (`:162-236,238-306`) currently branch on
  `instanceof AvailableArtifactItem`/`instanceof InstalledInstallationItem`
  — extract identifier-based versions (`sourceId`/`artifactId`/
  `assistant`/`scope` in, no class dependency) into
  `src/ui/recommendations.ts` (where the rest of the recommendation logic
  already lives), keeping the sidebar's own command registrations as thin
  `instanceof`-dispatching wrappers around them.
- **Stable item identity for security-sensitive actions.** The Dashboard's
  existing detail-panel key is `${assistant}:${scope}:${name}`
  (`src/ui/dashboard.ts:165,213`) — missing `kind`, so two different-kind
  artifacts sharing a name collide. `Uninstall`/`Update` must re-resolve
  the target `ManagedInstallation` server-side from current inventory by
  a `{assistant, scope, kind, name}` key, never trust a full object
  (including `path`) round-tripped from the webview — `uninstallItem`'s
  underlying `removeManagedInstallation` deletes at `inst.path`
  (`src/ui/installedView.ts:807`), so a stale/tampered client payload must
  not reach it directly.

## 2. Non-goals (explicit)

- **No sidebar reduction.** `Sources`/`Installed` tree views, their
  commands, and their context menus stay exactly as they are — this spec
  only widens what the Dashboard can do, it does not migrate
  functionality away from the sidebar or deprecate it.
- **No replacement of native VS Code prompts with in-webview forms for
  multi-step flows that need free-text/file-system input** (Add Source's
  type/URL/branch prompts, scope/assistant pickers for Copy/Move,
  Export/Import file dialogs). These stay `showQuickPick`/`showInputBox`/
  `showOpenDialog`/`showSaveDialog` calls triggered *from* the Dashboard's
  webview message handler, exactly as the sidebar already does it —
  decided here (not left open, unlike the original draft): keeps the
  Dashboard's own protocol small and reuses validated logic as-is; revisit
  only if hands-on `.vsix` testing (per §8) surfaces real friction, the
  same bar Phase 7 used.
- **No second webview panel / no split-view.** One `DashboardPanel`,
  reorganized internally into sections — not a new panel type.
- **No new visual design system, color tokens, or component library.**
  Reuse `src/ui/dashboard.ts`'s existing `:root` tokens and CSS classes;
  extend them only where a genuinely new component is needed (e.g. a
  source-catalog nested list), matching the existing look.
- **No change to `FormEditorPanel`** (`src/ui/formEditor.ts`) beyond
  reusing its existing create/edit entry points as-is.

### 2.1 "No engine changes" — confirmed true, qualified

**Confirmed independently by both review rounds**: `src/domain/types.ts`
(`Source`, `Package`, `Artifact`, `ObservedArtifact`, `ManagedInstallation`,
`DriftReport`) and `src/domain/registry.ts` (`DesiredInstallation`,
`DesiredSource`) are plain serializable interfaces; every module under
`src/engine/` (`discovery.ts`, `drift.ts`, `plan.ts`, `apply.ts`,
`sync.ts`, `softDelete.ts`, `configTransfer.ts`, `recommendations.ts`,
`crossFrameworkLookup.ts`, `pendingCounts.ts`) operates only on those
plain objects — none of it needs to change shape or behavior for this
spec. What §1.1 above requires is real, non-trivial work, but it is
**UI-layer** (`src/ui/*` + `src/extension.ts`) decoupling from
`TreeItem`-instance state, not engine/domain work. The original draft's
looser claim ("directly reuse provider methods with webview items, no new
integration work") was wrong; the narrower engine-scope claim is right.

## 3. Design questions — resolved after multi-engine review

1. **Native prompts vs. in-webview forms** — resolved in §2 (keep native).
2. **Catalog data volume / lazy loading** — resolved: `requestCatalog`
   takes `{sourceId, scope}` (not `sourceId` alone — sources can share an
   id across global/project scope, `src/ui/availableView.ts:717`
   already disambiguates the same way), handled server-side by looking up
   the matching `AvailableSourceGroupItem` from `getCachedSourceGroups()`
   and returning its `getChildren()` result including the `diagnostics`
   array (see §4.1) — not the full upfront catalog payload.
3. **Section navigation model** — resolved: build the section
   skeleton/layout **first** (Initiative 32, before the content-heavy
   Initiatives 33-34) — Kilo/Gemini's review flagged that building
   Sources/Catalog and Recommendations content against a placeholder
   single-page layout first, then retrofitting real section navigation
   afterward, risks rework. The skeleton initiative decides tabs vs. rail
   vs. anchored-scroll concretely, informed by how much content each
   section actually needs (already scoped in §1).
4. **New, from multi-engine review: full-HTML-rerender vs. incremental
   updates.** `DashboardPanel.update()` (`src/ui/dashboard.ts:271`)
   currently reassigns `webview.html` wholesale on every refresh/filter
   change, which already resets scroll position on every `checkDrift`/
   `refresh`. Adding lazy catalog expansion, collapsible groups, and
   multi-section state makes a full-DOM-replace model actively lossy
   (open/closed group state, scroll, in-progress search text all reset).
   Resolved: Initiative 32 (section skeleton) also introduces the general
   principle that `getHtml()` renders the page shell once and all
   subsequent data (`sourcesData`, `catalogData`, `recommendationsData`,
   `driftResult`, table row updates) arrives via `postMessage` into
   client-side DOM updates — extending the pattern the Installed table's
   `driftResult` handler already partially uses
   (`src/ui/dashboard.ts:984-1044`), applied consistently everywhere
   instead of only for drift status.

## 4. Message protocol additions (webview ⇄ extension)

New `webview → extension` commands, each mapping onto an existing (or,
per §1.1, newly extracted plain-identifier) provider method:

| Command | Provider call | Existing sidebar command it mirrors |
| --- | --- | --- |
| `addSource` | `sourcesProvider.addSource(scope?)` | `aiSwissknife.addSource` |
| `removeSource` | `sourcesProvider.removeSource(item)` | `aiSwissknife.removeSource` |
| `exportConfig` / `exportSource` / `importConfig` | `sourcesProvider.*` | same-named commands |
| `requestCatalog` (`{sourceId, scope}`) | `availableProvider.ensureCatalogLoaded()` + cache lookup + `getChildren()` | implicit tree expansion |
| `previewArtifact` | `availableProvider.previewArtifact(item)` | `aiSwissknife.previewAvailableArtifact` |
| `installArtifact` / `installFolder` / `installSourceGroup` | `availableProvider.*` (post-§1.1 plain-identifier form) | same-named commands |
| `uninstallItem` / `updateItem` | `installedProvider.doUninstallItem(inst)` / `.doUpdateInstallation(inst)` (§1.1, re-resolved server-side by identity, not trusted from payload) | `aiSwissknife.uninstallItem` / `updateItem` |
| `installRecommended` / `recommendForWorkspace` / `unrecommendForWorkspace` | extracted identifier-based handlers in `src/ui/recommendations.ts` (§1.1) | same-named commands |
| `createArtifact` | opens `FormEditorPanel` create mode | `aiSwissknife.createArtifact` |

New `extension → webview` messages: `catalogData` (per-source lazy
payload, includes `diagnostics`, see §4.1), `sourcesData` (scope-grouped
source list), `recommendationsData` (`pending`/`broken` buckets — `satisfied`
is not needed in the UI per `RecommendedGroupItem`'s own shape,
`src/ui/availableView.ts:47`, which only tracks the two actionable
buckets).

### 4.1 Additions found by multi-engine review

- **Diagnostics.** `catalogData` must include the source's
  `DiagnosticTreeItem` entries (unreadable/malformed artifact detection
  errors) alongside folders/artifacts — otherwise a source with detection
  problems renders as silently incomplete in the Dashboard instead of
  surfacing the same diagnostic the sidebar shows.
- **Cross-refresh after Dashboard-triggered mutations.** Every sidebar
  command that mutates state also refreshes the status bar
  (`updateStatusBar()`, a closure local to `activate`,
  `src/extension.ts:335`) and the relevant tree providers. The Dashboard's
  message handler must do the same after `addSource`/`removeSource`/
  `uninstallItem`/`updateItem`/`installRecommended`/
  `recommendForWorkspace`/`unrecommendForWorkspace`/install actions —
  otherwise the sidebar and status bar drift out of sync with what the
  Dashboard just did. Concretely: `DashboardPanel` needs a reference to
  (or a callback into) the same refresh/status-bar-update functions
  `extension.ts` already wires to its own commands, not just the three
  providers themselves.
- **Auxiliary multi-file artifact browsing — explicitly deferred.**
  `ArtifactFileItem` (`src/ui/artifactFileTree.ts`) lets the sidebar
  browse/open individual files inside a multi-file skill beyond its main
  `SKILL.md`/entry file. This spec's `previewArtifact` only covers the
  entry-file preview (matching today's `previewArtifact` behavior,
  `src/ui/availableView.ts:553`) — full auxiliary-file browsing inside the
  Dashboard is out of scope for this phase, flagged as a candidate
  follow-up, not silently dropped.

## 5. Provider wiring change

`DashboardPanel.render` (`src/ui/dashboard.ts:114`,
`src/extension.ts:550,552`) currently takes only `InstalledTreeDataProvider`.
It must additionally take `SourcesTreeDataProvider` and
`AvailableTreeDataProvider` (both already constructed in `extension.ts:309-311`
before `DashboardPanel.render` is ever called), plus a way to trigger the
same status-bar/cross-provider refresh §4.1 requires — a
constructor/render signature change, not a new provider.

## 6. Risks

- **Webview HTML size/complexity.** `dashboard.ts` is already 1050 lines
  as a single generated HTML string; adding three more sections
  meaningfully grows it. Split the generated HTML into per-section
  template functions inside the same file for readability, without
  changing the "one panel" constraint.
- **Message-handler surface area.** Going from 9 to ~18 webview commands
  in one `switch` (`src/ui/dashboard.ts:28-105`) is a real maintainability
  cost — structure as a command-map (`Record<string, handler>`) rather
  than growing the `switch` linearly, decided at task-breakdown time.
- **Perceived scope creep vs. Phase 6/7's split.** This spec explicitly
  revisits a twice-reaffirmed locked-in decision. The non-goals in §2 are
  the guardrail: the sidebar's *role* doesn't change, only the Dashboard's
  *ceiling* does.
- **§1.1's decoupling work is real, not incidental.** Both review rounds
  independently converged on the same finding — this is not a minor
  wiring detail, it is a prerequisite refactor with its own risk of
  behavior drift between the sidebar's existing call path and the new
  plain-identifier one. Task breakdown must verify both paths still
  produce identical outcomes (same confirmation dialogs, same conflict
  handling, same error messages) after the extraction.

## 7. Initiative breakdown

Numbered from 31 (29-30 are already committed-in-progress as
`specs/adapter-and-source-registries.md`, unrelated to this spec's
*goals* but real overlapping *files*, see §7.1). Sequencing reflects
Kilo/Gemini's review recommendation (skeleton before content) and the new
§1.1 prerequisite:

- **31 — Provider action-layer decoupling** (§1.1: `doUpdateInstallation`/
  `doUninstallItem`, plain-identifier `installFolder`/`installSourceGroup`/
  `installBatch`, identifier-based recommend/unrecommend extracted to
  `recommendations.ts`, stable `{assistant,scope,kind,name}` identity for
  uninstall/update) — **M**. Blocks 33 and 34; sidebar behavior must be
  provably unchanged (task-level regression checks, not just typecheck).
- **32 — Dashboard structural skeleton** (section navigation model per
  §3.3, incremental `postMessage`-driven DOM updates replacing full-HTML
  re-render per §3.4, `+ New Artifact` entry point) — **M**. Touches
  `extension.ts`'s `activate()` (provider wiring) — see §7.1 for why this
  waits on 29 specifically.
- **33 — Dashboard: Sources & Catalog section** (browse/add/remove/
  export/import sources, browse/preview/install catalog contents
  including diagnostics, lazy `requestCatalog{sourceId,scope}`) — **L**,
  depends on 31, 32.
- **34 — Dashboard: Recommendations + Installed action parity** (surface
  `resolveRecommendations` buckets with install-one/install-all/
  unrecommend actions; add `Uninstall`/`Update to latest` to the existing
  detail panel; cross-refresh per §4.1) — **M**, depends on 31, 32.

### 7.1 Sequencing against the in-progress Phase 8

Phase 8 (initiatives 29-30, `specs/adapter-and-source-registries.md`) is
**actively in progress at spec-authoring time** — `main` already has
29.1/29.2/30.1/30.2 merged (the `Adapter`/`SourceResolver` interfaces and
the new `src/adapters/registry.ts` `getAdapter()`/`ALL_ADAPTERS`), and
live worktrees exist for 29.3 (migrate every duplicated
`AssistantId → Adapter` ternary/selection site) and 30.3 (migrate every
`Source.type` dispatch chain to the new resolver registry) as of
2026-09-08. Both directly rewrite code this spec's Initiative 31 also
needs to touch:

- `InstalledTreeDataProvider.updateInstallation`'s adapter-selection
  ternary (currently `src/ui/installedView.ts:505` on `main`, pre-29.3)
  and `removeManagedInstallation`'s equivalent — exactly what 29.3
  migrates to `getAdapter(inst.assistant)`.
- `AvailableTreeDataProvider.installArtifact`'s and
  `.installBatch`'s adapter-selection ternaries (currently
  `src/ui/availableView.ts:590` and `:755`) — same 29.3 target.
- `doDiffAgainstOriginal`'s and `availableView.ts`'s `source.type`
  if/else-if resolution chains — 30.3's target.
- `extension.ts`'s `activate()` — 29.4 changes its provider/view
  registration loop; Initiative 32 also edits `activate()` (constructor
  wiring for `DashboardPanel`).

**Decision:** all four Phase 9 initiatives depend on Phase 8 (29 and 30,
not just their 29.3/30.3 sub-tasks — 29.4/29.5 and 30.4 touch
`extension.ts`/`sourcesView.ts` too, files Phase 9 also edits) being
fully merged first. Rationale: no functional coupling either way (Phase 8
is a pure internal refactor, Phase 9 is new UI surface) — the only
relationship is textual overlap in the same files/lines, and letting two
independent, currently-active efforts rewrite the same ternary chains
concurrently risks either a merge conflict or, worse, a silent
re-introduction of the duplication Phase 8 exists to remove. Waiting
costs nothing but sequencing; task specs below describe the **target**
(post-Phase-8) shape — e.g. "resolve via `getAdapter(inst.assistant)`"
— rather than today's pre-migration ternary, since by the time these
tasks are picked up that should already be the real shape of the code.
Each task still says explicitly to re-verify against current `main`
before starting, in case Phase 8 hasn't fully landed yet.

## 8. Verification approach (carried into every initiative's tasks)

- `npm run typecheck && npm run lint && npm test && npm run build` as the
  baseline gate, same as every prior initiative.
- Initiative 31 specifically: verify the sidebar's existing commands
  (`updateItem`, `uninstallItem`, `installFolder`, `installSourceGroup`,
  `recommendForWorkspace`, `unrecommendForWorkspace`) still behave
  identically end-to-end after routing through the new plain-identifier
  methods — not just that the Dashboard's new path works.
- Manual `.vsix` install + hands-on click-through of every new Dashboard
  action against a real workspace with at least one of each kind
  installed/unmanaged/recommended — per Phase 7's lesson, desk review
  alone missed real navigation friction; this pass touches far more
  surface area than Phase 7 did.
