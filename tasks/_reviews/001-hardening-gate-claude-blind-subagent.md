---
target: tasks/02-domain-and-registry/02.3-hardening.md, tasks/03-claude-kilo-adapters/03.4-hardening.md, tasks/04-source-resolver/04.3-hardening.md, tasks/05-translator-skill/05.2-hardening.md, tasks/06-install-engine/06.1-plan-and-preview.md, tasks/06-install-engine/06.2-apply-and-verify.md, tasks/07-minimal-ui/07.1-sources-view.md, tasks/07-minimal-ui/07.2-available-view.md, tasks/07-minimal-ui/07.3-installed-view.md
date: 2026-08-18
commit: b4e7f92aeca3c9b36a33f5bc53bcc6c12e7481f6
engine: claude-blind-subagent
model: inherited session model, zero conversational context of authoring
verdict: stop and correct 06.1/06.2/07.2; the other 6 files are safe to delegate now or as soon as their one dependency lands
---

# Review: hardening gate (pre-delegation) — claude-blind-subagent

Independent, context-blind pass — this subagent had no memory of having
authored (or seen anyone author) the reviewed files; it was pointed only
at the repo, with no reference to prior review documents.

## Executive assessment

SPEC.md §7's six gaps (content-fetch, multi-file skill payload, registry
manifest/state conflation, non-atomic apply, unvalidated paths,
overclaimed YAML verbatim-ness) map onto the four hardening tasks
(02.3/03.4/04.3/05.2) essentially one-to-one, and each is internally
well-scoped, testable, and correctly grounded in the real files it
edits. The problem is one layer up: 06.1/06.2 (install engine) and
07.1-07.3 (UI) — the initiatives the gate exists to protect — were
rewritten to consume the hardened contracts, but introduce several
**new** gaps of the same character: a plan object that can't carry
enough provenance to build the `ManagedInstallation` record it's
supposed to produce, a directory/file-path ambiguity that directly
threatens the atomic-swap step, a resolver-dispatch step assuming
information the domain model doesn't expose, and a required
`CanonicalSkill.files` field the codec function introduced in the same
task can't populate.

## What it gets right

