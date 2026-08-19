---
target: tasks/02-domain-and-registry/02.3-hardening.md, tasks/03-claude-kilo-adapters/03.4-hardening.md, tasks/04-source-resolver/04.3-hardening.md, tasks/05-translator-skill/05.2-hardening.md, tasks/06-install-engine/06.1-plan-and-preview.md, tasks/06-install-engine/06.2-apply-and-verify.md, tasks/07-minimal-ui/07.1-sources-view.md, tasks/07-minimal-ui/07.2-available-view.md
date: 2026-08-18
commit: 7e123afa040a3f59262f1793a113a7cd1e3a73b4
engine: codex
model: default (via mcp__codex__codex)
verdict: stop and correct first
---

# Review: hardening gate round 002 — codex

## 1. Executive assessment

The revision correctly incorporates much of round 001, including the headline `skillDir()` fix, the visible `PreparedInstall`/`ApplyOutcome` shapes, resolved-revision provenance, resolver dispatch, explicit modal approval, and the two honest rollback cases. It is not yet safe to delegate, however. One locked decision (portable manifest sources plus `desiredInstallations`) is explicitly contradicted by the current text, and several cross-task boundaries remain either uncompilable or unable to provide the guarantees the text claims.

The most serious remaining problems are: `ResolvedArtifact.content` is typed `unknown` where planning consumes a `CanonicalSkill`; `Adapter.assistant` is wider than `translateSkill`'s target type; planning stores the translator input instead of its output; apply never authenticates the approved payload with `contentHash`; overwrite safety is not rechecked for newly appeared files; and the Git checkout lock is not required to cover checkout plus content reading as one critical section. These are specification defects, not implementation details an executor should be expected to resolve independently.

Decision status: 1, 3, 5, 10, and 12 are correctly reflected; 2, 4, 6, 7, 8, and 11 are only partially reflected; 9 is not reflected correctly.

## 2. What it gets right

1. Decision 1 is correctly and consistently expressed. `03.4` lines 92-110 add `Adapter.skillDir()` as the parent of `skillPath()`, and `06.1` lines 45 and 71-75/111-112 use it for the directory swap target.
2. The main shape of decision 2 is present: `06.1` lines 35-68 define `sourceId`, `packageId`, and `PreparedInstall { plan, content, contentHash }`; `06.2` lines 31-35 accepts the whole `PreparedInstall`; `07.2` lines 63-66 and 94-96 preserves and passes that object.
3. Decision 3 is present at `02.3` lines 48-54 and is carried into plan, state persistence, tests, and the unchanged Installed view (`06.1` line 41; `06.2` lines 99-108/127-132; `07.3` line 27).
4. Decision 4's removal of `sourceAssistant`/`fromAssistant` is explicit in `05.2` lines 8-48 and `06.1` lines 71-73/101-105. The remaining target-type defect is separate and listed below.
5. Decision 5 is correctly specified at `06.1` lines 61-68 and 93-100: planning receives `Source` and dispatches by `source.type`.
6. Decision 6's recorded-commit checkout requirement and regression test are strong in `02.3` lines 89-105 and 172-180. The missing shared-lock boundary is listed below.
7. Decision 7 is represented in the plan and apply shapes (`06.1` lines 47-48/120-125; `06.2` lines 54-64) and has direct tests (`06.2` lines 136-139).
8. Decision 8's fourth outcome is present at `06.2` lines 25-29. Final verification failure with a backup restores it; a fresh-install verification failure removes the new tree; state-write failure is honestly reported as manual recovery (`06.2` lines 84-117). Tests distinguish these cases at lines 146-161.
9. Decision 10 is unambiguous: `03.4` lines 41-53 says `parseSkillMarkdown` always returns `files: []`, while directory-aware callers populate supporting files.
10. Decision 11 correctly removes basename fallback at the codec level and supplies invalid fixtures (`03.4` lines 143-154/173-175; `04.3` lines 69-82). The unresolved diagnostic transport is listed below.
11. Decision 12 is correctly implemented in the spec: `07.2` lines 75-85 requires a modal Install/Cancel gate for every install and makes cancellation or dismissal a no-op.
12. The smaller round-001 corrections are mostly retained: SHA-256 is named (`06.1` lines 58/126-131), final file comparison is path-map based (`06.2` lines 84-88), `ConversionDiagnostic` is imported from the domain (`06.1` lines 23-25), and the Activity Bar icon is a real asset (`07.1` lines 24-33).

