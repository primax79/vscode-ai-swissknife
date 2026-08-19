---
target: tasks/02-domain-and-registry/02.3-hardening.md, tasks/03-claude-kilo-adapters/03.4-hardening.md, tasks/04-source-resolver/04.3-hardening.md, tasks/05-translator-skill/05.2-hardening.md, tasks/06-install-engine/06.1-plan-and-preview.md, tasks/06-install-engine/06.2-apply-and-verify.md, tasks/07-minimal-ui/07.1-sources-view.md, tasks/07-minimal-ui/07.2-available-view.md
date: 2026-08-19
commit: bd7ffe0dda40f95717acb35c875cc04b95cfcce8
engine: codex
model: default (via mcp__codex__codex)
verdict: stop and correct first
---

# Review: hardening gate round 003 — codex

## 1. Executive assessment

The current rewrite correctly incorporates 18 of round 002's 19 decisions and most of decision 11. The new vocabulary is internally coherent across the eight primary task files: `DesiredSource`, `desiredInstallations`, `ResolvedArtifact<CanonicalSkill>`, `TranslationDiagnostic`, the discriminated `PreparedInstall`, `canonicalSkillHash`, and the four `ApplyOutcome` statuses are used consistently. The remaining occurrences of `installations` are legitimate references to `StateFile.installations`, not stale manifest-field uses; `applied` is used as the success status everywhere the outcome is discussed; and `SupportedAssistant` is mentioned only in 05.2's explicit removal instructions, not retained as the planned contract.

It is nevertheless not safe to delegate implementation yet. The rewrite dropped two round-001 safety requirements that round 002 had previously confirmed as fixed: it no longer requires `Adapter.skillDir()` when deriving the installation directory, and it no longer refuses an existing file that the proposed payload does not cover. The latter is now explicitly contradicted by the new “full replacement” UI policy, permitting deletion of arbitrary pre-existing files after approval. In addition, 06.2 still leaves a failed staged tree at an unreported path on one rollback branch, and it never specifies how a successful installation is merged into existing state rather than replacing the whole `StateFile`.

The final verdict is therefore **stop and correct first**. These are specification defects at destructive filesystem/state boundaries, not details to leave to an executor.

## 2. What it gets right

### Round-002 decision-by-decision re-verification

1. **Correct:** 06.1 lines 60–74 distinctly name `resolvedContent` and `translation`, then validate, hash, diff, and return `translation.value`.
2. **Correct:** 06.2 line 36 requires `chmod` for every defined staged file mode; line 76 tests survival through the swap.
3. **Correct:** 05.2 line 17 gives both translators the target-only `AssistantId` boundary and retires `SupportedAssistant`; lines 42 and 49 specify unsupported handling and typechecked coverage.
4. **Correct:** 02.3 line 43 and 04.3 line 21 require one shared, canonical-cache-dir mutex held by Git content resolution across checkout plus the complete `readSkill()` call.
5. **Correct:** 07.2 line 25 aborts on an `undefined` conflict-policy quick-pick; line 43 proves zero apply calls.
6. **Correct:** 06.1 lines 17–52 make `PreparedInstall` a discriminated union whose unsupported branch has no `content` or `contentHash`.
7. **Correct:** 02.3 lines 45–90 define `DesiredSource`, `desiredInstallations`, relative-path conversion, separate manifest/state files, and prohibit a manifest alias named `installations`. 07.1 consumes that boundary.
8. **Correct:** 02.3 lines 30–41 and 04.3 line 19 require `ResolvedArtifact<CanonicalSkill>` with no default generic or unchecked cast.
9. **Correct:** 06.2 lines 27–34 recompute `canonicalSkillHash` before mutation and refuse a mismatch; line 51 persists exactly `prepared.contentHash`.
10. **Correct as to the round-002 timing-window fix:** 06.2 line 32 re-walks the current file set and refuses changed, missing, or newly appeared files. This does not cure blocking finding B2 below, which concerns files already present and approved for silent deletion.
11. **Partially correct:** 06.2 now gives honest outcomes for staging, staged verification, backup-move, swap, final verification, state-write, and backup-cleanup failures, and defines proof-based meanings for `refused`, `rolled-back`, and `manual-recovery-required`. B3 identifies one remaining swap/cleanup hole.
12. **Correct:** 03.4 lines 31–35 define `DetectionDiagnostic`/`SkillDetectionResult`; 04.3 line 17 transports diagnostics in `SourceResolution`; 07.2 line 19 displays them even with no valid package.
13. **Correct:** 07.1 lines 29–44 checks state plus `desiredInstallations` and explicitly removes dependent desired entries while leaving files and machine-local state untouched.
14. **Correct:** 07.2 line 17 caches `{ source, package, artifact }`, and lines 21 and 42 use the complete identity.
15. **Correct:** 06.1 line 60 explicitly assigns `plan.sourceRevision = pkg.version`; line 80 tests Git and local cases.
16. **Correct:** 06.1 lines 66–70 and 06.2 line 31 refuse symlink, regular-file, special, and unreadable targets without following them; both files include tests.
17. **Correct:** 05.2 line 3 cites round-001 decision 4 only and explicitly retires the prior decision-9 citation.
18. **Correct:** 07.2 line 43 specifies exact behavioral spy counts for Install, modal Cancel/dismissal, conflict-picker dismissal, and unsupported plans.
19. **Semantically correct, with a wording cleanup remaining:** the contract uses only `requestedRef`; no competing field is defined. I6 notes two negative instructions that still literally repeat the retired prose phrase.

