---
target: tasks/02-domain-and-registry/02.3-hardening.md, tasks/03-claude-kilo-adapters/03.4-hardening.md, tasks/04-source-resolver/04.3-hardening.md, tasks/05-translator-skill/05.2-hardening.md, tasks/06-install-engine/06.1-plan-and-preview.md, tasks/06-install-engine/06.2-apply-and-verify.md, tasks/07-minimal-ui/07.1-sources-view.md, tasks/07-minimal-ui/07.2-available-view.md
date: 2026-08-19
commit: bd7ffe0dda40f95717acb35c875cc04b95cfcce8
engines: [codex]
---

# Summary: hardening gate round 003 — convergence and resolution

Individual review: [codex](003-hardening-gate-codex.md).

`kilo-gemini-3.7-flash` was also dispatched (isolated in its own
worktree) but crashed mid-review ("provider ended the response with an
error") before writing its output file, for the second time in this
project on a long, many-file review task — see the updated note in
`tasks/_reviews/00-INDEX.md` and the standing memory on this tier's
reliability limit for long analytical tasks. Its recovered partial
transcript had independently reconfirmed round 002 decisions 1–19 as
correctly reflected (matching codex's own conclusion of "18 of 19
correct, one partial") before crashing, so there's no reason to think a
successful full run would have disagreed with codex's B1–B4 below — but
this round has only one completed engine, not the usual two-to-three.

## What happened

The batch of task-file corrections committed after round 002
(`bd7ffe0`) was a large, from-scratch rewrite of all 8 hardening-gate
files (plus `SPEC.md`/`CONTEXT.md`/`foundations.md`/six `plan.md`
files) rather than a series of small, targeted edits against round
002's 19-item list. Round 003 exists specifically to catch what a broad
rewrite like that can silently undo — exactly the failure mode
`task-spec-authoring`'s "task granularity is the single biggest lever on
defect rate" principle warns about, here applied to spec-writing rather
than code.

It found real regressions: **the rewrite silently reversed two
previously double/triple-confirmed, already-fixed round-001 safety
properties** while correctly applying all 19 round-002 decisions.

## Convergence

Single-engine this round (see above), but both findings below reverse
specific, previously multi-engine-confirmed decisions from earlier
rounds — that history is itself corroborating evidence, not just one
reviewer's opinion:

- **B1 — `Adapter.skillDir()` dropped, reopening the original
  `skillPath()`/directory-swap bug.** Round 001's headline finding (found
  independently by all three round-001 engines) required
  `Adapter.skillDir(name, loc): string` because `skillPath()` returns the
  `SKILL.md` file, not the skill's directory. The round-002 rewrite of
  `06.1` no longer calls it — `03.4` no longer defines it either. "Resolve
  the target through the adapter" is not sufficient instruction; a
  literal executor has only `skillPath()` available and will reproduce
  the exact bug three engines already caught once.
- **B2 — uncovered pre-existing files are now deliberately deletable,
  reversing round-001 decision 7.** Decision 7 (also independently
  confirmed by multiple engines across rounds 001-002) requires refusing
  an overwrite when the target directory contains files the new payload
  doesn't cover. The rewrite replaced `uncoveredExistingFiles` with an
  `existingFiles`/`proposedFiles` preview plus a "full replacement" UI
  policy in `07.2` — full-tree revalidation at apply time only proves
  those files didn't *change* since preview, it does nothing to stop
  their approved *deletion*. This is a real data-loss regression, not a
  narrower restatement of the same rule.
- **Novel, single-engine, judged real:**
  - B3: a swap-after-backup rollback (`06.2`) can restore the original
    target and report `rolled-back` while never requiring cleanup of the
    now-orphaned staging directory, and never disclosing its path if
    cleanup isn't proven — a gap in round 002 decision 11's own
    "define every failure point" requirement, not a new category of bug.
  - B4: successful state persistence (`06.2` step 6) never says to read
    the existing `StateFile` and preserve unrelated records — a literal
    `writeState({schemaVersion, installations: [newInstallation]})` wipes
    every other managed installation. This is a destructive negative
    claim (`task-spec-authoring`'s term) with no stated safeguard.
  - I1–I9 (see the per-engine file): SHA-256 no longer named for
    `canonicalSkillHash`; "canonical equality" undefined at final
    verification; a stale grounding path (`src/registry/store.ts` doesn't
    exist); a scheduling contradiction in `03.4`'s own header; detection
    diagnostic fields lack concrete types; two leftover "requested
    version" phrases; the Activity Bar icon asset requirement (locked in
    round 001) dropped from `07.1`; `07.3` not updated for the shared
    workspace-folder picker; `ManagedInstallation.installedVersion` not
    explicitly retired in favor of `sourceRevision`.
- **What this says about the practice**: reviewing after every
  correction pass — not just after the first one — caught a real
  regression a single "trust the rewrite, it cites all the decisions"
  read would have missed, because the rewrite's own cross-references
  (headers citing "decisions 7 and 13", etc.) were internally consistent
  and confident-sounding while actually omitting the mechanism those
  decisions depend on. Citing a decision number is not evidence the
  decision's *mechanism* survived a rewrite — this is the same lesson as
  round 002's "the header's claim is not evidence" instruction to the
  blind reviewer, now shown to apply to the orchestrator's own trust in a
  large diff, not just to a reviewer being told to ignore a header.

## Resolution — locked-in decisions (round 003)

1. `03.4`: restore `Adapter.skillDir(name, loc): string` (returns the
   skill's directory, e.g. `path.dirname(skillPath(...))`), with Claude/
   Kilo implementations and a test asserting
   `skillDir === path.dirname(skillPath)` for both scopes.
2. `06.1`: `targetDir` must be computed via
   `targetAdapter.skillDir(translation.value.name, {scope, projectRoot})`
   — never `skillPath()`. State this explicitly; "resolve the target
   through the adapter" alone is not sufficient instruction.
3. `06.1`: reintroduce an explicit uncovered-files calculation
   (`existingFiles` minus `proposedFiles`, by path). A non-empty result
   makes the plan either unsupported or forces `06.2` to refuse — Phase 1
   may replace only paths already present in the proposed payload; it
   may never delete a path the payload doesn't mention, regardless of any
   UI-level "full replacement" approval. Remove any "removals"/
   "full replacement" language that implies otherwise.
4. `06.2`: apply must refuse (no mutation) when the uncovered-files set
   from decision 3 is non-empty, exactly like decision 7 originally
   specified — full-tree revalidation (round 002 decision 10) stays, but
   is understood as "detects changes since preview," not as a substitute
   for the uncovered-files refusal.
5. `06.2`: after a successful backup-restore following a swap-after-
   backup failure, require removing the orphaned staging directory and
   proving its absence before returning `rolled-back`; if that cleanup
   cannot be proven, return `manual-recovery-required` with the staging
   path instead. Also require quarantine/removal of the new target before
   restoring backup on final-verification/state-write failure paths, with
   the same manual-recovery fallback if that prerequisite fails.
6. `06.2`: state persistence must read the existing scoped `StateFile`,
   replace only the record matching a stated stable key (at minimum
   assistant + scope/project root + target path), and preserve every
   other record. Add tests for first install, installing a second
   distinct skill, and reinstalling/updating the same target.
7. `03.4`: `canonicalSkillHash` must be pinned as lowercase-hex SHA-256
   over the defined stable byte serialization, with a fixed test vector
   shared by `03.4`/`06`.
8. `06.2`: define "canonical equality" for final verification explicitly
   as a normalized relative-path map of `{content, mode}` compared
   independent of traversal/array order, not implicit array comparison.
9. `02.3`: fix the grounding path from the nonexistent
   `src/registry/store.ts` to the real `src/domain/registry.ts`; also
   explicitly state that `sourceRevision` replaces/removes the legacy
   `ManagedInstallation.installedVersion` field.
10. `03.4`: remove the internal contradiction between "03.4 lands first"
    and "re-grep both `resolveArtifactContent` functions before editing"
    (those don't exist yet when 03.4 starts) — replace with the current
    local/Git resolver function names and note that 02.3 adds the two
    content entry points afterward.
11. `03.4`/`04.3`/`07.2`: give `DetectionDiagnostic` a concrete
    TypeScript interface (not just "fields named `code`, `severity`,
    `path`, `message`") and either a `code` union or documented stable
    string constants, so detector/resolver/UI tests share literals.
12. `02.3`/`04.3`: replace the remaining literal "requested version"
    phrases with "do not introduce any alias for `requestedRef`" /
    "use the field name `requestedRef` exclusively."
13. `07.1`: restore the concrete Activity Bar icon-asset requirement
    (a real SVG/PNG path in `viewsContainers.activitybar[].icon`, per
    round 001's resolved finding) — the rewrite dropped this without
    reopening the underlying question, so it should be restored as
    previously specified, not re-litigated.
14. `07.3`: require reuse of `07.1`'s shared workspace-folder picker for
    multi-root project-state loading (disable with zero folders, refresh
    on selection change), matching the plan's own locked cross-view
    picker-reuse rule; run the full test suite once it exists, not only
    lint/typecheck/build.

## What was NOT changed

- Round 003 ran with only one completed engine (codex); the planned
  second data point (`kilo-gemini-3.7-flash`) crashed twice across two
  independent rounds on long review tasks and is not treated as a
  no-issues vote — its absence is a coverage gap, not evidence of
  agreement, even though its partial transcript happened to align with
  codex up to the crash point.
- No new engineering trade-off was re-opened beyond restoring the two
  reversed decisions and closing the four new gaps — this round is a
  correction of the round-002 rewrite's execution, not a re-litigation of
  round-002's own judgment calls.
- Given that a large, from-scratch rewrite is what caused this
  regression, the round-004 correction pass (next) should be dispatched
  as narrow, surgical edits against this decision list — not another
  full rewrite of the same files.