## 3. Blocking findings

### B1 — Locked decision 9 is explicitly reversed in `02.3`

`tasks/02-domain-and-registry/02.3-hardening.md`, lines 144-155, specifies `ManifestFile.installations: DesiredInstallation[]`, not the locked `desiredInstallations` field. More importantly, lines 149-152 explicitly retain `Source[]` with possibly absolute `projectPath`/`localPath` and defer portability. Round 001 decision 9 requires a persisted portable `DesiredSource` representation that omits or workspace-relativizes absolute values. The current manifest therefore remains non-portable while calling itself “shareable, portable.”

Correct the manifest contract to use the locked field name and a concrete `DesiredSource` type plus conversion rules. State exactly how global/project local-folder paths and project roots are represented on write and resolved on read. Update the round-trip tests accordingly.

### B2 — Resolver output is `unknown`, but planning consumes it as `CanonicalSkill`

`tasks/02-domain-and-registry/02.3-hardening.md`, lines 58-79, gives both skill resolvers the return type `Promise<ResolvedArtifact>`; because the generic defaults to `unknown`, `.content` is `unknown`. `tasks/06-install-engine/06.1-plan-and-preview.md`, lines 93-108, immediately passes that content to `translateSkill`, `validateSkillName`, and `content.files`. That cannot typecheck without an unchecked cast, and no narrowing contract is specified.

Make the existing skill resolvers return `Promise<ResolvedArtifact<CanonicalSkill>>` (or define a discriminated resolved-artifact union keyed by kind). Do not leave the executor to cast `unknown` at this core trust boundary.

### B3 — The target-assistant type mismatch remains after removing the source assistant

`tasks/05-translator-skill/05.2-hardening.md`, lines 25-35, retains `toAssistant: SupportedAssistant`, where `SupportedAssistant` is Claude/Kilo only. `tasks/06-install-engine/06.1-plan-and-preview.md`, lines 101-102, passes `targetAdapter.assistant`. In the real `src/adapters/types.ts`, `Adapter.assistant` is `AssistantId`, which also includes GitHub Copilot, Codex CLI, and Gemini CLI. This is the same class of compile-time mismatch round 001 eliminated on the source side, now left on the target side.

Choose one coherent target-capability contract. For Phase 1, either type skill-capable adapters so their `assistant` is the narrow supported union, narrow before the call with an unsupported plan result, or make `translateSkill` take a capability-bearing adapter as decision 4 originally states. Add a typechecked unsupported-target test.

### B4 — `PreparedInstall.content` is specified as the translator input, not the translated output

`tasks/06-install-engine/06.1-plan-and-preview.md`, line 57, correctly calls `content` “the exact translated content.” Lines 101-105 then contradict that by storing “the exact `CanonicalSkill` this call was given,” ignoring `TranslationResult.value`. All path construction and planned files at lines 106-131 likewise use the pre-translation value.

Name the resolver result and translator result separately. Validate, plan, hash, and store `translation.value`. `PreparedInstall.content` must be the output whose diagnostics were produced and whose bytes apply will write. Add a translator test double that changes a field so this cannot regress behind Phase 1's currently identity-only behavior.

### B5 — `contentHash` does not bind the approved preview to apply

Decision 2 intends one approved payload to cross the plan/apply boundary. `06.1` lines 55-59 creates `contentHash`, but `tasks/06-install-engine/06.2-apply-and-verify.md`, lines 54-77, never recomputes and compares it before staging. Lines 99-100 only say to compute a hash later for persistence. Because `PreparedInstall.content` and its `files` array remain mutable JavaScript objects, a caller or intervening code can change content after preview; apply will write the changed content and verify against that same changed object.

At the start of apply, before any filesystem mutation, recompute the shared canonical hash and refuse if it differs from `prepared.contentHash`. Persist that already-verified hash rather than silently accepting a replacement value. Add a test that mutates content between plan and apply and expects `refused` with no staging or swap.

### B6 — Overwrite safety does not detect files created after preview

`tasks/06-install-engine/06.2-apply-and-verify.md`, lines 65-69, rechecks only each `PlannedFile`'s recorded hash or nonexistence. It does not recompute the target tree's uncovered files. If `user-notes.md` appears after planning but before apply, none of the planned-file checks sees it; the directory swap deletes it despite decision 7.