### Cross-file vocabulary and composition

- `PreparedInstall` has the same outer discriminator and supported payload everywhere it is consumed. `applyInstall` accepts the whole object, and 07.2 preserves object identity.
- `ApplyOutcome` is consistently `applied | refused | rolled-back | manual-recovery-required`; no current task or plan uses `installed` as a status.
- `ManifestFile.desiredInstallations` and `StateFile.installations` are kept distinct. Searches that find `installations` in 07.1 and the plans refer to machine-local state or ordinary prose, not a stale manifest field.
- `TranslationResult.value`, `overall`, and `diagnostics` compose correctly between 05.2, 06.1, and 07.2. There is no stale singular `diagnostic` in the planned API.
- `SourceResolution.diagnostics` uses the same `DetectionDiagnostic` transported out of `SkillDetectionResult`; 07.2 does not make malformed-only sources disappear.
- `canonicalSkillHash` is a single shared codec function imported by planning and apply rather than duplicated.
- SPEC.md §7, tasks/CONTEXT.md, and all six initiative plans accurately summarize the new round-002 names and major invariants, subject to the blockers below.

## 3. Blocking findings

### B1 — The rewrite dropped the required `Adapter.skillDir()` contract and reopens the original file-vs-directory target bug

**Exact locations:** `tasks/06-install-engine/06.1-plan-and-preview.md` lines 36 and 64–72 (`targetDir`, “Resolve the target through the adapter”); `tasks/03-claude-kilo-adapters/03.4-hardening.md` lines 17–35 (codec/adapter changes, but no `skillDir`); `src/adapters/types.ts` lines 19–25 (`skillPath()` exists, `skillDir()` does not).

Round-001 locked decision 1 required `Adapter.skillDir(name, loc): string` and required planning to use it, because the current `skillPath()` returns the `SKILL.md` file, not the skill directory. Round 002 explicitly reported this headline fix as present. The current heavy rewrite no longer mentions `skillDir` anywhere. “Resolve the target through the adapter” is not sufficient: a literal executor can use the only current method, assign the `.../SKILL.md` file path to `targetDir`, and then run directory `lstat`/swap logic against it.

Restore the explicit adapter contract in 03.4 and the explicit call in 06.1: `targetDir = targetAdapter.skillDir(translation.value.name, { scope, projectRoot })`. Require Claude/Kilo implementations and tests asserting that `skillDir === path.dirname(skillPath)` for global and project scopes.

### B2 — Existing uncovered files are now deliberately deleted, reversing round-001 decision 7

