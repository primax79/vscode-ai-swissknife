# Spec — Project-Scoped Recommended Installations

> **Status:** Draft / Accepted for implementation
> **Parent Spec:** [`SPEC.md`](../../SPEC.md) §3 (Feature Area B — Management)
> **Pre-requisite:** Phases 1-4 (Initiatives 01-21) completed and verified.
> **Reviewed by:** Codex (2026-09-07, independent read-only review against
> the real source) — findings incorporated below; see the "Revised after
> review" callouts.

---

## 1. Goals & scope

Today, opening a project that already has AI Swissknife sources registered
gives a teammate the same **Available** browsing surface the original author
had (project-scope `Source[]` live in the shared, git-tracked
`manifest.json` — see `tasks/CONTEXT.md`'s Persistence Layout note), but
nothing tells them **which** of those available items the project actually
wants installed, and nothing prompts them to install anything. They have to
already know to open the Available view and reconstruct the same set by
hand.

This spec adds a **project-scoped recommendation mechanism modeled directly
on VS Code's own workspace extension recommendations**
(`.vscode/extensions.json` → `recommendations`, confirmed behavior in
`references/vscode_doc/configure/extensions/extension-marketplace.md`
lines 175-186, 295-359): a project curator marks specific artifacts as
recommended, the recommendation travels with `git clone` inside the
already-shared manifest, and opening the workspace surfaces a notification
offering to install them — with the same "always available on demand,
dismissable per workspace" shape VS Code itself uses for extensions.

Concretely, this closes a real gap already present in the schema:
`DesiredInstallation` / `ManifestFile.desiredInstallations`
(`src/domain/registry.ts:20-32`) has existed since initiative 02 but is
**dead in production** — confirmed via `grep -rn "desiredInstallations" src`:
outside its own declaration/serialization in `registry.ts`, the only
non-test reference is `src/ui/sourcesView.ts` pruning entries when their
source is removed. No command ever writes a `DesiredInstallation` from user
action, and nothing ever reads the list to resolve or offer installation.
(`registry.test.ts` does round-trip a populated list as a serialization
fixture — that's schema testing, not a production writer/reader; it doesn't
change the conclusion.) This initiative gives the field its intended purpose
instead of introducing a new schema.

## 2. Non-goals (explicit, to prevent scope creep)

- **No global-scope recommendation/export/import.** Replicating one
  person's entire personal environment (`~/.ai-swissknife/`) across their
  own machines is a different problem: there is no natural "workspace open"
  event to hook, and no git repository is implied for `~/.ai-swissknife/`
  the way there already is for a project. The manifest format is
  scope-tagged and already round-trips, so nothing here blocks a future
  spec for that — it is simply out of scope now.
- **No new export file format or "export to a portable file" action.** The
  transport is exactly `git clone` of the existing, already-shareable
  project `manifest.json` (per `tasks/CONTEXT.md`'s locked-in Persistence
  Layout). Anyone who wants to hand a colleague their setup outside a
  shared git repo can already copy `manifest.json` by hand — it is plain
  JSON. Building dedicated import/export UI for that duplicates what git
  already does for free.
- **No auto-scaffolding of a `.gitignore` from scratch.** Only appends a
  missing entry to an *existing* `.gitignore` (non-destructive, same spirit
  as the rule-merge decision in initiative 19). A project with no VCS at all
  is out of scope, and the guarantee is best-effort: a broader pre-existing
  ignore rule, or a user force-adding the file, can still defeat it — this
  feature does not audit for that.
- **No credential/auth handling.** `Source` never carried auth fields
  (`src/domain/types.ts:25-36`) and still won't. A recommended `git-custom`
  source with a private SSH URL still requires the colleague's own key —
  same as adding that source manually today. Not silently worked around,
  and not a regression from today's behavior.
- **No dedicated "manage ignored recommendations" panel**, and **no UI to
  un-suppress a dismissed workspace notification.** The always-available
  `Install Recommended` command (4.4) is the one escape hatch — mirrors how
  VS Code itself buries per-item un-ignore inside the Extensions view
  details page rather than a dedicated list (confirmed in the cited doc,
  §"Ignoring recommendations"). Clearing "Don't ask again for this
  workspace" has no dedicated UI in this pass; `Install Recommended` remains
  reachable regardless of that flag.
- **No automatic promotion of "what's installed" into "what's
  recommended."** Marking something recommended is always an explicit,
  per-item curator action (4.1), never inferred from the local `state.json`
  — this mirrors the already-locked `ObservedArtifact` ≠
  `ManagedInstallation` safety principle in `tasks/CONTEXT.md` ("promotion
  is explicit and per-item").
- **No pinning a recommendation to a specific revision.** `requestedRef` on
  `DesiredInstallation` (`src/domain/registry.ts:20-26`) is never written by
  this initiative's UI and is ignored by the resolution engine (4.2) —
  recording "recommended, at whatever ref the source currently resolves to"
  is enough for this pass. *(Revised after review: the original draft
  implied `requestedRef` was meaningfully reused without ever writing or
  comparing it — that was misleading dead data layered on top of dead data;
  making it an explicit non-goal is honest about current scope.)*
- **No multi-root workspace support.** The recommendation notification and
  commands operate on whatever `getWorkspaceRoot()` resolves
  (`src/ui/workspacePicker.ts`) — the same single-folder assumption every
  other project-scope action in this codebase already makes (e.g.
  `AvailableTreeDataProvider` already uses the first workspace folder
  silently, `src/ui/availableView.ts:189`). Not a regression introduced
  here; a dedicated per-folder recommendation model is future work.
- **No new concurrency control for `state.json`/`manifest.json`
  read-modify-write.** Two simultaneous installs (recommended or manual)
  can already race today's `readState → filter/push → writeState` sequence
  in `src/engine/apply.ts`; this initiative routes through the same
  pipeline and neither fixes nor worsens that pre-existing gap. A locking
  mechanism for concurrent writers is separate future work, not bundled
  here.
- **"Satisfied" means "recorded in `state.json`," not "verified present on
  disk."** Whether an installed file was later deleted or modified is
  `analyzeLocalDrift`'s job (initiative 13), not this feature's — a
  recommendation whose `ManagedInstallation` record still exists counts as
  satisfied even if the file on disk is stale or gone.

## 3. Locked-in decisions

- **Reuse `desiredInstallations`, no schema change.** `ManifestFile`
  (`src/domain/registry.ts:28-32`) already models exactly what's needed:
  `sourceId` + `artifactId` + `assistant` + `scope` (+ the now-ignored
  `requestedRef`, see Non-goals). *Why:* it already exists, is already
  read/written atomically, and is already part of the git-shareable project
  manifest — reusing it avoids a second, parallel "recommendations" file
  that could drift from the real intent list.
- **Recommendation scope is `project` only.** A `DesiredInstallation`
  written by this feature always has `scope: 'project'`; the UI actions in
  4.1 are only offered for project-scope artifacts. *Why:* see Non-goals —
  the trigger is "opening a project."
- **Dismissal state lives in `ExtensionContext.workspaceState`, not in any
  JSON file.** The "Don't ask again for this workspace" flag is per-machine,
  per-workspace VS Code state — never written to `manifest.json` (which must
  stay pure shared intent) and never added to `state.json` (which models
  `ManagedInstallation`, not dismissals — extending its shape for an
  unrelated concept would blur what `state.json` means). *Why:* mirrors VS
  Code's own split between `extensions.json` (shared intent) and the user's
  local ignore-list (personal, not shared) cited above; also keeps
  `StateFile` (`src/domain/registry.ts:34-37`) honest about what it models.
- **The workspace-open check is local-only — it must never trigger network
  resolution.** Deciding *whether to show* the notification uses only
  `manifest.json` (already on disk, already read for the Sources/Available
  views) and `state.json` (ditto) — comparing `desiredInstallations` against
  `ManagedInstallation` records by identity is enough to know "N recommended
  items aren't installed yet." It must **not** resolve/clone any `Source`
  (that means no git clone/fetch) as a side effect of the extension simply
  activating. *Why (revised after review):* this codebase has no Workspace
  Trust integration anywhere today (`grep -rn "isTrusted" src` — zero
  matches) and no timeout on `git-custom` resolution
  (`src/sources/gitCustom.ts`); every existing network-touching action
  (`refreshCatalog`, `installBatch`, etc.) is already user-initiated. Making
  workspace *open* itself silently clone repositories from manifest URLs
  would be a new, unreviewed network/trust surface — the fix is to keep the
  open-time check purely local (cheap and safe) and defer actual source
  resolution (where "broken" detection also happens, see 4.2) to the moment
  the user explicitly clicks `Install All`, `Review`, or runs
  `Install Recommended`. This is a stricter, simpler design than the
  original draft, not a smaller one.
- **The open-time check must never block activation, and must not silently
  swallow its own failures.** It runs as a fire-and-forget async call from
  `activate()` (`src/extension.ts`), scheduled after existing view/command
  registration, with an explicit `.catch()` that reports via the extension's
  normal error-reporting path (e.g. `console.error`/output channel — there
  is currently no comparable async startup call in `activate()` to mirror,
  so this task is establishing the pattern, not following one). *Why
  (revised after review):* an unhandled rejection during activation is a bad
  first impression for a marketplace extension, and the original draft's
  claim that this "follows an existing pattern" did not hold up against
  `src/extension.ts`.
- **Every unresolved recommendation carries an explicit diagnostic, never a
  silent drop — and "not registered," "failed to resolve," and "resolved but
  artifact missing" are three distinct reasons, not one.** A
  `DesiredInstallation` whose `sourceId` has no matching entry in
  `manifest.json.sources` is reported differently from one whose source
  exists but whose resolution attempt failed (e.g. clone/auth error), which
  is reported differently again from one whose source resolved fine but no
  longer contains that `artifactId`. *Why (revised after review):*
  collapsing "unregistered" and "resolution failed" into one `broken` bucket
  produces a false diagnostic (a perfectly valid source that's just
  offline/unauthenticated would incorrectly read as "not registered") —
  this extends the already-locked "every conversion carries an explicit
  diagnostic" principle (`tasks/CONTEXT.md`) with the precision that
  principle already implies elsewhere in the codebase (see
  `ConversionDiagnostic`, `src/domain/types.ts:101-105`).
- **Installing recommendations goes through the existing
  resolve→plan→preview→apply→verify pipeline via a small new shared
  install-runner, not by reusing `installBatch` as-is.** `installBatch`
  (`src/ui/availableView.ts:470-548`) is `private`, and prompts once for a
  single target assistant + scope for its entire batch
  (`showQuickPick` calls at lines 479 and 498) — recommendations already
  carry a specific `assistant` per entry and are always `scope: 'project'`,
  so feeding them through unchanged would silently ignore each entry's
  declared assistant or prompt the user in a way that doesn't match what
  was recommended. Task 22.3 (see plan) introduces a small shared function
  taking an explicit `{ item, targetAssistant, targetScope }[]` and reuses
  `planInstall`/`applyInstall` directly (`src/engine/index.ts`) — the same
  underlying pipeline, without going through `installBatch`'s
  batch-wide-assistant prompt. *Why (revised after review):* the original
  draft's "resolves into the shape `installBatch` expects" was checked
  against the real signature and doesn't hold; the fix keeps the actual
  invariant that matters (no bypass of resolve→plan→preview→apply) while
  fixing the false claim about the exact call site.

## 4. Feature description

### 4.1 Recommend / unrecommend an artifact (project scope only)

- New commands `aiSwissknife.recommendForWorkspace` /
  `aiSwissknife.unrecommendForWorkspace`.
- **From the Available view:** `AvailableArtifactItem`
  (`src/ui/availableView.ts:55-61`) carries `source`, `pkg`, `artifact` —
  **no `assistant`** (confirmed against the real class; the original draft
  wrongly assumed one was already available). The command must prompt for a
  target assistant (same `showQuickPick` list `installBatch` already uses)
  before writing the entry.
- **From the Installed view:** the installed item already carries a real
  `assistant`, but `ManagedInstallation.sourceId`/`artifactId` are optional
  (`src/domain/types.ts:86-99`) — a `promoteObservedArtifact` result or a
  Form-Editor-created item can legitimately have neither
  (`src/engine/discovery.ts`, `src/ui/formEditor.ts`). When either is
  missing, the command must show a clear message ("this item isn't tracked
  to a source and can't be recommended") instead of writing a malformed
  `DesiredInstallation`.
- Writes/removes one `DesiredInstallation { sourceId, artifactId, assistant,
  scope: 'project' }` in the project `manifest.json`, deduped on
  `sourceId + artifactId + assistant` (mirrors the existing dedup-by-id
  pattern in `sourcesView.ts`'s `addSource`).
- After writing, refresh **both** the Available and Installed tree
  providers (not just the one the action was invoked from) so the
  "Recommended" decoration below is consistent across views immediately —
  note that today's file watchers only refresh Sources/Installed, not
  Available (`src/extension.ts`'s `setupFileWatchers` call), so this
  explicit dual refresh is necessary, not redundant.
- Recommended items get a distinct tree decoration (e.g. a star
  `ThemeIcon`/description suffix) in Available and Installed views, so a
  curator can see at a glance what's already marked — mirrors VS Code's own
  "Recommended" badge in the Extensions view.

### 4.2 Recommendation resolution (shared engine logic)

- A new pure function (no VS Code API — same layering as the rest of
  `src/engine/`) that takes `desiredInstallations`, the project `state.json`
  installations, `manifest.json.sources` (to distinguish "not registered"
  from "registered"), and a map of per-source resolution *attempts*
  (`sourceId -> { status: 'resolved'; source: Source; packages: Package[] }
  | { status: 'failed'; source: Source; error: string }`) — the map only
  contains sources someone actually tried to resolve, which only happens
  when this function is called from an explicit user action (4.3/4.4), per
  the local-only-on-open locked-in decision above.
- Returns three buckets:
  - **satisfied** — present in `state.json` with a matching
    `sourceId + artifactId + assistant`.
  - **pending** — not satisfied, `sourceId` found in `manifest.json.sources`,
    resolution attempt (if present in the map) succeeded, and the
    `artifactId` is found among that source's resolved packages.
  - **broken** — not satisfied, with one of three distinct reasons:
    `source-not-registered` (no matching entry in `manifest.json.sources`
    at all), `source-resolution-failed` (registered, but the resolution
    attempt in the map has `status: 'failed'`, reason = its `error`), or
    `artifact-not-found` (resolved fine, but no package contains that
    `artifactId` — likely renamed/removed upstream).
- This is the one piece of logic both the open-time review path (4.3) and
  the on-demand command (4.4) call into once they've resolved sources —
  keeping "what's left to install" decided in one tested place instead of
  duplicated across two UI entry points.

### 4.3 Detection + prompt on workspace open

- Wired into `src/extension.ts`'s `activate()`, after existing view/command
  registration (activation event is already `onStartupFinished`, per
  `package.json`) — fire-and-forget with an explicit `.catch()`, per the
  locked-in non-blocking decision.
- **Local-only check** (no source resolution, no network — see locked-in
  decision): read the project manifest and state (if a project-scope
  workspace is open), count `desiredInstallations` entries with no matching
  `sourceId + artifactId + assistant` in `state.json`'s installations.
  Subtract nothing else at this stage — the source-registered/resolved/
  broken distinction from 4.2 only matters once the user asks to act.
- Skip entirely if `context.workspaceState.get('aiSwissknife.ignoreRecommendations')`
  is true.
- If the unsatisfied count is `> 0`: `vscode.window.showInformationMessage`
  naming the count, with actions `Install All`, `Review`,
  `Don't ask again for this workspace`.
  - `Install All` → *now* resolves the referenced sources, runs 4.2, and
    hands `pending` to the shared install-runner (4.4/locked-in decision) —
    this is the point where network access and the full three-way
    diagnostic first happen, with the plan/preview step still shown before
    anything is written.
  - `Review` → reveals the Available view's "Recommended" filter (4.4).
  - `Don't ask again for this workspace` → sets
    `context.workspaceState.update('aiSwissknife.ignoreRecommendations', true)`
    (see Non-goals: no dedicated UI to undo this; `Install Recommended`
    remains reachable regardless).

### 4.4 "Install Recommended" command + Available-view "Recommended" filter

- New command `aiSwissknife.installRecommended` (Sources view toolbar +
  command palette), invocable regardless of whether the open-time prompt
  fired or was dismissed — mirrors "Show Recommended Extensions" being
  always available per the cited doc.
- Handler: read manifest + state, resolve every distinct `sourceId`
  referenced in `desiredInstallations` (this is where network access
  happens, explicitly user-triggered), call 4.2, show a preview listing
  `pending` (installable) and `broken` (informational, with its specific
  reason from the three-way split) before handing `pending` to the shared
  install-runner introduced by the locked-in decision above (`planInstall`/
  `applyInstall` directly, per-entry `assistant`/`scope: 'project'`, not
  `installBatch`'s single-assistant batch prompt).
- Available view gains a "Recommended" top-level grouping/filter — a new
  root-level tree node alongside the existing per-source groups (not a
  modification to `buildHierarchy`'s per-source hierarchy, which stays
  as-is), populated from the same resolved `pending`/`broken` data so
  `Review` (4.3) and this command's preview render through the same node.

### 4.5 Git hygiene for the shared manifest

- Centralized in `writeManifest` itself (`src/domain/registry.ts`), not in
  any individual UI command: whenever `writeManifest('project', ...)` is
  called and the workspace has a `.gitignore` at its root, ensure it
  contains a line for the project's **state** path as resolved by
  `statePath('project', ...)` (`src/domain/registry.ts`) — resolving the
  real path matters because of that function's legacy-fallback logic (see
  22.5's corrected verification below). *Why centralized (revised after
  review):* putting the call inside `writeManifest` instead of at each call
  site (`addSource`, the new 4.1 handlers, any future project-scope writer)
  means this task has no dependency on 4.1 shipping first, and no future
  manifest writer can forget it.
- Append-only, never touching existing content — same non-destructive-merge
  spirit as the demarcated `rule` merge from initiative 19. Skip entirely if
  no `.gitignore` exists (see Non-goals) or if the line is already present.
- `manifest.json` itself must never be added to any ignore rule by this
  feature — it is the whole point of the shared/git-tracked design already
  locked in `tasks/CONTEXT.md`.

## 5. Grounding references

- `desiredInstallations` dead-in-production status confirmed via
  `grep -rn "desiredInstallations" src --include="*.ts"` (2026-09-07
  session): declared/serialized in `src/domain/registry.ts`, round-tripped
  in a `registry.test.ts` fixture, pruned in
  `src/ui/sourcesView.ts:232,248` — no production writer, no
  reader/applier anywhere.
- `AvailableArtifactItem` has no `assistant` field:
  `src/ui/availableView.ts:55-61`. `ManagedInstallation.sourceId`/
  `artifactId` are optional: `src/domain/types.ts:86-99`; can be absent from
  discovery promotion (`src/engine/discovery.ts`) or Form Editor creation
  (`src/ui/formEditor.ts`).
- `installBatch` is `private`, prompts once for one assistant (line 479) and
  one scope (line 498) for its whole item list: `src/ui/availableView.ts:470-548`.
- No Workspace Trust integration anywhere in the codebase:
  `grep -rn "isTrusted" src` → no matches. `git-custom` resolution has no
  timeout: `src/sources/gitCustom.ts`.
- `ConversionDiagnostic`'s four-value precision precedent:
  `src/domain/types.ts:101-105`.
- `setupFileWatchers` refreshes Sources + Installed, not Available:
  `src/extension.ts` (`activate()`).
- VS Code's own recommendation UX, cited verbatim from the local doc mirror:
  `references/vscode_doc/configure/extensions/extension-marketplace.md`
  lines 175-186 (workspace recommendations, per-item "Ignore
  Recommendation"), 295-318 (`.vscode/extensions.json` →
  `recommendations`), 352-359 (`extensions.showRecommendationsOnlyOnDemand`,
  `extensions.ignoreRecommendations`, always-available "Show Recommended
  Extensions" command).
- Existing install pipeline entry points: `src/engine/index.ts`
  (`planInstall`, `applyInstall`).
- Manifest/state schema: `src/domain/registry.ts:8-37`
  (`DesiredSource`, `DesiredInstallation`, `ManifestFile`, `StateFile`) — no
  changes needed to the schema itself, only new readers/writers.
- Activation event: `package.json` `activationEvents: ["onStartupFinished"]`.
- `statePath`'s legacy-fallback condition checks for an existing legacy
  **state** file, not a legacy manifest: `src/domain/registry.ts` (`statePath`).
- Test harness precedent for VS Code-API-touching code:
  `src/ui/ui.test.ts` (hand-rolled `vscode` module mock injected via
  `Module.prototype.require`, run with `node --test` per `package.json`'s
  `"test": "tsc && node --test out"`).

## 6. Drives

- Initiative [22 — Project-scoped recommended installations](../done/22-project-recommendations/plan.md).
