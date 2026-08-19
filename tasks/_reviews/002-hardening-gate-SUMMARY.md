---
target: tasks/02-domain-and-registry/02.3-hardening.md, tasks/03-claude-kilo-adapters/03.4-hardening.md, tasks/04-source-resolver/04.3-hardening.md, tasks/05-translator-skill/05.2-hardening.md, tasks/06-install-engine/06.1-plan-and-preview.md, tasks/06-install-engine/06.2-apply-and-verify.md, tasks/07-minimal-ui/07.1-sources-view.md, tasks/07-minimal-ui/07.2-available-view.md
date: 2026-08-18
commit: 7e123afa040a3f59262f1793a113a7cd1e3a73b4
engines: [codex, kilo-gemini-3.1-pro, kilo-gemini-3.7-flash]
---

# Summary: hardening gate round 002 — convergence and resolution

Individual reviews: [codex](002-hardening-gate-codex.md),
[kilo-gemini-3.1-pro](002-hardening-gate-kilo-gemini-3.1-pro.md),
[kilo-gemini-3.7-flash](002-hardening-gate-kilo-gemini-3.7-flash.md).

A planned fourth engine (a fresh, context-blind Claude subagent) was
cancelled before producing output — the orchestrator was asked to stop
spending Claude tokens on review work mid-round and let Kilo/Codex carry
it instead. This round has no blind-subagent data point; all three engines
were told to read `001-hardening-gate-SUMMARY.md` first and re-verify the
12 decisions against the current text, not review from scratch.

## Convergence

- **Triple-confirmed**: `06.1`'s `planInstall` is specified to store the
  `CanonicalSkill` *given to* `translateSkill` as `PreparedInstall.content`,
  not `TranslationResult.value` (the actual output). All three engines
  caught this independently. This silently discards any translation and is
  the highest-value single finding of this round — it's a pure semantic
  bug `tsc` cannot catch (both are typed `CanonicalSkill`), exactly the
  class of error a fast, literal implementer would reproduce faithfully.
- **Double-confirmed**:
  - `06.2`'s staging step (2.4) never restores `file.mode` when writing
    `prepared.content.files`, silently dropping executable bits `03.4`
    explicitly added support for (kilo-gemini-3.1-pro B2,
    kilo-gemini-3.7-flash B2; codex did not flag this one).
  - `05.2` keeps `translateSkill`'s target parameter typed as the narrow
    `SupportedAssistant`, while `06.1` passes `targetAdapter.assistant`
    (typed `AssistantId`, a wider union) — a `tsc` failure waiting to
    happen (codex B3, kilo-gemini-3.7-flash B3; kilo-gemini-3.1-pro missed
    it, having judged the call sites as mapping "perfectly").
  - The per-cache-dir git mutex (`04.3`) doesn't provably cover
    `resolveArtifactContent`'s checkout+read (`02.3`) as one critical
    section, only `resolveGitCustom`'s own concurrent calls (codex B7,
    kilo-gemini-3.7-flash I2 — codex treats it as blocking, flash as
    non-blocking; resolved as blocking below, since it reopens the exact
    TOCTOU race decision 6 was meant to close).
  - `conflictPolicy`'s quick-pick being dismissed (`undefined`) must abort
    the install, not proceed with an undefined policy (kilo-gemini-3.1-pro
    I2; echoed generally by codex's broader point about undefined-outcome
    handling).
  - An unsupported `PreparedInstall`'s dummy `content`/`contentHash` should
    be concretely specified or made structurally unrepresentable, rather
    than left as "some dummy value" (codex I4, kilo-gemini-3.7-flash I4).
- **Disagreement, resolved**: round 001's decision 9 (a portable
  `DesiredSource` in the manifest, omitting/relativizing absolute paths)
  is, in the current `02.3` text, explicitly deferred as "a known
  follow-up, not blocking for Phase 1." Codex and kilo-gemini-3.1-pro both
  call this a direct reversal of a locked decision and treat it as
  blocking; kilo-gemini-3.7-flash accepts the deferral as reasonable for
  Phase 1 (its I1, non-blocking). **Resolved as blocking**: this project's
  own convention is that a locked-in decision is durable memory for a
  resolved ambiguity — a task file silently re-opening one (even with a
  polite "known follow-up" framing) is exactly the silent-re-decision
  failure mode the convention exists to prevent, regardless of whether the
  underlying engineering trade-off is individually defensible.