The apply precondition must re-walk the target and compare the complete relative-path/type/hash snapshot, or at minimum recompute `uncoveredExistingFiles` and refuse if any are now present. Add the exact regression test: create an uncovered file after preview, then assert refusal and byte-for-byte preservation.

### B7 — The shared Git lock does not protect checkout plus content read atomically

`tasks/02-domain-and-registry/02.3-hardening.md`, lines 89-105, requires `resolveArtifactContent` to checkout `pkg.version.commit` and then read it. `tasks/04-source-resolver/04.3-hardening.md`, lines 35-44, introduces a per-cache mutex but describes and tests only concurrent `resolveGitCustom` calls. Locking the checkout command alone is insufficient: another resolve can checkout a different ref after the content resolver's checkout and before its directory walk/read, recreating the exact wrong-revision race decision 6 is meant to close.

Require one shared per-cache-dir mutex used by both `resolveGitCustom` and Git `resolveArtifactContent`, with the content resolver holding it across checkout and the entire payload read. Add an interleaving test between those two functions, not only two listing calls.

### B8 — Several transaction failure points still have no honest recovery contract

`tasks/06-install-engine/06.2-apply-and-verify.md`, lines 50-52, promises that every failure point triggers cleanup and an honest outcome, but the detailed rules only cover final verification and state-write failure. In particular, if the existing target was moved to backup at lines 78-81 and the staged-to-target rename at lines 82-83 fails, the destination is absent and no required restoration/outcome is stated. Likewise, lines 96-98 return `rolled-back` after removing a failed fresh install without saying what happens if removal fails.

Specify outcomes and cleanup for staging failure, staged verification failure, backup move failure, atomic-swap failure after backup, failed-new-tree quarantine failure, backup restoration failure, and fresh-install cleanup failure. `rolled-back` is permitted only after restoration/removal actually succeeds; otherwise return `manual-recovery-required` with every relevant recovery path. Add injected-failure tests for at least swap-after-backup and fresh-install cleanup failure.

### B9 — Required-frontmatter “diagnostics” have no defined transport

`tasks/03-claude-kilo-adapters/03.4-hardening.md`, lines 143-154, tells `detect.ts` to catch codec errors and handle them as detection-time diagnostics. `tasks/04-source-resolver/04.3-hardening.md`, lines 69-82, requires the detector to “surface a diagnostic.” The real `findSkillDirs` returns only `DetectedSkillDir[]`; neither task defines a diagnostic result type, whether invalid siblings are skipped or abort the source, or how the error reaches `Package`/catalog/UI. An executor cannot satisfy the stated acceptance criterion without inventing a public contract.

Define a detector result such as `{ skills: DetectedSkillDir[]; diagnostics: DetectionDiagnostic[] }` (including path, code, and message), thread it through both resolvers, and state how `07.2` displays source diagnostics. Add a mixed fixture proving one invalid skill yields a visible diagnostic without hiding valid siblings.

### B10 — Source removal ignores shareable desired installations

Once decision 9 is corrected, `tasks/07-minimal-ui/07.1-sources-view.md`, lines 71-81, checks only machine-local `ManagedInstallation`s before deleting a source. It neither checks nor updates the manifest's `DesiredInstallation` entries. Removing a source can therefore leave shareable intent pointing at a nonexistent `sourceId`, even on a machine with no current managed installation.

Require removal to inspect both local state and manifest intent. Define whether “Remove Anyway” also removes dependent desired entries atomically or refuses until they are removed; do not silently create dangling manifest references. Test all four combinations of managed and desired references.

## 4. Important non-blocking findings

### I1 — `03.4` gives contradictory scheduling instructions

`tasks/03-claude-kilo-adapters/03.4-hardening.md`, lines 15-19, says 02.3 must land first and then says the tasks can run in parallel. That is not true after lines 47-50 make 03.4 update the `resolveArtifactContent` call sites that 02.3 creates. Keep only the hard dependency and note the shared resolver files.

### I2 — `05.2` cites the wrong locked decision

`tasks/05-translator-skill/05.2-hardening.md`, line 3, cites decisions 4 and 9. Decision 9 concerns registry portability, not translator provenance. This should cite decision 4 only (plus any explicitly enumerated non-blocking diagnostic finding) to avoid misleading durable history.

