---
target: tasks/02-domain-and-registry/02.3-hardening.md, tasks/03-claude-kilo-adapters/03.4-hardening.md, tasks/04-source-resolver/04.3-hardening.md, tasks/05-translator-skill/05.2-hardening.md, tasks/06-install-engine/06.1-plan-and-preview.md, tasks/06-install-engine/06.2-apply-and-verify.md, tasks/07-minimal-ui/07.1-sources-view.md, tasks/07-minimal-ui/07.2-available-view.md
date: 2026-08-18
commit: 7e123afa040a3f59262f1793a113a7cd1e3a73b4
engine: kilo-gemini-3.7-flash
model: google/gemini-3.7-flash
verdict: proceed with changes
---

# Review: hardening gate round 002 — kilo-gemini-3.7-flash

## 1. Executive assessment

The task specifications across initiatives 02 through 07 have substantially matured following the round 001 multi-engine review. The architecture cleanly converges on atomic staging, honest transactional outcomes, and strict separation between shareable manifest state and machine-local state.

However, the rewrite introduced three concrete blocking inconsistencies:
1. `06.1`'s step 2 text explicitly instructs `planInstall` to store the translator's *input* (`content`) rather than its *output* (`TranslationResult.value`) inside `PreparedInstall.content`, contradicting line 57's comment and discarding any translation/normalization changes.
2. `06.2`'s staging procedure (step 2.4) writes `prepared.content.files` into the staging directory without setting file permissions (`mode`), meaning file executable permissions (e.g. `scripts/run.sh`) are lost upon atomic swap.
3. `05.2` keeps `translateSkill`'s second parameter typed as `SupportedAssistant` (`'claude-code' | 'kilo-code'`), while `06.1` passes `targetAdapter.assistant` (typed `AssistantId` with 5 union members), which will fail TypeScript typechecking (`tsc`).

Once these three blocking issues and minor discrepancies are adjusted, the task specifications will be solid and safe for delegation.

---

## 2. What it gets right

The rewritten task specs accurately integrate almost all 12 locked-in decisions from `tasks/_reviews/001-hardening-gate-SUMMARY.md`:

- **Decision 1 (`Adapter.skillDir`)**: Correctly defined in `03.4` (step 4) and rigorously used as `targetDir` in `06.1` (`Adapter.skillDir(name, loc)`), preventing the directory-swap collision on `SKILL.md`.
- **Decision 2 (`PreparedInstall` pipeline)**: Correctly models `PreparedInstall { plan: InstallPlan; content: CanonicalSkill; contentHash: string }` in `06.1`, with `InstallPlan` carrying `sourceId` and `packageId`. `06.2` and `07.2` both accept and thread the whole `PreparedInstall` intact.
- **Decision 3 (`sourceRevision` persistence)**: Added `sourceRevision?: ResolvedRevision` to `ManagedInstallation` in `02.3` alongside `Package.version`, referenced in `06.1`, persisted in `06.2`, and exposed in `07.3`.
- **Decision 4 (Drop `sourceAssistant`)**: Eliminated unresolvable `sourceAssistant`/`fromAssistant` across `05.2` and `06.1`.
- **Decision 5 (`planInstall` resolver dispatch)**: `planInstall` accepts `source: Source` in `06.1` and dispatches cleanly based on `source.type` (`local-folder` vs `git-custom`).
- **Decision 6 (Git TOCTOU checkout by commit)**: `02.3` step 4 mandates `git checkout <commit>` during `resolveArtifactContent` before reading content in `gitCustom.ts`.
- **Decision 7 (Refuse overwrite on uncovered files)**: `06.1` populates `uncoveredExistingFiles: string[]` and `06.2` step 2.1 refuses overwrite up front when uncovered files exist, eliminating the data-loss risk.
- **Decision 8 (`manual-recovery-required` outcome)**: `06.2` step 1 and step 2.10 honestly distinguish failed registry state writes from rollbacks. Verification failure on create cleans up `targetDir`.
- **Decision 9 (Shareable manifest intent)**: `02.3` step 6 introduces `DesiredInstallation` on `ManifestFile` without absolute paths, timestamps, or hashes.
- **Decision 10 (`parseSkillMarkdown` files contract)**: `03.4` step 2 explicitly dictates that `parseSkillMarkdown` only parses frontmatter/body and always returns `files: []`, delegating directory traversal to `readSkill`/`resolveArtifactContent`.
- **Decision 11 (Strict frontmatter validation)**: `03.4` step 6 and `04.3` step 3 specify errors and test fixtures for missing required frontmatter instead of falling back to the directory basename.
- **Decision 12 (Modal confirmation dialog)**: `07.2` step 3 specifies `showInformationMessage(..., { modal: true }, 'Install', 'Cancel')` gating installation.

---

## 3. Blocking findings