**Exact locations:** `tasks/06-install-engine/06.1-plan-and-preview.md` lines 39–40 and 69–72 (`existingFiles`, `proposedFiles`, previewed “removals”); `tasks/06-install-engine/06.2-apply-and-verify.md` line 32 (checks only whether the preview snapshot changed); `tasks/07-minimal-ui/07.2-available-view.md` lines 23–25 (“full replacement” is the mutating policy); `tasks/06-install-engine/06.2-apply-and-verify.md` line 84 (describes overwrite as an explicit UI policy).

Round-001 locked decision 7 says Phase 1 must refuse when the destination contains files the new payload does not cover; it explicitly says such a file returns `refused`, not a successful install. Round 002's prior text had `uncoveredExistingFiles`; the current rewrite removes that field and turns deletion into a user-approved full replacement. Full-tree apply-time revalidation only proves that those files did not change after preview—it does not prevent their deletion.

Reintroduce an explicit `uncoveredExistingFiles` path set (or equivalent `existing - proposed` calculation). A non-empty set must make the plan unsupported or make apply return `refused` without mutation. Remove additions/removals/full-replacement language that implies Phase 1 can delete uncovered files; replacements are safe only for proposed paths that collide. Add a test with an existing `user-notes.md` absent from the payload and prove planning/apply cannot delete it even after explicit Install approval.

### B3 — Swap-after-backup rollback can return `rolled-back` while leaving the staging tree unhandled and undisclosed

**Exact location:** `tasks/06-install-engine/06.2-apply-and-verify.md` lines 42–49, especially line 47.

If `target → backup` succeeds and `staging → target` fails, the staging directory normally still exists. Line 47 restores and verifies the backup but never requires staging cleanup, never defines the outcome if that cleanup fails, and never reports the residue path. This is part of round-002 decision 11's explicit requirement to define cleanup failure on rollback paths. The same line can therefore report a clean `rolled-back` outcome while leaving an untracked translated payload beside the target.

After restoring and verifying the original target, require removal and verified absence of staging. Either define `rolled-back` with a warning-bearing residue path, or—more consistently with the existing union—return `manual-recovery-required` with the staging path when cleanup cannot be proven. Extend the injected-failure matrix to fail this specific cleanup after successful backup restoration. Also spell out that final-verification/state-write recovery must quarantine or remove the new target before renaming backup back into place, with manual recovery if that prerequisite fails.

### B4 — Successful state persistence does not say to preserve/upsert existing installations

**Exact locations:** `tasks/06-install-engine/06.2-apply-and-verify.md` lines 51–55; `tasks/02-domain-and-registry/02.3-hardening.md` lines 74–77 and 88 (`StateFile.installations`, whole-file `writeState`).

06.2 says to persist one new `ManagedInstallation` through a whole-state writer, but never requires reading the existing `StateFile`, preserving unrelated records, or defining the identity used to replace a prior record for the same installation. A literal implementation can call `writeState({schemaVersion, installations: [newInstallation]})` and silently erase every other managed installation. This is a destructive negative claim and needs an explicit merge contract.

Define a stable state-record key (at minimum assistant + scope/project root + target path, or an explicitly chosen source/package/artifact/target tuple), read the relevant scoped state, replace exactly the matching record, and preserve all others. State writes must remain atomic. Add tests for first install, installing a distinct second skill, and reinstalling/updating the same target without duplicate records or unrelated-record loss.

## 4. Important non-blocking findings

### I1 — `canonicalSkillHash` no longer names SHA-256

**Exact location:** `tasks/03-claude-kilo-adapters/03.4-hardening.md` line 23.

Round 001's accepted smaller corrections explicitly named SHA-256. The rewrite now says only “hashes a stable serialization,” allowing an executor to pick a weak/non-portable algorithm. State that `canonicalSkillHash` returns lowercase hex SHA-256 over the defined stable byte serialization, and add a fixed test vector shared by 03.4/06.

### I2 — Final equality no longer requires a relative-path map

**Exact locations:** `tasks/06-install-engine/06.2-apply-and-verify.md` lines 38 and 49; `tasks/03-claude-kilo-adapters/03.4-hardening.md` line 23.

