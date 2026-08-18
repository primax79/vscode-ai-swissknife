---
target: tasks/02-domain-and-registry/02.3-hardening.md, tasks/03-claude-kilo-adapters/03.4-hardening.md, tasks/04-source-resolver/04.3-hardening.md, tasks/05-translator-skill/05.2-hardening.md, tasks/06-install-engine/06.1-plan-and-preview.md, tasks/06-install-engine/06.2-apply-and-verify.md, tasks/07-minimal-ui/07.1-sources-view.md, tasks/07-minimal-ui/07.2-available-view.md, tasks/07-minimal-ui/07.3-installed-view.md
date: 2026-08-18
commit: b4e7f92aeca3c9b36a33f5bc53bcc6c12e7481f6
engine: codex
model: default (via mcp__codex__codex)
verdict: do not delegate 02.3 yet, further correction needed
---

# Review: hardening gate (pre-delegation) — codex

(Filed as this engine returned it — findings B1-B9/I1-I13 below use
independent numbering from the first Codex review's B1-B7/I1-I13; same
letters, different findings, distinguished by title/description, not by
number alone.)

## Executive assessment

The hardening gate is aimed at the right layer and preserves the product
direction, but is not yet safe to delegate as written. B1-B7 closure
assessment from the *first* review: B1 (content-resolution) partially
closed, B2 (skill directory payload) mostly addressed but not wired end
to end, B3 (registry split) partially closed, B4 (atomic apply) not
closed, B5 (path validation) substantially addressed but incomplete, B6
(YAML verbatim claim) closed in principle, B7 (portable fixtures) closed
in principle.

## What it gets right

Acts before initiative 06 freezes the wrong abstraction; the full
skill-directory model in 03.4 (Buffer content, executable modes,
symlink refusal) is appropriate; the YAML guarantee is now honestly
scoped to semantic preservation; immutable Git provenance
(`ResolvedRevision`) is a real improvement over `Package.version?:
string`; the 04.3 fixture corpus covers the right real-world shapes;
Phase 1 is now honestly skill-only; the UI rewrite fixes several real
UX failures (registry-reload vs catalog-refresh, explicit refresh vs
fetch-on-expand, multi-root folder choice, stale-view refresh after
install, visible resolution errors).

## Blocking findings

- **B1 — the content-resolution API is not dispatchable and doesn't
  bind content to the resolved Git revision.** `02.3` defines two
  unrelated `resolveArtifactContent(pkg, artifact)` functions (one per
  resolver) with no `Source`/resolver handle passed into `planInstall()`
  to know which one to call. Worse: `resolveGitCustom()` mutates one
  checkout in place — a refresh between catalog listing and deferred
  content reading can silently serve commit B's content while the
  `Package` still claims commit A. A TOCTOU bug, not just an ergonomics
  gap. Needs a real `SourceResolver` interface with
  `list()`/`resolveArtifact()`, and for Git, content must be read from
  an immutable per-commit snapshot/worktree or under a lock that covers
  content materialization, not just resolver mutation.
- **B2 — `targetRootPath` is assigned the `SKILL.md` file path, then
  treated as a directory to `fs.rename()` into.** Independently
  confirmed by the kilo-gemini review's B1 — same underlying bug, found
  by both reviewers without seeing each other's output. Needs an
  explicit `skillRootPath()`/unambiguous root-vs-manifest-file
  distinction on `Adapter`, settled in 03.4 before 06.1 is delegated.
- **B3 — plan and apply don't share one immutable prepared payload.**
  `planInstall()` resolves/translates content internally but only
  returns `InstallPlan` (no content); `applyInstall()` separately
  accepts a `content: CanonicalSkill` parameter with nothing proving
  it's the same content the plan was computed from, from the same
  commit, post-translation. Needs one `PreparedInstall { plan, payload,
  payloadHash }` object threaded through unchanged from plan to apply —
  `applyInstall()` should not take a separately-supplied `content` param
  at all.