The four hardening tasks correctly target real, cited code (none invent
functions/types that don't exist); cross-task sequencing awareness is
unusually good (03.4/04.3/05.2 each explicitly reference what the others
need to avoid duplicating work); defensive API shapes over exceptions
(`supported: false`, tagged `ApplyOutcome` union); concrete, adversarial
test requirements spelled out in the task text itself (path-traversal,
real `fs.symlink`, byte-level "plan never writes" checks); explicit
self-aware caveats instead of guessing (07.1's icon-schema verification
request); the manifest/state rename is threaded through consistently
across every dependent task.

## Blocking findings

- **B1 — `InstallPlan.targetRootPath` conflates the skill's directory
  with the `SKILL.md` file, and `06.2`'s atomic rename depends on it
  being a directory.** `06.1` computes `targetRootPath =
  targetAdapter.skillPath(...)`, but `ClaudeAdapter.skillPath`/
  `KiloAdapter.skillPath` (`src/adapters/claude.ts:162-173`,
  `src/adapters/kilo.ts:13-24`) return the path to the **file**
  `.../skills/<name>/SKILL.md`. `06.2` step 6 then `fs.rename()`s the
  staged directory into `plan.targetRootPath` — renaming a directory
  onto what the real adapter defines as a file path. Fix:
  `targetRootPath = path.dirname(targetAdapter.skillPath(...))`, or a
  dedicated `skillDir()` method.
- **B2 — `InstallPlan` has no `sourceId`/`packageId`, but `06.2` step 8
  requires them.** `InstallPlan` carries only `artifactId` (+
  `sourceRevision`); `Package.sourceId`/`Artifact.packageId` exist and
  are available inside `planInstall` (which receives `pkg`/`artifact`)
  but are dropped when `InstallPlan` is built.
- **B3 — `ManagedInstallation` has no `sourceRevision` field, but
  `06.2` and `07.3` both assume one.** No task instructs adding it.
- **B4 — `planInstall`'s `sourceAssistant: AssistantId` is type-
  incompatible with `translateSkill` and has no defined provenance.**
  `translateSkill`'s parameters are typed `SupportedAssistant =
  'claude-code' | 'kilo-code'` (`src/translator/skill.ts:28-32`), a
  strict subset of `AssistantId` (which also includes
  `github-copilot`/`codex-cli`/`gemini-cli`) — passing an
  `AssistantId`-typed value fails `tsc`. Separately: `git-custom`/
  `local-folder` resolvers produce `nativeFormat: 'skill-md'`
  (assistant-agnostic) — no field anywhere records which assistant an
  artifact "came from," and neither `06.1` nor its caller `07.2` says
  what to pass.
- **B5 — `planInstall` has no way to know which resolver's
  `resolveArtifactContent` to call.** `02.3` defines separate
  implementations in `localFolder.ts` and `gitCustom.ts`; `Package`/
  `Artifact` carry only `sourceId: string`, not the originating
  `Source`'s `type`; `planInstall`'s signature has no `Source` parameter
  and no registry-lookup context.
- **B6 — content hand-off between `planInstall` and `applyInstall` is
  unwired.** `applyInstall` requires a separate `content: CanonicalSkill`
  parameter; `InstallPlan` doesn't expose the `CanonicalSkill` resolved
  internally during planning. `07.2` never describes retrieving/
  threading a `content` value between the two calls. A milder recurrence
  of the exact "unknown content" problem `06.1`'s own preamble claims to
  close.
- **B7 — `parseSkillMarkdown(raw: string): CanonicalSkill` (03.4 step 2)
  structurally cannot satisfy the mandatory `CanonicalSkill.files:
  ArtifactFile[]` field the same task adds in step 4.** The function
  only ever sees `SKILL.md` text, never a directory, so it can't walk
  the skill's directory to populate `files`. The task never says whether
  `parseSkillMarkdown` defaults `files: []` (leaving directory-walking to
  a different function layered on top) or whether its signature must
  change — left unstated, this is exactly the kind of gap that produces
  a plausible implementation that quietly always returns `files: []`.

## Important non-blocking findings

- **I1** — hash algorithm for `existingContentHash`/`contentHash` is
  never named (SHA-256 via Node `crypto` is the obvious choice, but
  should be pinned so independently-computed hashes are comparable).
- **I2** — `06.2` step 7's post-swap verification compares `content`
  against `readSkill`'s return; `files: ArtifactFile[]` array order
  isn't guaranteed to match between write and read
  (`fs.readdir` order is filesystem-dependent) — a naive array-order
  comparison risks spurious rollback on the happy path. Compare as a
  map keyed by `relativePath`, not by array order.
- **I3** — `07.2` needs to map a user-chosen target-assistant string to
  a concrete `Adapter` instance; no task states this lookup exists or
  where it lives.
- **I4** — `readManifest`/`readState` throwing on a `schemaVersion`
  mismatch (02.3) has no described handling in any UI task — can't
  happen yet in Phase 1, but worth a one-line note so a tree provider
  doesn't crash silently once it can.
- **I5** — `06.1`'s code block imports `ConversionDiagnostic` from
  `'../adapters/types'`, but the type is defined in
  `src/domain/types.ts`; neither `03.4` nor `05.2` instructs adding a
  re-export. As literally written, this import won't compile.
- **I6** — leftover backup directories from a failed `06.2` apply
  (`.ai-swissknife-backup-<random>`) sit inside the target's own skills
  folder; `04.3`'s loosened dot-dir-skip rule (only skip `.git`) means
  such a stray directory would no longer be auto-ignored if that folder
  were ever itself scanned as a source root — low probability, but the
  two tasks' changes interact in a way neither mentions.

## Task-by-task recommendations

- **02.3** — safe to delegate now, plus one addition: add
  `sourceRevision?: ResolvedRevision` to `ManagedInstallation` while
  already touching `domain/types.ts` for `Package.version` (closes B3).
- **03.4** — safe to delegate after resolving B7: state explicitly that
  `parseSkillMarkdown` returns `files: []` and that directory-walking to
  populate `files` is `readSkill`'s job layered on top, not the codec
  function's.
- **04.3** — safe to delegate as-is; no blocking findings against this
  file specifically.
- **05.2** — safe to delegate as-is; correctly does not attempt to
  resolve the `sourceAssistant` provenance question (that's `06`'s gap,
  not `05`'s).
- **06.1** — do not delegate yet: needs B1 (targetRootPath→skillDir),
  B2 (add sourceId/packageId to InstallPlan), B4 (narrow
  `sourceAssistant` typing + define its provenance), B5 (pass `source:
  Source` in so the right resolver can be dispatched), B6 (return
  resolved content, or define how 06.2/07.2 obtain it), and I5.
- **06.2** — do not delegate yet; blocked on the same `InstallPlan`
  shape fixes as 06.1 (B1/B2/B3/B6), since it consumes that type
  directly.
- **07.1** — safe to delegate once 02.3 lands; appropriately flags its
  own open question (icon contribution-point shape) rather than
  guessing.
- **07.2** — do not delegate yet; depends on 06.1/06.2 being fixed
  first — it's the actual caller that exposes B4's and B6's gaps, and
  currently doesn't even mention the parameters that would need filling
  in.
- **07.3** — mostly safe, but wait until B3 is resolved (the
  `sourceRevision`-in-tooltip requirement needs the field to exist on
  `ManagedInstallation` first).

## Final verdict

Stop and correct before delegating 06.1/06.2/07.2; the other six files
(02.3, 03.4, 04.3, 05.2, 07.1, 07.3) are safe to delegate now (or as soon
as their one stated dependency lands), with the two small additions
noted above. 06.1/06.2 currently have seven concrete,
high-confidence-to-implement-wrong gaps (B1-B7), several severe enough
(B1 especially) that a delegated agent following the file literally
would produce a broken atomic-install path, not just an incomplete one.

## Method note

Dispatched as a fresh `general-purpose` subagent with zero conversational
context — pointed only at the repo files, no prior review document
referenced, per this project's "context-blind self-review counts as an
independent engine" convention.