Round 001 explicitly corrected file comparison to be path-map based rather than array-order based. Hash sorting mitigates this, but “canonical equality” is undefined and may lead to direct array comparison after filesystem traversal. Say that equality compares scalar fields/extra fields plus a normalized relative-path map of `{content, mode}`, independent of traversal/array order.

### I3 — 02.3's grounding points at a nonexistent registry file

**Exact location:** `tasks/02-domain-and-registry/02.3-hardening.md` line 13.

The real store is `src/domain/registry.ts`; `src/registry/store.ts` does not exist. Update the grounding path so an executor reads the actual current implementation before replacing `readRegistry`/`writeRegistry`.

### I4 — 03.4's grounding contradicts its own scheduling note

**Exact locations:** `tasks/03-claude-kilo-adapters/03.4-hardening.md` lines 3, 13, and 35.

03.4 is explicitly first and line 35 says not to refer to not-yet-created `resolveArtifactContent()` functions, but line 13 instructs the executor to re-grep “both `resolveArtifactContent` functions” before editing. Replace that phrase with the current local/Git resolver functions and state that 02.3 later adds the two content entry points.

### I5 — Detection diagnostic fields are named but not concretely typed

**Exact location:** `tasks/03-claude-kilo-adapters/03.4-hardening.md` line 31; consumer at `tasks/07-minimal-ui/07.2-available-view.md` line 19.

The new result carrier is consistent, but “with `code`, `severity`, `path`, and `message`” leaves the public types and allowed severities/codes to the executor while the UI already assumes warning/error rendering. Include the exact TypeScript interface and either a code union or documented stable string constants. This will prevent detector, resolver, and UI tests from inventing different literals.

### I6 — The retired “requested version” phrase still occurs in two current task files

**Exact locations:** `tasks/02-domain-and-registry/02.3-hardening.md` line 28; `tasks/04-source-resolver/04.3-hardening.md` line 23.

Both uses are negative instructions, so there is no semantic second field. Still, round-002 decision 19 asked for `requestedRef` everywhere, and a literal stale-name search finds these. Reword as “do not introduce any alias for `requestedRef`” and “use the field name `requestedRef` exclusively.”

### I7 — 07.1 omits the concrete Activity Bar icon requirement previously accepted

**Exact location:** `tasks/07-minimal-ui/07.1-sources-view.md` line 17; summary plan at `tasks/07-minimal-ui/plan.md` lines 16–19.

The rewrite asks for a container id but no icon asset or manifest `icon` field. Round 001's accepted inline corrections said the icon-asset question was resolved. Restore the exact asset/write scope and require the `viewsContainers.activitybar` contribution to reference it.

### I8 — The unchanged Installed-view task is now incomplete for multi-root state

**Exact locations:** `tasks/07-minimal-ui/07.3-installed-view.md` lines 10–16 and 23–27; shared rule at `tasks/07-minimal-ui/plan.md` lines 20–27.

07.3 says it reads global plus project state but does not say which project root is selected in a multi-root workspace. Merely grounding against the Sources-view pattern is weaker than the plan's locked requirement that all project operations reuse the picker. Require 07.3 to reuse 07.1's selected workspace folder, disable project-state loading with zero folders, and refresh when the selected folder changes. Its verification should also run the full test suite, not only lint/typecheck/build, once the suite exists.

### I9 — `ManagedInstallation`'s legacy version field is not explicitly retired

**Exact location:** `tasks/02-domain-and-registry/02.3-hardening.md` line 28; real current field at `src/domain/types.ts` line 75.

The task says `ManagedInstallation.sourceRevision` uses `ResolvedRevision`, but does not explicitly say to remove the current `installedVersion?: string`. To avoid persisting two competing provenance fields, state that `sourceRevision` replaces/removes `installedVersion` and add a type/schema assertion that the legacy key is absent.

## 5. Task-by-task recommendations

### `tasks/02-domain-and-registry/02.3-hardening.md`

