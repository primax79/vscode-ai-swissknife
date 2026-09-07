# Spec — Usability & Information-Architecture Overhaul (Sidebar/Dashboard split)

> **Status:** Accepted for task breakdown — Codex (round 1) and Kilo/Gemini
> (round 2) reviews both incorporated below.
> **Parent Spec:** [`SPEC.md`](../../SPEC.md) §3 (Feature Area B — Management)
> **Pre-requisite:** Phases 1-5 (Initiatives 01-22) completed and merged.
> **Reviewed by:** Codex (2026-09-07, independent read-only review against
> the real source, found real feasibility gaps — round 1) and Kilo/
> gemini-3.7-flash (2026-09-07, independent read-only re-verification of the
> round-1-revised spec against the real source, all citations confirmed,
> found 3 additional integration points — round 2). Findings incorporated
> below; see the "Revised after review" callouts.

---

## 1. Goals & scope

Phases 1-5 built full CRUD/install/drift/discovery capability across five
assistants and six kinds, but the two UI surfaces that expose it — the three
sidebar `TreeView`s (Sources/Available/Installed) and the `DashboardPanel`
webview — were built incrementally per-initiative and never reconciled as
one experience. Two real usage scenarios exposed this:

1. **"What do I have installed, in detail, and where else?"** — checking
   what's installed for a given assistant, seeing full detail on one item,
   knowing whether it's installed elsewhere too, is a first-class job this
   tool exists for — not a marginal feature bolted onto an installer.
2. **"Let me explore a source and manage its content."** — browsing one
   source's available artifacts, seeing where each is already installed,
   distinguishing global vs. project installs at a glance.

Neither is served well today. This spec locks in a reframing — **the
sidebar is for action (browse/add/install/promote), the `DashboardPanel` is
the state/detail/cross-reference hub** — and the concrete feature set that
follows from it: a real per-item detail view (origin, diff-vs-original,
cross-framework presence), a `Move` action alongside the existing `Copy`, a
fixed `Promote` disambiguation bug, a rebuilt unified-table Dashboard with
filters instead of structural managed/unmanaged sections, and two new
Dashboard entry points (status bar item, per-source filtered jump).

**(Revised after Codex review)** the original draft understated how much of
this depends on real gaps in `drift.ts`/`discovery.ts`/`plan.ts` (missing
`hook`/`rule` coverage, only 3 of 5 source types matched during discovery, no
uninstall primitive anywhere) rather than pure UI work. §3/§4 below now scope
each feature to what the engine can actually support today, with explicit
follow-on work called out rather than assumed.

## 2. Non-goals (explicit, to prevent scope creep)

