---
target: tasks/02-domain-and-registry/02.3-hardening.md, tasks/03-claude-kilo-adapters/03.4-hardening.md, tasks/04-source-resolver/04.3-hardening.md, tasks/05-translator-skill/05.2-hardening.md, tasks/06-install-engine/06.1-plan-and-preview.md, tasks/06-install-engine/06.2-apply-and-verify.md, tasks/07-minimal-ui/07.1-sources-view.md, tasks/07-minimal-ui/07.2-available-view.md, tasks/07-minimal-ui/07.3-installed-view.md
date: 2026-08-18
commit: b4e7f92aeca3c9b36a33f5bc53bcc6c12e7481f6
engines: [kilo-gemini, codex, claude-blind-subagent]
author: orchestrator (Claude, this conversation)
---

# Summary: hardening gate review round — convergence and resolution

Individual reviews (full, unabridged): [kilo-gemini](001-hardening-gate-kilo-gemini.md),
[codex](001-hardening-gate-codex.md),
[claude-blind-subagent](001-hardening-gate-claude-blind-subagent.md).

## Convergence

**Triple-confirmed (all 3 engines, independently, without seeing each
other's output)**: `InstallPlan.targetRootPath` is computed via
`Adapter.skillPath()`, which returns the `SKILL.md` **file** path, not
the skill's directory — `06.2`'s atomic `fs.rename()` of a staged
directory onto that path breaks the transaction. The single most certain
finding of the round; treated as ground truth, no further debate needed.

**Double-confirmed**:

- `ManagedInstallation` has no field for the resolved Git revision, but
  `06.2` and `07.3` both assume one exists (kilo-gemini B3,
  claude-blind-subagent B3).
- The plan/apply boundary doesn't actually carry a proven, identical
  content payload from planning through to the write (codex B3, B6;
  claude-blind-subagent B6) — different framing, same root cause.
- `sourceAssistant`'s provenance for a manifest-less custom source is
  undefined, and the translator's ownership of assistant identity is
  unresolved (codex B7; claude-blind-subagent B4 — which additionally
  found the concrete `SupportedAssistant` vs `AssistantId` type
  mismatch neither other engine caught).
- The resolver-dispatch step (`planInstall` calling "the artifact's
  resolver's `resolveArtifactContent`") has no way to know which
  resolver that is (codex B1's dispatch half; claude-blind-subagent B5).

**Novel, single-engine findings judged real and worth acting on**:

- codex B4 — "overwrite" silently deletes destination files the new
  payload doesn't mention (a real data-loss path, not just an
  ergonomics gap).
- codex B5 — the rollback contract mislabels a state-write failure as
  `'rolled-back'` when the destination was never actually restored.
- codex B6 — the registry manifest/state split dropped the
  *desired-installations* half of the shareable model, and `Source`'s
  absolute-path fields aren't actually portable.
- codex B8 — required-frontmatter/resolver-error validation still
  silently downgrades to a valid catalog entry instead of a diagnostic.
- codex B9 — no explicit modal approval is required between preview and
  apply.
- claude-blind-subagent B7 — `parseSkillMarkdown`'s signature can't
  produce the mandatory `CanonicalSkill.files` field the same task
  (03.4) requires; needs an explicit statement of which function
  populates `files`.
- claude-blind-subagent B2 — `InstallPlan` is also missing
  `sourceId`/`packageId`, which `06.2` needs to build the installation
  record (distinct from, and more specific than, codex's B3/B6 framing
  of the same underlying plan/apply gap).

**Disagreements**: none substantive — kilo-gemini's scope was
consistently a subset of what codex/claude-blind-subagent found (it
caught the headline bug and 2-3 real secondary ones; it didn't surface
the TOCTOU git issue, the overwrite-deletes-files issue, or the
rollback-contradiction issue). No engine's recommendation contradicted
another's; this was a coverage difference, not a disagreement to
mediate.

**What this says about the practice itself** (the meta-purpose of
tracking this): worth doing. A single-engine review (any one of the
three alone) would have shipped 06.1/06.2 with at least one
transaction-breaking bug (the triple-confirmed one) undetected until
integration, plus — had only kilo-gemini run — a real data-loss path
(overwrite deleting user files) and a dishonest rollback status would
have gone to delegation uncaught. Codex's review was the deepest/most
systemic (found the TOCTOU git issue, the data-loss path, and the
rollback dishonesty — arguably the three most user-impacting findings of
the whole round); the blind Claude subagent was sharpest on concrete
compile-time/type-level contradictions; Kilo was fastest and still
independently confirmed the headline bug. Running only one would have
been materially cheaper but would have missed real, high-impact issues
a delegated Executor could easily have built and shipped.

## Resolution — locked-in design decisions

These are now decided, not open questions — recorded here so the actual
task-file edits (next) don't have to re-litigate them, and so no future
reader re-opens a settled call without reading this first.

1. **Add `Adapter.skillDir(name, loc): string`** returning the skill's
   directory (`path.dirname` of what `skillPath` returns). `06.1`
   computes `targetRootPath` via `skillDir()`, never `skillPath()`.
   Closes the triple-confirmed bug.
2. **`planInstall` returns a `PreparedInstall`, not just an
   `InstallPlan`.** `PreparedInstall { plan: InstallPlan; content:
   CanonicalSkill; contentHash: string }`. `InstallPlan` itself gains
   `sourceId`/`packageId` fields (from `pkg.sourceId`/`artifact.packageId`,
   already available inside `planInstall`). `applyInstall` takes the
   whole `PreparedInstall`, not a separately-supplied `content` param —
   closes codex B3/B6 and claude-blind-subagent B2/B6 together.
3. **Add `sourceRevision?: ResolvedRevision` to `ManagedInstallation`**
   in `02.3`, alongside the `Package.version` change it already makes.
   Closes kilo-gemini B3 / claude-blind-subagent B3.
4. **Drop `sourceAssistant` from `planInstall`/`translateSkill`
   entirely for Phase 1.** A `git-custom`/`local-folder` source's
   content is always neutral `skill-md` with no real originating
   assistant to translate *from* — the parameter was unresolvable in
   practice, not just mistyped. `translateSkill` becomes
   target-capability-only (`translateSkill(content, targetAdapter)`);
   for Claude/Kilo in Phase 1 this is still always `lossless` (nothing
   behavioral is lost by removing it). Closes codex B7 / claude-blind-
   subagent B4 by elimination rather than by patching the type.
5. **`planInstall` takes the resolving `Source`, not just
   `Package`/`Artifact`**, and dispatches to `localFolder.ts`'s or
   `gitCustom.ts`'s `resolveArtifactContent` based on `source.type`.
   Closes codex B1's dispatch half / claude-blind-subagent B5.
6. **Git content resolution re-checks out the exact recorded commit at
   content-read time**, not "whatever's currently checked out" —
   `resolveArtifactContent` in `gitCustom.ts` takes the `Package`'s
   already-resolved `ResolvedRevision.commit` and does
   `git checkout <commit>` again before reading files, closing the
   TOCTOU gap between listing and content-read without needing a full
   immutable-per-commit-worktree architecture (deferred to a later
   phase as a possible improvement, not required now).
7. **Refuse overwrite when the destination has files the new payload
   doesn't cover**, instead of silently deleting them in the directory
   swap. Phase 1 does not implement partial removal — an uncovered
   existing file makes `apply` return `refused`, not `installed`.
   Closes codex B4.
8. **Add a fourth `ApplyOutcome` state**: `{status:
   'manual-recovery-required'; reason; backupPath?}` for the case where
   the swap succeeded but the state write failed — this is honestly
   not a rollback, and must never be reported as `'rolled-back'` or
   silently as `'installed'`. Also: verification failure on a *create*
   (no prior backup) must remove the newly-written tree, not just "note
   the failure." Closes codex B5.
9. **`ManifestFile` gains a `desiredInstallations` field** (shareable
   intent: source/package/artifact identity + target assistant/scope +
   requested version — no absolute paths, no timestamps, no hashes).
   `Source.projectPath`/`localPath` stay as runtime-only fields; the
   persisted `DesiredSource` used in the manifest omits or
   workspace-relativizes anything absolute. Closes codex B6.
10. **`parseSkillMarkdown` always returns `files: []`**; populating the
    full directory payload is `readSkill`'s/`resolveArtifactContent`'s
    job, layered on top by walking the directory separately. Stated
    explicitly in `03.4` so no implementer has to guess. Closes
    claude-blind-subagent B7.
11. **Required-frontmatter validation returns a diagnostic instead of
    falling back to the directory basename.** `parseSkillMarkdown`/the
    detector must not silently accept a skill with no `name` — this
    becomes a `04.3` invalid-fixture case with a stated expected
    diagnostic. Closes codex B8.
12. **`07.2`'s install confirmation is an explicit modal with
    Install/Cancel actions**, not a plain informational toast; dismissal
    is a no-op. Closes codex B9.

Non-blocking findings (I1-I13 across the three reviews) are folded into
the task files as smaller inline corrections where cheap (hash
algorithm named as SHA-256, `files` comparison by relative-path map not
array order, `ConversionDiagnostic` import path fixed, icon asset
question resolved directly rather than left open, etc.) — not tracked
as separate initiatives.

## What was NOT changed

- No fourth review round was requested — three independent engines
  reaching the same conclusion on the headline bug, with no contradicting
  recommendations anywhere else, is enough convergence to act on without
  further polling.
- The full immutable-per-commit-worktree architecture (a more complete
  fix for the git TOCTOU issue than decision 6 above) is deferred, not
  implemented — decision 6's re-checkout-by-commit is judged sufficient
  for Phase 1's actual risk level (a single developer's own registered
  sources, not a high-concurrency multi-tenant scenario).