Keep the current `DesiredSource`/manifest-state split, typed artifact carrier, and shared-lock contract. Correct the grounding path (I3), explicitly retire `installedVersion` (I9), and remove the literal retired wording (I6). Add an exact state-record/upsert helper contract here or make 06.2 own it explicitly (B4). Consider making `DesiredSource` a source-type-discriminated persisted union or, at minimum, require read-time structural validation of required fields and relative `localPath`; the current all-optional interface alone does not make invalid persisted combinations unrepresentable.

### `tasks/03-claude-kilo-adapters/03.4-hardening.md`

Add `Adapter.skillDir()` and Claude/Kilo implementations/tests (B1). Pin SHA-256 and canonical serialization bytes (I1), define path-map equality semantics (I2), give `DetectionDiagnostic` an exact type (I5), and remove the nonexistent-content-resolver grounding instruction (I4). The codec, required `files`, safe traversal, mode preservation, and mixed valid/invalid detection behavior should remain.

### `tasks/04-source-resolver/04.3-hardening.md`

The typed content, diagnostic transport, one shared lock, and interleaving tests are ready. Only clean up the retired wording at line 23 (I6) and ensure the diagnostic literals exactly match 03.4's newly pinned interface.

### `tasks/05-translator-skill/05.2-hardening.md`

No blocking change. This file correctly composes `AssistantId`, `TranslationDiagnostic`, required `diagnostics`, unsupported targets, and `translation.value`. Keep the non-aliasing byte-buffer test because `PreparedInstall` integrity otherwise depends on mutable shared buffers.

### `tasks/06-install-engine/06.1-plan-and-preview.md`

Require `targetAdapter.skillDir()` explicitly (B1). Restore calculation/refusal of uncovered existing files and remove the ability to approve their deletion (B2). Keep the translated-output-only path, discriminated unsupported branch, exact `pkg.version`, full initial snapshot, and non-directory refusal. If removals remain in preview at all, define them only for files managed by a previously recorded installation and only after a future safe update policy exists—not for arbitrary target contents in Phase 1.

### `tasks/06-install-engine/06.2-apply-and-verify.md`

Retain the apply-time payload hash, complete snapshot recheck, staged modes, and proof-based outcome union. Add the uncovered-file refusal (B2), staging-residue handling after swap failure (B3), explicit failed-target quarantine/removal before backup restoration, and state upsert/preservation semantics (B4). Pin relative-path-map comparison (I2). Expand failure injection to cover rollback cleanup after successful restoration, not only initial staging cleanup.

### `tasks/07-minimal-ui/07.1-sources-view.md`

The portable source conversion and two-sided removal-reference checks are ready. Restore the concrete Activity Bar icon requirement (I7). Ensure the atomic removal write preserves all unrelated sources and desired entries.

### `tasks/07-minimal-ui/07.2-available-view.md`

The complete cached identity, diagnostic display, modal/dismissal gates, exact object identity, and four outcome renderings are ready. Remove “explicit full replacement” for uncovered existing files and align conflict handling with B2: Phase 1 may replace paths present in the proposed payload, but must refuse deletion of unrelated paths. Keep the exact zero/one apply-call spy tests.

### Plans, `SPEC.md`, `tasks/CONTEXT.md`, `tasks/specs/foundations.md`, and `07.3`

Update `tasks/03-claude-kilo-adapters/plan.md`, `tasks/06-install-engine/plan.md`, `tasks/07-minimal-ui/plan.md`, SPEC.md §7, and `tasks/CONTEXT.md` to restate the two restored invariants: adapter directory resolution uses `skillDir`, and uncovered pre-existing files are never deleted in Phase 1. Update `07.3-installed-view.md` for the shared multi-root picker and full-suite verification (I8). The other initiative dependency ordering and round-002 vocabulary are consistent as written.

## 6. Final verdict

**Stop and correct first.** Round-002 decisions 1–10 and 12–19 are correctly represented; decision 11 still has one rollback-cleanup hole. More importantly, the rewrite reintroduced the original `skillPath`/directory ambiguity and reversed the locked refusal of uncovered files, while leaving state-record preservation unspecified. Correct B1–B4 and re-run a narrow round-004 verification of those edits before delegating implementation. The important findings should be folded into the same correction pass because they are small, concrete, and mostly restore already accepted precision.