- **No extended "Source detail" page inside the Dashboard** (rich content
  previews of an entire source's catalog, etc.) — explicitly floated by the
  user as a future idea, not part of this pass.
- **No restructuring of the sidebar tree hierarchies.** The Installed view's
  flat `"${assistant} (${scope})"` grouping (`src/ui/installedView.ts:206`,
  confirmed against source) and the Available view's per-source hierarchy
  stay as-is. The earlier idea of nesting Assistant→Scope in the sidebar is
  superseded by the sidebar/Dashboard split in §3 — the sidebar's job is
  navigation to act, not the detailed "point of truth," so it does not need
  a richer hierarchy.
- **No second, separate "per-framework" Dashboard page/route.** "Global
  summary" and "per-assistant view" are the same screen with the Environment
  filter (§4.5) at `All` vs. one assistant — not two maintained renderers.
- **No literal auto-sync of the Dashboard's filter to sidebar tree
  selection.** Unlike the already-shipped Available-view Sources-selection
  filter (initiative 22's `available-source-filter`), jumping into the
  Dashboard from a Source is an **explicit action** (§4.6), not a passive
  side effect of clicking a tree row — the Dashboard is a separate, heavier
  webview panel/tab; auto-revealing or re-focusing it on every sidebar click
  would be surprising.
- **No pinning/version selection in `Move`/`Copy`.** Both operate on the
  currently-installed local content (see the corrected §3 decision below,
  which fixes the original draft's wrong claim that these re-resolve from
  the source) — no new revision-pinning UI.
- **`Move` is scoped to `skill`/`agent`/`command`/`mcp-server` only —
  `hook` and `rule` are explicitly out of scope.** **(Revised after Codex
  review)**: `planSync` (`src/engine/sync.ts`), which both `Copy` and the
  new `Move` build on, already refuses `hook`/`rule` with "Unsupported kind
  for sync" (`src/engine/sync.ts:370`, `:457`). Extending sync to those two
  kinds is real, separate work (their apply-time semantics are a demarcated
  merge / an entry in a shared file, not a standalone copyable unit) and is
  not bundled into this pass.
- **No fix for the pre-existing `sourceId`-collision-across-scope
  ambiguity.** **(New, after Codex review)**: a global-scope source and a
  project-scope source can legally share the same string `id` (dedup only
  happens within one scope's manifest, see `src/ui/sourcesView.ts`'s
  `addSource`), and `ManagedInstallation` records the installation's own
  scope but not the scope of the *source* it came from
  (`src/domain/types.ts:86-99`). `checkDrift()`
  (`src/ui/installedView.ts:264-315`) already has this same ambiguity today
  — `allSources.find((s) => s.id === inst.sourceId)` matches by id alone
  across a combined global+project array. The new cross-framework lookup
  (§4.1) inherits this pre-existing imprecision rather than fixing it — a
  proper fix needs a schema change (tracking source scope on
  `ManagedInstallation`) that is out of scope here.
- **No matching against `git-single-item`/`remote-url` sources, and no
  matching against more than one artifact-per-source, in the `Promote`
  candidate list.** **(New, after Codex review)**: `discovery.ts`'s matching
  loop currently only attempts `local-folder`/`git-custom`/
  `git-marketplace` resolution (`src/engine/discovery.ts:224-240`) — the
  other two source types are silently skipped. Initiative 25 (§4.4) extends
  this to attempt all five source types and to keep scanning a source's
  remaining packages after finding one candidate (both are small, additive
  changes to the existing loop) — but if a source type's resolver itself
  cannot run (e.g. transient network failure), that source simply
  contributes no candidate, same as today.
- **No unmanaged discovery scanning for `hook`/`rule`.** **(New, after
  Codex review)**: `scanInstalledInventory`'s raw-observation pass
  (`src/engine/discovery.ts`) stops after `mcp-server` and never looks for
  unmanaged `hook`/`rule` files at all — this is a gap in the scanning step
  itself, not just the matching loop, and is not fixed by this spec.
  `Promote`, the cross-framework lookup, and diff-for-unmanaged-items are
  therefore only available for `skill`/`agent`/`command`/`mcp-server` until
  a separate initiative extends discovery's scan.
- **`Promote` has no "no known source" fallback path.** **(Revised after
  explicit user decision, following the Codex-flagged regression risk)**:
  today, `promoteObservedArtifact` falls back to the literal string
  `'local-promotion'` as `sourceId` when nothing matched
  (`src/engine/discovery.ts:354-357`), letting a user promote a genuinely
  local, unmatched artifact to managed status. This spec removes that path
  entirely — `Promote` becomes unavailable (see §4.4) when zero source
  candidates exist, full stop. This is an intentional capability removal,
  not an oversight; there is no replacement action for "promote something
  the tool cannot attribute to any source."
- **No new concurrency control** for `state.json`/`manifest.json`
  read-modify-write beyond what already exists.
- **No multi-root workspace support beyond what already exists.**
  **(Revised after Codex review)**: the original draft claimed a "single
  workspace folder" assumption everywhere — false. `getWorkspaceRoot()`
  (`src/ui/workspacePicker.ts`) already prompts across multiple roots when
  more than one is open, but several call sites (e.g. the Dashboard's
  `update()`, `src/ui/dashboard.ts:122-124`) hardcode
  `workspaceFolders[0]`. This spec inherits that existing inconsistency —
  it neither fixes nor worsens it.
- **No fix for the Dashboard's existing unescaped-HTML-interpolation
  pattern beyond what §4.5 explicitly requires for the rebuilt table.**
  Anything not touched by the rebuild keeps its current (pre-existing, not
  newly introduced) risk profile.

## 3. Locked-in decisions

- **Sidebar = primary action surface; Dashboard = state, detail, and
  cross-reference — the two are complementary, not mutually exclusive.**
  **(Revised after Codex review)**: the original wording implied `Promote`/
  `Copy`/`Move`/`Edit` "stay in the sidebar" while simultaneously listing
  them as available from the Dashboard's detail view — a direct
  contradiction Codex caught. The actual split: bulk/primary actions (add a
  source, install, batch-install) stay sidebar-only; per-item actions that
  make more sense once you're looking at full context (`Promote`, `Copy`,
  `Move`, `Edit`) remain reachable from the sidebar **and** are also offered
  from the Dashboard detail view (§4.5) — convenience in context, not
  exclusivity. *Why:* browsing, adding sources, installing, and promoting
  are still fine as quick sidebar actions; only rich detail, diff, and
  cross-assistant lookup are Dashboard-only, since `TreeItem`
  tooltips/descriptions are already stretched thin
  (`src/ui/installedView.ts:169-171`, three newline-joined fields; three
  fields also in `src/ui/availableView.ts:381`).
- **Cross-framework "installed also in" lookup matches by
  `sourceId+artifactId` when both are present on the `ManagedInstallation`;
  falls back to exact `name+kind` match when either is missing**, flagged
  visually as **probable, not certain** for the fallback case. **(Revised
  after Codex review)**: this now explicitly inherits the pre-existing
  cross-scope `sourceId` collision risk documented in §2's new non-goal —
  it is a known imprecision shared with today's `checkDrift()`, not
  something this feature makes worse. *Why:* explicit user choice, accepting
  the false-positive risk of name+kind matching in exchange for coverage on
  items with no tracked provenance.
- **`Move` is `Copy`'s existing local-content semantics plus a
  soft-delete of the origin — not a fresh install from the source.**
  **(Revised after Codex review — the original draft was factually wrong
  here)**: `Copy` (`syncItem`, `src/ui/installedView.ts:406-478`, via
  `planSync`) reads and translates the **currently-installed on-disk
  content**, not a re-resolution of the registered source — for a locally
  modified item, source-refetching would silently install something
  different from what's actually on disk today. `Move` must use the same
  `planSync`-based path, then remove the origin. Scoped to
  `skill`/`agent`/`command`/`mcp-server` (see §2's new non-goal on `hook`/
  `rule`).
  - **Uninstall design, per the user's own simplification**: no generic
    "reverse the resolve→plan→preview→apply pipeline" engine — `skill`
    (a directory) and `agent`/`command` (a single file) are removed by
    **moving** `inst.path` into a sibling soft-delete location (e.g.
    `.ai-swissknife/_deleted/<kind>/<name>-<timestamp>/`) instead of
    `fs.rm`, so an accidental `Move` is recoverable by hand. `mcp-server`
    has no standalone file to move — it is one entry in a shared config
    written via the adapter's `writeMcpServer` (`src/adapters/types.ts:91`)
    — so this needs a new adapter method (`removeMcpServer(id, loc)`,
    confirmed absent from the `Adapter` interface today,
    `src/adapters/types.ts:71-101`) that rewrites the shared config with
    that entry stripped out; no soft-delete for this case, the removed
    entry is small and low-risk to lose compared to a full skill folder.
  - **Ordering and failure handling**: install into the target first; only
    if that succeeds, remove the origin. If the origin removal fails after
    a successful install, report `manual-recovery-required` with the
    affected path(s) — the existing `ApplyOutcome` variant used e.g. at
    `src/ui/availableView.ts:579-584` — never a silently-successful `Move`
    that left the origin behind unexpectedly, and never touch the origin if
    the install itself was refused or failed.
- **`Promote` reflects real source candidates, collected (not
  overwritten), and disappears entirely with zero candidates.**
  **(Revised after Codex review + explicit user decision)**: today,
  `discovery.ts`'s matching loop (`src/engine/discovery.ts:216-306`)
  evaluates every registered source but keeps only one `match`: an
  `identical` hit `break`s immediately (first found wins), a `different`
  hit does **not** break, so a *later* source with the same `kind+name`
  silently overwrites an earlier one — Codex confirmed the current code
  keeps the **last** `different` candidate, not the first. The fix:
  discovery collects **all** candidate sources per observed artifact
  (extended per §2's new non-goal to attempt all five source types and to
  keep scanning a source's remaining packages, not stop at the first hit),
  exposed as a new `candidates` list on `ObservedArtifact`. The existing
  single `match` field is re-derived from that list as "first identical,
  else first candidate" for badge rendering — **this is a small,
  intentional behavior change from today's "last different wins" for the
  badge**, not the "no behavior change" the original draft incorrectly
  claimed. `Promote` becomes: **hidden** at 0 candidates (per §2, no
  fallback path — the `'local-promotion'` placeholder is removed entirely),
  **direct** (today's happy path) at 1, and a `QuickPick` disambiguation at
  >1, passing the chosen `{sourceId, packageId, artifactId, sourceRevision}`
  explicitly into `promoteObservedArtifact`. Visibility is driven by a new
  `contextValue` bucket on `ObservedArtifactItem` (e.g.
  `observedArtifactItem:none` / `:one` / `:many`), since `package.json`
  `when` clauses can only match a `contextValue` string, not inspect
  `candidates.length` directly — mirrors the existing
  `installedInstallation:recommended` pattern
  (`src/ui/installedView.ts:173`). *Why:* explicit user requirement,
  verified against the real (buggy) current behavior before committing to
  the fix shape; the zero-candidate removal is an explicit, accepted
  capability change (§2), not an oversight.
- **Diff-vs-original and preview-before-install consolidate around
  `plan.ts`'s already-most-complete resolve/translate implementation,
  fixing `drift.ts`'s narrower coverage as a side effect — not a
  "reuse content already in memory" shortcut.** **(Revised after Codex
  review — two factual corrections)**: (1) the original draft claimed diff
  could reuse content "already produced in memory" by `drift.ts`/
  `discovery.ts` — false, both discard the translated content immediately
  after hashing (`src/engine/drift.ts:181-233` inside
  `checkForUpstreamUpdate` specifically, not `analyzeLocalDrift`, which
  does no source resolution at all; `src/engine/discovery.ts:255-288`), so
  the Dashboard has nothing to reuse by the time a user clicks "diff" — it
  triggers a fresh on-demand call to the resolve/translate step, same cost
  class as any other resolution, not a free lookup. (2) `plan.ts`'s
  `resolveContentFromSource` (`src/engine/plan.ts:52-71`) only resolves
  content — translation happens separately, per-kind, later in `plan.ts` —
  and critically, `plan.ts` is the one implementation that already covers
  all 5 source types and 6 kinds, while `drift.ts`/`discovery.ts` only
  cover 3 source types and 4 kinds (no `hook`/`rule`). The fix: extract the
  shared resolve+translate step from `plan.ts` (the fullest implementation)
  into a reusable function, and have `drift.ts`/`discovery.ts` call it too
  — this closes their existing `hook`/`rule` gap as a side effect instead
  of leaving three divergent partial implementations.
  - **Diff scope for `rule`/`mcp-server`**: these are not diffed as whole
    files — `rule` is one demarcated block inside a shared instruction file
    (`apply.ts`'s existing demarcated-merge markers), `mcp-server` is one
    entry inside a shared JSON config — diffing the whole shared file
    against a single artifact's canonical content would be misleading. Diff
    operates on the extracted logical unit (the block / the entry) on both
    sides.
  - **"Original" means current upstream, not the exact revision installed
    at install-time.** `ManagedInstallation` records a commit hash
    (`sourceRevision.commit`, `src/domain/types.ts:47-50`) but not the
    original content — re-resolving at that exact pinned commit isn't
    guaranteed across every resolver. For an item that is both locally
    modified **and** has an upstream update
    (`modified-and-update-available`), the diff therefore shows the
    combined delta (your edits + upstream's changes together), not your
    edits cleanly separated from upstream's — a proper three-way diff
    against the exact installed revision is future work, not this pass.
  - **Preview-before-install** does not depend on this consolidation —
    `planInstall` already produces `prepared.content`/
    `prepared.plan.proposedFiles` before any disk write, independent of
    `drift.ts`/`discovery.ts`'s narrower coverage.
- **Dashboard becomes one unified table with a filter bar, not two
  structural sections.** The current `getHtml` renders two separately-shaped
  tables — "Managed Artifacts" (`src/ui/dashboard.ts:189-221`) and
  "Unmanaged Discovered Items" (`src/ui/dashboard.ts:223-245`) — with only a
  free-text search and kind tabs as filters
  (`src/ui/dashboard.ts:477-488`); no assistant or scope filter exists at
  all. This is replaced by one row model (managed + unmanaged merged) with
  a single status badge encoding both membership and drift/match state,
  plus an always-visible filter bar (Environment / Scope / Membership /
  Kind / free text) and a breadcrumb line stating the active filters, each
  removable individually. *Why:* explicit user requirement — "riepilogo
  globale" and "vista per framework" are the same filtered state, not two
  views to build and keep in sync; managed/unmanaged becomes "a filter and
  a row indicator," not a structural split.
- **A persistent status bar item is a new, additional Dashboard entry
  point**, backed by a new small shared "pending count" function rather
  than reusing existing local variables. **(Revised after Codex review)**:
  the original draft assumed the recommendation-notification's
  `unsatisfiedCount` and the Dashboard's drift counts were already
  reusable — they are not: the former is a local variable inside a
  once-per-activation closure (`src/extension.ts`'s
  `checkRecommendations`), the latter only exist inside
  `DashboardPanel.update()` while the panel is open. §4.6 introduces one
  small exported function computing both counts on demand, called by the
  status bar item (and reusable by the existing notification path without
  changing its behavior).
- **"Open in Dashboard" from a Source row is an explicit per-item action**,
  applying a `{ id, scope }` composite filter (matching the precedent
  already set by the Available-view source filter,
  `src/ui/availableView.ts:414-417` — a bare `id` string is not enough
  since global and project sources can share one, per §2's new non-goal),
  never an automatic filter sync on tree selection. *Why:* see Non-goals —
  avoids surprising webview focus-stealing on ordinary sidebar browsing.

## 4. Feature description

### 4.1 Cross-framework identity lookup (engine)

- New pure function in `src/engine/` (no VS Code API, same layering as
  `drift.ts`/`discovery.ts`) taking one `ManagedInstallation` and the full
  set of `ManagedInstallation`s across all assistants/scopes, returning
  every other installation that represents "the same logical artifact":
  exact match on `sourceId+artifactId` when both are present on the input,
  otherwise exact match on `name+kind`, tagged with which matching strategy
  produced each result (`'provenance' | 'name-fallback'`) so the UI (§4.5)
  can render the "probable match" treatment for the fallback case. Inherits
  the pre-existing cross-scope `sourceId` collision imprecision (§2) rather
  than fixing it.
- Scoped in practice to `skill`/`agent`/`command`/`mcp-server` — the kinds
  discovery/drift actually cover end-to-end (§2's `hook`/`rule` non-goal).
- Consumed by the Dashboard's per-item detail view (§4.5); not exposed
  anywhere in the sidebar per the sidebar=action / Dashboard=state split.

### 4.2 Diff-vs-original and preview-before-install

- Extract `plan.ts`'s `resolveContentFromSource` + per-kind translation
  steps (`src/engine/plan.ts:52-71` and the translate calls following it)
  into a shared, reusable resolve+translate function; migrate `drift.ts`'s
  `checkForUpstreamUpdate` and `discovery.ts`'s matching loop onto it,
  closing their existing `hook`/`rule` gap in the same change (see the §3
  locked-in decision for why this is the fix, not a shortcut).
- **Diff-vs-original**: a new command available on a managed item whose
  drift status is `modified-locally`/`modified-and-update-available`, or on
  an unmanaged item whose discovery match status is `different` — triggers
  a fresh call to the shared function above (not a reuse of any cached
  content — none exists) and opens `vscode.diff` between the on-disk
  content and the resolved/translated original. For `skill` (a multi-file
  folder), diff the primary `SKILL.md` and note separately that resource
  files differ, rather than a folder-level diff. For `rule`/`mcp-server`,
  diff the extracted logical unit (demarcated block / JSON entry), not the
  whole shared file, per §3.
- **Preview-before-install**: in the existing install confirmation flow
  (`AvailableTreeDataProvider.installArtifact`/`installBatch`,
  `src/ui/availableView.ts:476-729`), after `planInstall` produces
  `prepared.content`/`prepared.plan.proposedFiles` and before the existing
  `showInformationMessage` confirm dialog, offer a "Preview" action that
  opens the resolved/translated content read-only — genuinely free here,
  since `planInstall` already computed it regardless of this feature.

### 4.3 `Move to...` action

- New command alongside the existing `syncItem` ("Copy to Another
  Assistant/Scope..."), same target-picking UX, reusing `planSync`'s
  existing local-content-based resolution (not re-resolving from the
  source — see §3). Scoped to `skill`/`agent`/`command`/`mcp-server`;
  `hook`/`rule` are out of scope (§2).
- **Scoped to `ManagedInstallation` only — not offered for
  `ObservedArtifact` (unmanaged items).** **(New, after Kilo review)**:
  `syncItem` today accepts both `InstalledInstallationItem` and
  `ObservedArtifactItem` for `Copy`, but an `ObservedArtifact` has no
  top-level `sourceId` (`planSync` falls back to the literal
  `'cross-assistant-sync'` when the source is an observed item,
  `src/engine/sync.ts:74-78`) and no `state.json` record to remove — "move
  the origin" doesn't have a coherent meaning for something the tool
  doesn't manage yet. `Copy` keeps supporting both item types unchanged;
  `Move` is only ever offered from a `ManagedInstallation` (an unmanaged
  item's path to another scope/assistant is `Promote` first, then `Move`
  if still wanted).
- After a successful install into the target, removes the origin via the
  soft-delete design locked in §3: move `inst.path` to
  `.ai-swissknife/_deleted/<kind>/<name>-<timestamp>/` for
  `skill`/`agent`/`command`; call the new `removeMcpServer(id, loc)`
  adapter method for `mcp-server` (added to the `Adapter` interface,
  `src/adapters/types.ts`, implemented per-assistant alongside the existing
  `writeMcpServer`).
- Failure handling per §3: install failure/refusal leaves the origin
  untouched; a post-install origin-removal failure reports
  `manual-recovery-required` with the affected path.

### 4.4 `Promote` disambiguation fix

- `src/engine/discovery.ts`'s matching loop changes from tracking one
  overwritten `match` to collecting all candidate sources per observed
  artifact, extended to attempt all five source types (not just
  `local-folder`/`git-custom`/`git-marketplace`) and to keep scanning a
  source's remaining packages after one hit, not stop at the first
  (§2). Exposed as a new `candidates` list on `ObservedArtifact`; the
  existing `match` field is re-derived from it ("first identical, else
  first candidate") for the existing badge rendering.
- `ObservedArtifactItem` gains a `contextValue` reflecting the candidate
  count bucket (`observedArtifactItem:none`/`:one`/`:many`), and
  `package.json`'s `view/item/context` entry for `aiSwissknife.promoteItem`
  is split into three `when` conditions matching those buckets — `:none`
  gets no `Promote` entry at all, `:one` promotes directly (today's path,
  now with real single-candidate provenance instead of an ambiguous
  `match`), `:many` opens a `QuickPick` listing each candidate (with its
  identical/different status) and passes the chosen
  `{sourceId, packageId, artifactId, sourceRevision}` explicitly into
  `promoteObservedArtifact`.
- The `'local-promotion'` placeholder sourceId is removed entirely — an
  artifact with zero candidates cannot be promoted through this command,
  full stop (§2).
- **`promoteAllIdentical`'s bulk path handles only single-identical-candidate
  items — anything with more than one candidate is skipped and left for
  the individual disambiguation flow.** **(New, after Kilo review)**: the
  Dashboard's bulk action (`src/ui/dashboard.ts:33-45`) currently promotes
  every observed item whose `match.status === 'identical'`. With
  `candidates` replacing the single `match`, an item can have more than one
  `identical` candidate (e.g. two mirrored sources with byte-identical
  content) — bulk-promoting it would still need to pick one source to
  attribute, which is exactly the ambiguity the disambiguation flow exists
  to resolve. Rather than silently picking one during a bulk operation,
  `promoteAllIdentical` only acts on items with exactly one candidate
  (identical or not — see §4.4 above, single-candidate items already
  promote directly); items with multiple candidates are left unpromoted by
  the bulk action and reported as skipped, requiring the individual
  `QuickPick` flow.

### 4.5 Dashboard: unified table, filters, and per-item detail

- Merge the two structural tables in `getHtml`
  (`src/ui/dashboard.ts:189-245`) into one row-per-item table (managed and
  unmanaged combined), each row carrying a single status badge encoding
  membership and drift/match state together (e.g. "● Managed · up to
  date", "◌ Unmanaged · identical to X").
- Add a filter bar above the table: **Environment** (All / one pill per
  assistant present in the data, using `getAssistantIconPath`
  (`src/ui/assistantIcons.ts`) — note this returns filesystem `Uri`s meant
  for `TreeItem.iconPath`; the webview needs
  `webview.asWebviewUri(...)` instead, which requires `DashboardPanel` to
  gain access to `extensionUri` and a configured local-resource root, which
  it does not have today), **Scope** (All/Global/Project), **Membership**
  (All/Managed/Unmanaged — replaces the structural split), **Kind** (already
  exists as tabs), plus the existing free-text search. A breadcrumb line
  states the active filters as removable chips; the default (no filters
  set) is the "global summary" state, and setting Environment to one
  assistant is the "per-framework" state — same screen, same renderer.
- Stats ribbon recomputes from the currently filtered subset, not the full
  dataset.
- Selecting a row requests detail from the extension host via a new
  message (`{command: 'requestDetail', key}` → `{command: 'itemDetail', key,
  origin, diffAvailable, crossFramework, candidates}`), computed on demand
  — **(Revised after Codex review)**: the existing `driftResult`/
  `scanComplete` messages only carry a key and a status string, not enough
  data for a detail panel; this is a new, explicit protocol addition, not
  something the existing messages already support. The detail panel shows:
  origin (source + commit, when tracked) or "local, no known origin" (when
  candidates/provenance are absent), a "Diff vs. original" action when
  applicable (§4.2), the cross-framework "installed also in" list (§4.1,
  with the probable-match treatment for name-fallback results), and the
  relevant actions (`Promote` per §4.4's rules, `Copy to...`, `Move to...`
  per §4.3, `Edit` — already exists).
- **(New, after Codex review)** `syncItem`/`promoteItem`/`editItem`
  currently take real class instances (`InstalledInstallationItem` /
  `ObservedArtifactItem`) and branch on `instanceof`
  (`src/ui/installedView.ts:406-478`) — a webview message only ever carries
  a plain serialized object, never a class instance. The Dashboard's
  `Copy`/`Move`/`Promote`/`Edit` handlers need a value-based variant of
  each (accepting a plain `ManagedInstallation`/`ObservedArtifact` object
  directly) shared with the sidebar's class-based commands, not a direct
  reuse of the existing methods as written.
- **(New, after Codex review)** the rebuilt table must escape all
  interpolated dynamic strings (names, paths, match details) before
  inserting them into HTML, and must not embed raw `JSON.stringify` output
  inside a `<script>` tag unescaped (`src/ui/dashboard.ts:541` today) — a
  name or path containing `</script>` breaks out of the script context.
  This was already a latent risk in the current code; the rebuild is the
  natural point to fix it rather than carry it forward into a larger
  table.
- **(New, after Kilo review)** `src/ui/ui.test.ts:462-531` asserts specific
  strings/attributes tied to today's two-table structure (e.g.
  `data-drift-key="claude-code:project:demo-skill"`, `#scan-indicator`) —
  this initiative must update that test suite to match the unified table,
  not leave it asserting a structure the rebuild removes.

### 4.6 New Dashboard entry points

- **Status bar item**: created during `activate()`, always visible,
  command = `aiSwissknife.openDashboard` (already exists). Label reflects a
  pending count computed by the new shared function from §3 (unsatisfied
  recommendations + updates available) — falls back to a plain icon+label
  when there is nothing to flag. Does not replace the existing
  `$(dashboard)` view-title icon (`src/extension.ts:373`).
- **"Open in Dashboard" per source**: new inline/context action on
  `SourceItem` (`src/ui/sourcesView.ts`) that reveals the Dashboard
  (opening it if not already open) with a `{ sourceId, sourceScope }`
  filter pre-applied (§4.5's filter bar gains a `Source` dimension carrying
  both fields, per §3), shown as a removable chip in the breadcrumb — an
  explicit action, never triggered by mere tree selection.

## 5. Grounding references

- Sidebar tooltip/description as a stretched detail surface (three
  newline-joined fields each, not literally the *only* surface — the
  Dashboard already existed as a shallower one):
  `src/ui/installedView.ts:169-171`, `src/ui/availableView.ts:381`.
- Installed view's flat assistant+scope grouping (not nested):
  `src/ui/installedView.ts:202-214` (grouping key built at line 206).
- `ManagedInstallation.sourceId`/`artifactId`/`sourceRevision` are optional,
  and the type has no field for the *source's* scope:
  `src/domain/types.ts:86-99`; `ResolvedRevision`: `src/domain/types.ts:47-50`.
- `promoteObservedArtifact`'s `'local-promotion'` fallback sourceId when no
  match exists: `src/engine/discovery.ts:354-357`.
- Discovery's overwrite-not-collect matching loop (identical `break`s,
  different does not — confirmed: keeps the **last** different candidate,
  not first): `src/engine/discovery.ts:216-306`; source types actually
  attempted (missing `git-single-item`/`remote-url`):
  `src/engine/discovery.ts:224-240`.
- `promoteItem`'s `view/item/context` menu entry has no condition on match
  status today (`package.json`, `when: view == aiSwissknife.installed &&
  viewItem == observedArtifactItem`).
- Existing `Copy to...` action (`syncItem`), confirmed to use local
  on-disk content via `planSync`, not source re-resolution:
  `src/ui/installedView.ts:406-478`, `src/engine/sync.ts:64-94`.
- `planSync`'s kind coverage stops at `skill`/`agent`/`command`/
  `mcp-server` — `hook`/`rule` hit "Unsupported kind for sync":
  `src/engine/sync.ts:370`, `:457`.
- No `delete`/`remove` method exists on the `Adapter` interface for any
  kind today (confirmed by reading the full interface): `src/adapters/types.ts:71-101`.
  `writeMcpServer` as the existing precedent for rewriting the shared MCP
  config: `src/adapters/types.ts:91`, e.g. implemented at
  `src/adapters/claude.ts:599`.
- `manual-recovery-required` as the existing pattern for "succeeded partway,
  needs manual attention" outcomes: `src/ui/availableView.ts:579-584`
  (`ApplyOutcome` case).
- Resolve+translate implementations and their actual coverage: `plan.ts`
  resolves content (translation is separate, per-kind, later in the same
  file) and covers all 5 source types/6 kinds:
  `src/engine/plan.ts:52-71` (`resolveContentFromSource`); `drift.ts`'s
  `checkForUpstreamUpdate` (not `analyzeLocalDrift`, which does no source
  resolution) covers only 3 source types: `src/engine/drift.ts:130-234`;
  discovery's match loop, same 3-source-type limit:
  `src/engine/discovery.ts:255-288`. `analyzeLocalDrift` has no branch for
  `hook`/`rule` at all, meaning any managed `hook`/`rule` installation is
  always reported as drifted regardless of actual state — a pre-existing
  bug this spec's consolidation (§3/§4.2) incidentally fixes:
  `src/engine/drift.ts:61-109`.
- `planInstall` already resolves+translates content before any disk write;
  `applyInstall` is the separate write step: `src/engine/plan.ts`,
  `src/engine/apply.ts` (`ManagedInstallation` construction only after
  translation, e.g. `src/engine/apply.ts:145-157` and similar per-kind
  blocks).
- Existing install confirm flow that would host the new preview action:
  `AvailableTreeDataProvider.installArtifact`/`installBatch`,
  `src/ui/availableView.ts:476-729`.
- Dashboard's two structurally different tables (managed vs. unmanaged,
  different columns): `src/ui/dashboard.ts:189-245`.
- Dashboard's only existing filters (search + kind tabs, no
  assistant/scope filter): `src/ui/dashboard.ts:477-488`.
- Dashboard's message protocol today only carries key+status, no full
  report/content: `src/ui/dashboard.ts:136-167` (`update()`'s
  `postMessage` calls).
- Dashboard's unescaped string/JSON interpolation into HTML (latent
  pre-existing risk, addressed by §4.5 for the rebuilt table):
  `src/ui/dashboard.ts:208-245` (row templates), `:541` (`JSON.stringify`
  embedded directly in a `<script>` block).
- `syncItem`/`promoteItem` branch on real class instances via `instanceof`,
  incompatible with plain webview-message payloads:
  `src/ui/installedView.ts:406-478`.
- Assistant brand icon helper returns filesystem `Uri`s for `TreeItem`s,
  not webview-safe URIs: `src/ui/assistantIcons.ts`
  (`getAssistantIconPath`); `DashboardPanel` has no `extensionUri`/resource
  root plumbing today: `src/ui/dashboard.ts`.
- Existing Dashboard entry point (view-title icon, all three views):
  `src/extension.ts:373`, `package.json` (`aiSwissknife.openDashboard`,
  `view/title` entries).
- Recommendation-count data is a local variable in a once-per-activation
  closure, not a reusable service: `src/extension.ts`
  (`checkRecommendations`). Dashboard drift counts are local to
  `DashboardPanel.update()`: `src/ui/dashboard.ts:104-168`.
- `getWorkspaceRoot()` already supports multi-root via a picker; some call
  sites (e.g. Dashboard's `update()`) hardcode `workspaceFolders[0]`
  instead — an existing inconsistency, not a universal single-folder
  assumption: `src/ui/workspacePicker.ts`, `src/ui/dashboard.ts:122-124`.
- Precedent for `{id, scope}` composite source identity (not bare `id`,
  since global/project sources can share one): `src/ui/availableView.ts:414-417`.
- Precedent for a `contextValue` bucket driving conditional menu visibility:
  `installedInstallation:recommended`, `src/ui/installedView.ts:173`.
- Precedent for Sources→Available auto-sync-on-selection (contrasted with
  the new explicit-action choice for Dashboard): initiative 22's
  `available-source-filter` work, `src/extension.ts`
  (`sourcesTreeView.onDidChangeSelection`), `src/ui/availableView.ts`
  (`setFilterSource`).

## 6. Drives

- Initiative 23 — Cross-framework identity lookup + shared resolve/translate
  content accessor, extracted from `plan.ts` (engine foundation for
  4.1/4.2, also closes `drift.ts`/`discovery.ts`'s `hook`/`rule` gap).
- Initiative 24 — Diff-vs-original + preview-before-install (UI, built on
  23 for diff; preview does not depend on 23).
- Initiative 25 — `Move to...` action (soft-delete based, scoped to
  `skill`/`agent`/`command`/`mcp-server`) + `Promote` disambiguation fix
  (candidate collection extended to all 5 source types).
- Initiative 26 — Dashboard rebuild: unified table, filter bar, per-item
  detail section, value-based action handlers, HTML-escaping hardening
  (built on 23-25 for the detail section's data).
- Initiative 27 — New Dashboard entry points: status bar item (backed by
  the new shared pending-count function), per-source filtered jump (built
  on 26's filter bar).