### B1: `06.1` `planInstall` specifies storing the translator's INPUT instead of OUTPUT as `PreparedInstall.content`
- **Location**: `tasks/06-install-engine/06.1-plan-and-preview.md`, lines 101–105 vs line 57
- **Detail**:
  - In `06.1` line 57, the `PreparedInstall` type definition specifies:
    ```ts
    content: CanonicalSkill; // the exact translated content the plan's diagnostics were computed from — applyInstall receives this unchanged, never a separately-supplied value
    ```
  - However, in `06.1` lines 101–105 (step 2 implementation):
    > "Call `translateSkill(content, targetAdapter.assistant)` (05.2's revised two-argument signature — no `fromAssistant`) to get `diagnostics`/`overall`. Store the exact `CanonicalSkill` this call was given as `PreparedInstall.content` — this is the value `applyInstall` will receive back unchanged."
  - **Impact**: Telling the implementer to store the `CanonicalSkill` *given* to `translateSkill` stores the pre-translation input. If `translateSkill` performs any translation, normalization, or constraint adaptations (returning `result.value`), those changes are discarded, and `applyInstall` writes untranslated content.
  - **Correction**: `planInstall` must store `translationResult.value` (the translator's output) as `PreparedInstall.content`.

### B2: `06.2` staging step fails to preserve file permissions (`mode`) on staged files
- **Location**: `tasks/06-install-engine/06.2-apply-and-verify.md`, lines 70–75 (Step 2.4)
- **Detail**:
  - Step 2.4 states:
    > "4. **Stage**: write every `PlannedFile` (`SKILL.md` via `serializeSkillMarkdown`, plus `prepared.content.files`) into a sibling temporary directory next to `prepared.plan.targetDir` (e.g. `<parent>/.ai-swissknife-staging-<random>/`), validating each path again with `validateRelativeFilePath` (03.4) as defense in depth."
  - In `03.4` step 5, `writeSkill` is instructed to restore `mode` via `fs.chmod` when `file.mode` is present.
  - Because `06.2` bypasses `adapter.writeSkill` during staging (writing directly to a temp folder and renaming it into place at step 2.7), omitting permission handling in step 2.4 means executable bits on scripts (e.g., `scripts/run.sh` with `mode: 0o755`) are not applied to the staged files and will be lost in the installed skill.
  - **Correction**: Explicitly instruct step 2.4 in `06.2` to restore `file.mode` (e.g., via `fs.chmod` or passing `mode` in `fs.writeFile`) when writing each entry of `prepared.content.files`.

### B3: Type mismatch between `SupportedAssistant` in `translateSkill` and `targetAdapter.assistant` (`AssistantId`)
- **Location**: `tasks/05-translator-skill/05.2-hardening.md` (lines 28–35) vs `tasks/06-install-engine/06.1-plan-and-preview.md` (line 101) & `src/adapters/types.ts` (line 20)
- **Detail**:
  - `05.2` defines:
    ```ts
    translateSkill(source: CanonicalSkill, toAssistant: SupportedAssistant): TranslationResult<CanonicalSkill>
    ```
    where `SupportedAssistant = 'claude-code' | 'kilo-code'`.
  - In `src/adapters/types.ts`, `Adapter.assistant` is typed as `AssistantId` (`'claude-code' | 'kilo-code' | 'github-copilot' | 'codex-cli' | 'gemini-cli'`).
  - In `06.1` step 2:
    `Call translateSkill(content, targetAdapter.assistant)`
  - Passing `targetAdapter.assistant` (type `AssistantId`) directly to `translateSkill` (which requires `SupportedAssistant`) will fail TypeScript compilation (`Argument of type 'AssistantId' is not assignable to parameter of type 'SupportedAssistant'`).
  - **Correction**: Change `translateSkill`'s second parameter to `toAssistant: AssistantId` in `05.2`. If an `AssistantId` is passed that is not currently supported for conversion, `translateSkill` should return `{ overall: 'unsupported', diagnostics: [...], value: source }` rather than failing at compile-time.

---

## 4. Important non-blocking findings

### I1: Manifest field naming and deferred `DesiredSource` in `02.3`
- **Location**: `tasks/02-domain-and-registry/02.3-hardening.md`, lines 144–154 vs `001-hardening-gate-SUMMARY.md` Decision 9
- **Detail**:
  - In `001-hardening-gate-SUMMARY.md` Decision 9, it stated:
    > "`ManifestFile` gains a `desiredInstallations` field... the persisted `DesiredSource` used in the manifest omits or workspace-relativizes anything absolute."
  - In `02.3-hardening.md` step 6:
    1. The field on `ManifestFile` is named `installations: DesiredInstallation[]` (not `desiredInstallations`).
    2. `ManifestFile` continues to use `sources: Source[]` where `Source` still contains absolute paths (`projectPath?: string`, `localPath?: string`), and `02.3` explicitly notes: "`Source` itself keeps its existing shape for now (its `projectPath`/`localPath` fields being absolute in some cases is a known follow-up, not blocking for Phase 1 — note it in your report rather than solving it in this task)."
  - **Recommendation**: This is acceptable for Phase 1 as long as the naming (`ManifestFile.installations`) is consistently followed across `02.3` and `07.1`.

### I2: Cache-directory mutex in `gitCustom.ts` should cover `resolveArtifactContent`
- **Location**: `tasks/04-source-resolver/04.3-hardening.md` (lines 35–44) vs `tasks/02-domain-and-registry/02.3-hardening.md` (lines 96–105)
- **Detail**:
  - `04.3` Step 2 adds an in-process mutex to `gitCustom.ts` to serialize concurrent `resolveGitCustom` calls.
  - In `02.3` Step 4, `resolveArtifactContent` also runs `git checkout <commit>` in the same shared cache directory.
  - If a catalog refresh (`resolveGitCustom`) and an install plan (`resolveArtifactContent`) run concurrently against the same source, they will race on the shared working directory.
  - **Recommendation**: Ensure the per-cache-dir mutex in `gitCustom.ts` wraps all git operations in that cache directory, including `resolveArtifactContent`.

### I3: Handling cleanup failure during rollback of a fresh install in `06.2`
- **Location**: `tasks/06-install-engine/06.2-apply-and-verify.md`, lines 96–98 (Step 2.8)
- **Detail**:
  - On post-swap verification failure for a fresh install (where no backup existed), step 2.8 specifies removing `targetDir` and returning `{ status: 'rolled-back', reason }`.
  - If removing `targetDir` throws an error (e.g. `fs.rm` permission failure), unverified files remain on disk. Returning `'rolled-back'` in that case would be inaccurate.
  - **Recommendation**: If `fs.rm(targetDir)` fails during fresh install cleanup, return `{ status: 'manual-recovery-required', reason }`.

### I4: Dummy content structure for unsupported artifact kinds in `06.1`
- **Location**: `tasks/06-install-engine/06.1-plan-and-preview.md`, lines 87–92
- **Detail**:
  - `06.1` states that when `artifact.kind !== 'skill'`, `planInstall` returns `plan.supported: false` and `content`/`contentHash` can be dummy/empty values.
  - To prevent runtime `null` dereferences or type assertion errors in callers, specify a concrete dummy `CanonicalSkill` return value (e.g. `{ name: artifact.name, description: '', body: '', extraFields: {}, files: [] }` and `contentHash: ''`).

---

## 5. Task-by-task recommendations

### `tasks/02-domain-and-registry/02.3-hardening.md`
- **Status**: Ready to proceed.
- **Notes**: Ensure tests verify `ResolvedRevision` round-tripping and the TOCTOU re-checkout in `gitCustom.ts`. Maintain consistency on `ManifestFile.installations`.

### `tasks/03-claude-kilo-adapters/03.4-hardening.md`
- **Status**: Ready to proceed.
- **Notes**: Correctly adds `skillDir()` and directory payload to `CanonicalSkill`. Clarify that `writeSkill` and staging in 06.2 both preserve `file.mode`.

### `tasks/04-source-resolver/04.3-hardening.md`
- **Status**: Ready to proceed.
- **Notes**: Ensure the cache mutex covers both `resolveGitCustom` and `resolveArtifactContent` (I2).

### `tasks/05-translator-skill/05.2-hardening.md`
- **Status**: Needs minor edit (B3).
- **Recommendation**: Widen `translateSkill`'s second parameter to `toAssistant: AssistantId`.

### `tasks/06-install-engine/06.1-plan-and-preview.md`
- **Status**: Needs minor edit (B1).
- **Recommendation**: Update step 2 (line 103) to store `translationResult.value` as `PreparedInstall.content`. Provide explicit dummy return for unsupported kinds (I4).

### `tasks/06-install-engine/06.2-apply-and-verify.md`
- **Status**: Needs minor edit (B2).
- **Recommendation**: Update step 2.4 to explicitly set file `mode` (executable permissions) when writing staged files. Handle cleanup failures in step 2.8 (I3).

### `tasks/07-minimal-ui/07.1-sources-view.md`
- **Status**: Ready to proceed.
- **Notes**: Icon placeholder and manifest reading are well-specified.

### `tasks/07-minimal-ui/07.2-available-view.md`
- **Status**: Ready to proceed.
- **Notes**: Modal approval dialog and threading of `PreparedInstall` to `applyInstall` are clearly and correctly specified.

---

## 6. Final verdict

**Verdict**: **proceed with changes**

The task suite is in great shape and closely converges on the round 001 design decisions. Applying the three quick targeted corrections (B1: storing translated output in `PreparedInstall.content`, B2: applying `mode` during 06.2 staging, and B3: accepting `AssistantId` in `translateSkill`) will resolve all remaining ambiguities before implementation begins.