- **B4 — "overwrite" silently deletes files the plan never mentioned.**
  06.1 explicitly defers "remove" detection; 06.2's directory swap
  replaces the *entire* existing directory regardless, so any
  pre-existing file not in the new payload (e.g. a user's own
  `user-notes.md` next to `SKILL.md`) silently vanishes — contradicting
  06.1's own "complete InstallPlan" goal and SPEC.md's preview
  requirement. Needs a full destination-tree diff (create/replace/
  remove) and a complete-tree precondition fingerprint, or an explicit
  Phase-1 refusal to overwrite when the destination has entries the new
  payload doesn't cover.
- **B5 — the rollback contract is internally contradictory.** Step 9 of
  06.2 says a state-write failure leaves the new content live with the
  backup merely "left nearby" — that is not a rollback (destination
  changed, registry doesn't record it, previous content not restored),
  yet the task's own opening promises `status: 'rolled-back'` on any
  failure. Post-swap verification failure handling is also incomplete
  (no defined compensation for the no-prior-target/create case). Needs
  an explicit compensation matrix per failure boundary (stage/backup/
  swap/verify/state-write/cleanup), and if full rollback after
  state-write failure genuinely can't be guaranteed, an honest
  `manual-recovery-required` outcome instead of overclaiming
  `rolled-back`.
- **B6 — the registry split drops desired installations and doesn't
  make `Source` actually portable.** `02.3`'s `ManifestFile` has no
  installations field at all (SPEC.md's own model calls for shareable
  desired installations, not just shareable sources) — this removes
  half the model rather than separating it. Also, `Source` itself
  carries `projectPath`/`localPath` (absolute machine paths in some
  cases) with no stated rule that a project manifest containing it
  stays portable across machines/collaborators.
- **B7 — `sourceAssistant` has no source of truth for a neutral,
  manifest-less artifact.** `02.3` deliberately makes `nativeFormat`
  neutral (`skill-md`, not `claude-skill`), but `06.1` still requires a
  `sourceAssistant: AssistantId` for translation, and the Available-view
  UI (07.2) never collects one — there's no assistant to pass for a
  generic `git-custom`/`local-folder` source. This is the same
  underlying tension as the first review's I10 (translator ownership),
  now concrete enough to block 06.1. Needs translation keyed by a
  capability/format identifier, not an invented source assistant, for
  sources with no native-format provenance.
- **B8 — required-field validation and resolver errors are still
  silently downgraded to a valid catalog entry.** The detector falls
  back to directory basename when `name` is missing and swallows
  read/traversal errors; 03.4 validates names/paths but not required
  frontmatter presence; 07.2 promises a visible error node for invalid
  sources that the resolver contract can't actually produce (it returns
  an empty catalog instead of an error). Needs a
  `DetectionResult{artifacts, diagnostics}` shape and explicit
  reject-not-silently-drop behavior for malformed/unreadable skills.
- **B9 — no explicit approval gate is required after preview.** 07.2
  only specifies `showInformationMessage` for the plan — not a modal
  with explicit Install/Cancel actions, nor a requirement that dismissal
  leaves the filesystem untouched. A delegated agent could satisfy the
  literal wording with a non-modal toast that installs regardless.

## Important non-blocking findings

- **I1** — the `.ai-toolkit`→`.ai-swissknife` rename isn't explicitly
  extended to the Git cache path (`src/sources/gitCustom.ts:64`).
- **I2** — `schemaVersion` checking is version-equality only, not real
  runtime schema validation of the file's contents.
- **I3** — Git cache identity can collide (sanitized IDs like `a/b` vs
  `a_b`) and the lock proposed in 04.3 is in-process only — separate
  VSCode windows are separate processes, the actual concurrency risk.
- **I4** — `withProgress` (07.2) has no `cancellable: true` / no
  cancellation propagation into Git commands.
