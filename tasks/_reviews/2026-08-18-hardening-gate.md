---
target: tasks/02-domain-and-registry/02.3-hardening.md, tasks/03-claude-kilo-adapters/03.4-hardening.md, tasks/04-source-resolver/04.3-hardening.md, tasks/05-translator-skill/05.2-hardening.md, tasks/06-install-engine/06.1-plan-and-preview.md, tasks/06-install-engine/06.2-apply-and-verify.md, tasks/07-minimal-ui/07.1-sources-view.md, tasks/07-minimal-ui/07.2-available-view.md, tasks/07-minimal-ui/07.3-installed-view.md
date: 2026-08-18
engines: [kilo-gemini, codex, claude-blind-subagent]
status: kilo-gemini done; codex pending; claude-blind-subagent pending
---

# Review round: hardening gate (pre-delegation)

Context: none of the 9 target task files have been delegated/implemented
yet — this round happens before any execution, per
`task-spec-authoring`'s "cross-check before finalizing" step. First round
run under the old ad-hoc prompting style (each reviewer was pointed at
`tasks/_inbox/analyzed/codex-analysis-2.md` for format context) — the
prompting style itself was corrected to be self-contained
(`tasks/_reviews/FORMAT.md`) partway through this round; the two/three
requests below were already in flight when that correction landed, so
they still carry the old framing. Future rounds use `FORMAT.md` only.

## kilo-gemini (model: google/gemini-3.1-pro-preview-customtools) — verdict: further correction needed first

### Executive assessment

The hardening tasks successfully recognize and target the missing links
identified in the second Codex review. They correctly split the registry
state, introduce a robust directory payload for skills, mandate path
validation, and formalize the plan/apply staging pipeline. However, the
hardening gate does not yet safely close the gaps because it introduces
new critical contradictions at the boundary between the `Adapter`
interface and the new `InstallPlan`/`applyInstall` engine.

### What it gets right

- Registry split: 02.3 cleanly separates versionable `manifest.json` from
  machine-local `state.json`.
- Directory payloads: 03.4 correctly elevates `CanonicalSkill` from a
  single file to a full directory tree.
- Transactional safety: 06.1/06.2 formalize a robust atomic swap/rollback
  mechanism.
- Fixture portability: 04.3 fixes the test-grounding issue with a
  checked-in fixture corpus.

### Blocking findings

- **B1 — `Adapter.skillPath` returns a file, but the install engine
  treats it as a directory.** `claude.ts`'s `skillPath` returns
  `.../skills/<name>/SKILL.md` (the file). `06.1` assigns
  `targetRootPath = targetAdapter.skillPath(...)` and calls it "the
  artifact's root dir/file"; `06.2`'s atomic swap does
  `fs.rename(stagedDir, plan.targetRootPath)` — renaming a directory onto
  a file path breaks the transaction. Needs a `skillDir(name, loc)`
  method on `Adapter`, or `06.1`/`06.2` must use
  `path.dirname(targetAdapter.skillPath(...))` for directory ops.
- **B2 — Install engine staging bypasses or breaks the Adapter write
  contract.** `06.2` stages `SKILL.md`+`content.files` into a temp
  sibling directory, but `Adapter.writeSkill` only knows how to compute
  and write to the *final* destination from a `LocationRef` — it can't be
  told to write into a staging directory. Either give `writeSkill` a
  destination-path override, or push staging into the adapter itself.
- **B3 — `ManagedInstallation` has no field for the resolved commit.**
  `02.3` upgrades `Package.version` to `ResolvedRevision` and `06.2`
  persists `plan.sourceRevision` into the installation record, but
  `ManagedInstallation` only has `installedVersion?: string` — no
  `installedCommit`/`installedRevision` field exists to receive it.
- **B4 — `validateRelativeFilePath`'s absolute-path handling is
  under-specified.** `03.4` describes resolving + comparing against
  root, but doesn't explicitly call for rejecting `path.isAbsolute(candidate)`
  up front as a first-pass defense before resolving.

### Important non-blocking findings

- **I1** — `02.3`'s "schemaVersion mismatch throws" doesn't define what
  the current constant actually is (e.g. `1`).
- **I2** — `07.2`'s per-source error child node needs an explicit
  tree-item type (`ErrorNode` or similar) so `getTreeItem` doesn't have
  to guess at a `Source`/`Artifact` shape for it.
- **I3** — `07.1`'s `viewsContainers.activitybar[].icon` needs a real
  icon asset path (SVG/PNG), not a codicon string like `$(extensions)` —
  confirms `07.1`'s own flagged-but-unresolved question.

### Task-by-task recommendations

02.3: add `installedCommit`/`installedRevision`, define the
`schemaVersion` constant. 03.4: reject absolute paths explicitly in
`validateRelativeFilePath`; resolve the Adapter write-destination
question. 04.3: ready to delegate. 05.2: ready to delegate. 06.1: compute
the directory via `skillDir`/`path.dirname`, not `skillPath`. 06.2: fix
staging to not depend on an unmodified `writeSkill`. 07.1: specify a real
icon asset. 07.2: define the error-node tree-item type. 07.3: ready to
delegate.

### Final verdict

Further correction needed before delegating 02.3/03.4/06.1/06.2 — 04.3,
05.2, 07.3 were judged ready as-is.

## codex — pending

## claude-blind-subagent — pending

## Convergence

_To be filled in once codex and claude-blind-subagent land — do not
resolve/act on findings until this section is complete, per
`task-spec-authoring`: work through disagreements before finalizing, not
after acting on the first result alone._

## Resolution

_Pending convergence above._