- **Novel, single-engine, judged real**:
  - `ResolvedArtifact<T>`'s generic defaults to `unknown` where the real
    skill resolvers return it unparameterized, so `06.1` consumes
    `.content` as `unknown` without a narrowing contract — a cast the spec
    never asks for but the code requires (codex B2).
  - `PreparedInstall.contentHash` is computed in `06.1` but never
    recomputed/compared in `06.2` before staging — since `content`/`files`
    are ordinary mutable objects, nothing stops the approved payload from
    being silently swapped between preview and apply (codex B5).
  - Apply's overwrite-safety check only re-validates the specific
    `PlannedFile`s from the plan, not the live target tree — a file that
    appears under `targetDir` *after* preview but *before* apply is never
    caught, defeating decision 7's intent for that specific timing window
    (codex B6).
  - Several apply failure points besides the two already-honest ones
    (final verification, state-write) still have no specified outcome:
    staging failure, staged-verification failure, backup-move failure,
    swap-after-backup failure, and cleanup failure on either rollback path
    (codex B8, sharpened by kilo-gemini-3.7-flash's I3 on the specific
    fresh-install `fs.rm` failure case).
  - `03.4`/`04.3` tell the detector to "surface a diagnostic" for invalid
    skill directories with no defined diagnostic type or transport to
    `Package`/UI (codex B9).
  - `07.1`'s source-removal check only looks at machine-local
    `ManagedInstallation`s, not the manifest's shareable
    `DesiredInstallation` entries — once decision 9 is properly
    implemented, removal must check both (codex B10).
  - `07.2`'s cached tree model (Source → Artifact) doesn't explicitly
    retain the `Package` that `planInstall` also requires as an argument
    (codex I5).
  - `06.1` step 2 never explicitly says to populate `sourceRevision` from
    `pkg.version` — only implied later when formatting the preview
    message (kilo-gemini-3.1-pro I1).
  - Non-directory/symlink/socket targets at `targetDir` are unhandled by
    both the conflict check and the swap sequence, which assume a plain
    directory (codex I3).
  - `05.2`'s header cites decision 9 (registry portability) as a rationale
    for its own change, when the relevant one is decision 4 (codex I2).
  - `07.2` has no behavioral test for the modal gate itself — Install
    calls apply once, Cancel/dismiss calls it zero times (codex I6).
  - Minor terminology: "requested version" (round 001 prose) vs.
    `requestedRef` (the actual field) should be used consistently
    everywhere it's mentioned (codex I7).
- **What this says about the practice**: reviewing the *fix* caught a
  defect the fix itself introduced (the translator input/output swap) that
  none of round 001's findings would have prevented — confirming this
  needs to be a standing step after every correction pass, not a one-time
  gate before the first round of fixes. Running Codex with
  `sandbox: workspace-write` so it wrote its own file directly (instead of
  the orchestrator transcribing, as in round 001) worked cleanly and is
  worth keeping as the default for docs-only review targets.

## Resolution — locked-in decisions (round 002)

1. `06.1`: `planInstall` must store `TranslationResult.value` (the
   translator's output) as `PreparedInstall.content`, not the value
   passed into `translateSkill`.
2. `06.2` step 2.4 (staging): must restore each staged file's `mode` when
   writing `prepared.content.files`, matching what `03.4`'s `writeSkill`
   already does for the non-staged path.
3. `05.2`: `translateSkill`'s (and `translateRule`'s) target parameter
   must be typed as `AssistantId`, not the narrower `SupportedAssistant` —
   for any `AssistantId` this Phase doesn't actually support translating
   to, return `{overall: 'unsupported', ...}` rather than failing to
   compile. `SupportedAssistant` is retired as a type name once no caller
   needs it.
4. `04.3`/`02.3`: the per-cache-dir mutex in `gitCustom.ts` must be a
   single lock shared by `resolveGitCustom` and `resolveArtifactContent`,
   held across the entire checkout-then-read sequence in the latter, not
   just around each function's own checkout call.
5. `07.2`: dismissing the `conflictPolicy` quick-pick (`undefined`) must
   abort the install with no call to `applyInstall` — same treatment as
   dismissing the Install/Cancel modal.