- **I5** — `ArtifactFile[]` has no invariants against duplicate relative
  paths, `SKILL.md` as an auxiliary entry, parent/child path conflicts,
  case-folding collisions, or out-of-range mode values.
- **I6** — the "round-trip every value" YAML claim (03.4) still slightly
  overclaims vs. "semantic values within the project's declared schema"
  — also a stale "preserved verbatim" comment remains in
  `src/adapters/types.ts:7` and `src/translator/skill.ts:76-77`.
- **I7** — 05.2 treats 03.4 as a soft rather than hard dependency, but
  06 assumes the diagnostic contract already covers the hardened
  `files` payload.
- **I8** — multi-root source identity isn't scoped per workspace folder
  — `sourceId` alone can collide across folders/scopes.
- **I9** — the Installed view (07.3) groups only by `(assistant, scope)`,
  losing the project dimension SPEC.md's own model calls for in a
  multi-root workspace.
- **I10** — no locking around manifest/state read-modify-write across
  concurrent windows — only the final atomic rename is protected.
- **I11** — 06.1/06.2's verification sections omit `npm test` from the
  required gate, despite changing contracts existing tests depend on.
- **I12** — UI tasks can mark Phase 1 "done" without any real Extension
  Development Host verification, and specify no automated tests for
  command/cancellation/error-path behavior.
- **I13** — fixture provenance (04.3) asks only for an inline comment,
  not a license note for adapted external content.

## Task-by-task recommendations

**02.3**: revise before delegation — typed resolver contract bound to
immutable revision, `DesiredSource`/`DesiredInstallation` separate from
runtime types, decide where project state physically lives, add the
missing revision field to `ManagedInstallation`, inject persistence
paths as dependencies, extend the cache rename, add runtime schema
validation.

**03.4**: directionally strong — add `skillRootPath()`, a materializer
producing an exact file manifest, required-frontmatter validation,
auxiliary-file invariants, and a note that resolver content loading (not
just adapter `readSkill`) must populate `files`.

**04.3**: fixture/dot-directory work is good; Git lifecycle needs a real
immutable-content-snapshot guarantee, collision-resistant cache
identity, origin verification, and a test proving a package resolved at
commit A still returns A's content after a later refresh moves to
commit B.

**05.2**: safe concept — make 03.4 a hard dependency, diagnose the full
hardened payload (files/modes too), fix the rule-diagnostic field list
(`CanonicalRule` only has `content`).

**06.1/06.2**: substantial rewrite needed per B2-B5 above — accept a
typed resolved artifact, return `PreparedInstall` not just `InstallPlan`,
make `targetRootPath` the skill directory, diff full trees including
removals, inject a transactional state store, define compensation per
failure boundary.

**07.1/07.2/07.3**: good UX corrections, blocked on the upstream
contract fixes; add scoped source identity, explicit modal approval,
cancellation propagation, and don't declare the vertical slice "done"
without a real EDH run.

## Recommended corrected dependency sequence

```text
02.3a (persisted DTOs + revision model)
  → 03.4 (codec + validation + full payload + skill-root contract)
  → 04.3 (resolver abstraction + immutable snapshot + fixtures)
  → 05.2 (complete diagnostics)
  → 06.1 (PreparedInstall + full diff/fingerprint)
  → 06.2 (transaction + full compensation matrix)
  → 07 (explicit refresh/preview/approval/apply UI)
```

## Final verdict

Do not start delegating 02.3 yet. Two foundational mistakes (B1
content-resolution dispatch/revision-binding, B6 registry split dropping
desired installations + unresolved portability) would propagate
directly into every downstream task. Still a bounded planning
correction, not a product redesign — once folded in, the hardening gate
is the right foundation.

## Method note

Requested via `mcp__codex__codex` directly, `sandbox: read-only`,
`approval-policy: never` — no files modified. Prompted under the
pre-`FORMAT.md` ad-hoc style (pointed at `codex-analysis-2.md` for depth
calibration) — later rounds use `tasks/_reviews/FORMAT.md` directly.
