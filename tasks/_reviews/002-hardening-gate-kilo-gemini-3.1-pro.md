---
target: tasks/02-domain-and-registry/02.3-hardening.md, tasks/03-claude-kilo-adapters/03.4-hardening.md, tasks/04-source-resolver/04.3-hardening.md, tasks/05-translator-skill/05.2-hardening.md, tasks/06-install-engine/06.1-plan-and-preview.md, tasks/06-install-engine/06.2-apply-and-verify.md, tasks/07-minimal-ui/07.1-sources-view.md, tasks/07-minimal-ui/07.2-available-view.md
date: 2026-08-18
commit: 7e123afa040a3f59262f1793a113a7cd1e3a73b4
engine: kilo-gemini-3.1-pro
model: google/gemini-3.1-pro-preview-customtools
verdict: proceed with changes
---

# Review: hardening gate round 002 — kilo-gemini-3.1-pro

## 1. Executive assessment
The tasks correctly fold in almost all of the 12 locked-in decisions from round 001. The transition to a transactional `PreparedInstall` pattern and the elimination of `sourceAssistant` are structurally sound. However, one specific decision regarding absolute paths in the manifest was explicitly ignored in `02.3`, and the rewrite of `06` introduced two new issues: dropping file permissions during atomic staging, and accidentally discarding the output of the translator. These must be corrected before implementation.

## 2. What it gets right
- **Transaction mechanics:** `06.1` and `06.2` beautifully implement the two-phase `PreparedInstall` boundary. The atomic swap and the refusal on uncovered files (`uncoveredExistingFiles`) are exactly as requested.
- **`skillDir()` correctly extracted:** `03.4` isolates the directory-path logic perfectly, and `06.1` consumes it correctly, closing the headline transaction-breaking bug from round 001.
- **Rollback truthfulness:** The new `manual-recovery-required` outcome in `06.2` correctly distinguishes between a genuine rollback and an unregistered-but-live state.
- **Assistant Provenance:** `05.2` cleanly removes `fromAssistant`, and the call sites in `06.1` map to the new signature perfectly.

## 3. Blocking findings

- **B1 (tasks/02-domain-and-registry/02.3-hardening.md, Step 6)**: The task explicitly instructs the developer to keep `Source` in its existing shape in the manifest ("its projectPath/localPath fields being absolute in some cases is a known follow-up... note it in your report rather than solving it"). This directly contradicts Summary Decision 9, which locked in that "the persisted `DesiredSource` used in the manifest omits or workspace-relativizes anything absolute." The manifest split was meant to fix portability now, not punt it.
- **B2 (tasks/06-install-engine/06.2-apply-and-verify.md, Step 2.4)**: The staging step instructs writing `prepared.content.files` into a temporary directory but omits restoring the `mode` via `fs.chmod`. Because `applyInstall` bypasses the adapter's `writeSkill` (which `03.4` step 5 explicitly updated to restore `mode`), the executable bits introduced in `03.4` will be lost during the atomic swap.
- **B3 (tasks/06-install-engine/06.1-plan-and-preview.md, Step 2)**: The implementation instructs: "Store the exact `CanonicalSkill` this call was given as `PreparedInstall.content`". By storing the input provided to `translateSkill` instead of the returned `TranslationResult.value`, `planInstall` silently discards any translation that occurred, ensuring the unadapted skill is written to disk.

## 4. Important non-blocking findings

- **I1**: `06.1` step 1 adds `sourceRevision?: ResolvedRevision` to `InstallPlan`, but step 2 (Implementation) doesn't explicitly instruct how to populate it (it should be copied from `pkg.version`). It is only implied in step 3 when formatting the preview message.
- **I2**: `07.2` step 3 instructs to prompt for `conflictPolicy` but doesn't explicitly mention aborting the installation if the user dismisses the quick pick (returning `undefined`).
- **I3**: `06.2` step 2.9 instructs the developer to "compute `contentHash` (reuse `06.1`'s scheme)". This is redundant and risks a mismatch, as `PreparedInstall` already contains the `contentHash` computed by `06.1`. It should simply use `prepared.contentHash`.

## 5. Task-by-task recommendations

- **02.3**: Update Step 6 to define and use `DesiredSource` (omitting absolute paths) inside `ManifestFile.sources`, rather than reusing the runtime `Source` shape, fulfilling Decision 9.
- **03.4**: Good as written.
- **04.3**: Good as written.
- **05.2**: Good as written.
- **06.1**: Change Step 2 to explicitly populate `sourceRevision` from `pkg.version`, and change "Store the exact CanonicalSkill this call was given" to "Store `value` from the `TranslationResult`".
- **06.2**: Add `fs.chmod` to Step 2.4 for `content.files` when a mode is present. Update Step 2.9 to reuse `prepared.contentHash` rather than recomputing it.
- **07.1**: Good as written.
- **07.2**: Explicitly state in Step 3 that the flow must abort if the `conflictPolicy` quick pick is dismissed.

## 6. Final verdict
proceed with changes