6. `06.1`: specify a concrete dummy `CanonicalSkill`/`contentHash` for the
   `supported: false` case (exact shape), or restructure `PreparedInstall`
   as a discriminated union so an unsupported result cannot carry
   plausible-looking content at all — implementer's choice, but the task
   file must pick one and say so.
7. **Decision 9 (round 001) is reinstated as blocking**: `02.3`'s
   manifest must define and use a real `DesiredSource` type distinct from
   the runtime `Source`, with absolute `projectPath`/`localPath` omitted
   or made workspace-relative on write and resolved back to an absolute
   path on read against the current workspace root. The "known follow-up,
   not blocking" framing is removed. `ManifestFile`'s field is named
   `desiredInstallations` (matching round 001's decision text exactly),
   not `installations`.
8. `06.1`: the skill resolvers' return type must be
   `Promise<ResolvedArtifact<CanonicalSkill>>` (or an equivalent
   kind-keyed discriminated union) so `.content` is typed, not `unknown`
   — no unchecked cast at this boundary.
9. `06.2`: before any filesystem mutation, recompute the canonical hash of
   `prepared.content` and refuse (`{status: 'refused'}`) if it doesn't
   match `prepared.contentHash` — this is the integrity check decision 2
   implied but never stated as enforced. Separately, when persisting
   `ManagedInstallation.contentHash` at step 2.9, reuse `prepared.
   contentHash` directly rather than recomputing a fresh value.
10. `06.1`/`06.2`: the overwrite-safety precondition re-check at apply time
    must re-walk `targetDir`'s current contents (not just re-check each
    `PlannedFile`'s recorded hash) and refuse if any file is present now
    that wasn't part of the plan — closes the preview-to-apply timing gap
    on decision 7's guarantee.
11. `06.2`: define an honest outcome for every remaining transaction
    failure point — staging failure, staged-copy verification failure,
    backup-move failure, and swap-after-backup failure — each returning
    either `refused` (nothing touched yet) or `manual-recovery-required`
    (partial state, say where) as appropriate; `rolled-back` remains
    reserved for cases where the destination is provably restored,
    including the fresh-install cleanup-failure case flash flagged.
12. `03.4`/`04.3`: define one concrete detector result shape (e.g.
    `{skills: DetectedSkillDir[], diagnostics: DetectionDiagnostic[]}`)
    and thread it through both resolvers to `07.2`'s display — replacing
    the current "surface a diagnostic" instruction with no defined type.
13. `07.1`: source removal must check both `StateFile`
    (`ManagedInstallation`) and the manifest's `desiredInstallations`
    (post decision 7 above) for references to the source being removed,
    and state explicitly whether "Remove Anyway" also removes the
    dependent desired entries or leaves them dangling by design.
14. `07.2`: the cached per-source tree state must retain the `Package`
    alongside each `Artifact` (or an equivalent lookup), since `planInstall`
    requires all three identities.
15. `06.1`: step 2 must explicitly say `sourceRevision` is populated from
    `pkg.version`, not just imply it later.
16. `06.1`/`06.2`: define refusal/handling for a non-directory (regular
    file, symlink, socket, unreadable directory) at `targetDir` — a
    symlink must not be followed, per `03.4`'s existing policy.
17. `05.2`: fix the header citation from "decisions 4, 9" to "decision 4"
    only.
18. `07.2`: add the behavioral test decision — Install calls apply exactly
    once, Cancel/dismiss calls it zero times, unsupported plans show
    neither modal nor apply call.
19. Use `requestedRef` consistently wherever round 001/002 prose currently
    says "requested version," to avoid an implementer adding both.

## What was NOT changed

- No fourth (blind) engine ran this round — deliberately, per the
  orchestrator's token-conservation instruction mid-round. If a future
  round wants the blind-subagent data point back, dispatch it separately
  rather than folding it into a round already in flight.
- The underlying engineering question decision 7 above resolves (should
  Phase 1 build full manifest portability now, or defer it) was not
  re-litigated on its technical merits beyond re-affirming that a locked
  decision doesn't get silently walked back in a later task file; if
  Phase 1's scope genuinely needs to change, that requires an explicit new
  decision with the user, not a task file quietly narrowing it.