### I3 — Existing non-directory and symlink targets are underspecified

`06.1` lines 47 and 113-125 says `targetDir` existing “in any form” is a conflict, but its recursive file walk and `06.2`'s swap sequence assume a directory. Define refusal or explicit handling for a regular file, symlink, socket, and unreadable directory at `targetDir`; a symlink must not be followed given `03.4`'s stated policy.

### I4 — Unsupported `PreparedInstall` uses dummy valid-looking payload fields

`06.1` lines 86-92 allows dummy/empty `content` and `contentHash` when unsupported. A discriminated result (`{ supported: false, ... } | { supported: true, prepared: PreparedInstall }`) would make invalid use unrepresentable and remove repeated caller discipline. If the current shape is retained, specify concrete dummy values and require apply to check support before touching or hashing them.

### I5 — `07.2` does not explicitly retain the `Package` needed by `planInstall`

`tasks/07-minimal-ui/07.2-available-view.md`, lines 41-49, describes cached Source nodes with Artifact children, while lines 63-67 calls the revised planner, which requires `Source`, `Package`, and `Artifact`. Require the cached leaf model to retain all three (or maintain a package-id map) rather than reconstructing a `Package` from the artifact.

### I6 — The modal approval decision lacks a behavioral test

`07.2` lines 75-85 correctly specifies the gate, but verification at lines 109-111 is build-only. Add command-handler tests proving Install calls apply once, Cancel calls it zero times, dismissal calls it zero times, and unsupported plans show no modal/apply. This is cheap protection for a locked safety decision.

### I7 — Requested-ref wording should be made uniform

Round 001 decision 9 says “requested version,” while `02.3`'s concrete type uses `requestedRef`. The current type is reasonable and matches `ResolvedRevision.requestedRef`; use `requestedRef` consistently in the summary references, manifest schema, and UI copy to prevent an implementer from adding both fields.

## 5. Task-by-task recommendations

### `02.3-hardening.md`

Implement the full portable `DesiredSource`/`desiredInstallations` decision; type skill resolver content as `CanonicalSkill`; and state that Git content resolution uses the same lock later extended by 04.3. Expand manifest portability and mixed listing/content concurrency tests.

### `03.4-hardening.md`

Keep the codec/files/validation/`skillDir` work. Remove the “can run in parallel” sentence, make 02.3 a strict dependency, and define the detection diagnostic API jointly with 04.3 rather than merely telling callers to catch an error.

### `04.3-hardening.md`

Extend the mutex scope to both Git entry points and hold it through content reading. Test `resolveGitCustom` interleaved with `resolveArtifactContent`. Specify the detector's diagnostic-bearing return shape and mixed valid/invalid behavior.

### `05.2-hardening.md`

Resolve the target `AssistantId`/`SupportedAssistant` boundary, correct the decision citation, and keep translation output clearly distinct from input. The per-field diagnostic requirements are otherwise sound.

### `06.1-plan-and-preview.md`

Consume typed resolver content, store and plan from `TranslationResult.value`, validate source/package/artifact identity, and make unsupported results discriminated if practical. Define handling for non-directory/symlink targets and produce a complete target snapshot suitable for apply-time comparison.

### `06.2-apply-and-verify.md`

Verify `contentHash` before touching disk; revalidate the complete target tree including newly uncovered files; and specify honest recovery for every failure point in the transaction. Add the mutation, late-file, swap-failure, and cleanup-failure tests described above.

### `07.1-sources-view.md`

Use the corrected portable manifest model and handle both desired and managed references when removing a source. Preserve or remove dependent desired entries according to an explicit, atomic rule.

### `07.2-available-view.md`

Retain Source+Package+Artifact in cached leaf state, display resolver/detector diagnostics, add behavioral tests for the modal gate and all four apply outcomes, and continue passing the unchanged `PreparedInstall` object after its hash has been verified by apply.

### Unchanged `07.3-installed-view.md`

Its use of `readState`, `sourceRevision`, and the refresh hook remains consistent with the revised tasks. No change is required for round 002.

## 6. Final verdict

**Stop and correct first.** The round-001 direction is substantially present, but the current specifications still contain a direct reversal of locked decision 9, two concrete TypeScript boundary failures, and multiple gaps that can allow unapproved or newly conflicting content to be written. Correct B1-B10 and rerun a focused cross-file verification before delegating implementation.
