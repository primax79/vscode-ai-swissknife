# 06 — Install engine (pipeline) — Implementation plan

> **Derived from spec:** [../specs/foundations.md](../../specs/foundations.md)

**Revised 2026-08-18** (second Codex review, `../_inbox/analyzed/
codex-analysis-2.md` finding B4, and B1/B2/B3 from the initiatives this
one depends on): both tasks below were rewritten before any code existed
for them, to depend on the hardened contracts from 02.3/03.4/04.3/05.2
instead of the original, incomplete ones. No history to preserve — treat
`06.1-plan-and-preview.md`/`06.2-apply-and-verify.md` as the only version
that ever existed for delegation purposes.

Tasks (each = one commit; hand one file at a time to a delegated agent):

## Tasks

## Shared decisions

Shared decisions for this initiative that every task must honour:

- The pipeline is `resolve → plan → preview → apply → verify` (SPEC.md
  §2.4) — `resolve` is initiative 04's resolvers (`Package[]`/
  `Artifact[]`) plus 02.3's `resolveArtifactContent` (metadata →
  real content); this initiative starts from an already-resolved
  `Package`+`Artifact` and fetches content itself via that function.
- `plan` must be a pure function with no side effects — read-only
  existence/hash checks only, never a write. This is what makes
  `preview` possible before `apply` touches anything.
- `apply` is a **staged directory transaction** (stage → verify staged →
  swap atomically → verify final → persist state → clean up backup),
  not a direct call to the adapter's write method — see `06.2` for the
  exact sequence and failure handling. A failed verification must never
  result in a recorded `ManagedInstallation`.
- `apply` writes to the **state file** (02.3's `writeState`), never the
  manifest — installations are machine-local.
- `PreparedInstall` is discriminated: unsupported plans contain no dummy
  payload. Supported plans carry `TranslationResult.value` plus one shared
  canonical hash. Apply verifies that hash and the complete target-tree
  snapshot before mutation, preserves file modes while staging, and reports
  manual recovery whenever restoration cannot be proven.
- Only `artifact.kind === 'skill'` is actually supported end-to-end in
  this Phase (rule is deferred, `tasks/CONTEXT.md`) — `plan`/`apply` must
  say so explicitly (`supported: false` / `{status: 'refused'}`) for
  anything else, not silently no-op or throw.
- This initiative depends on 03 (adapters, hardened by 03.4), 04
  (resolvers, hardened by 04.3), 05 (translator, hardened by 05.2), and
  02.3 (resolved-artifact + state/manifest split) — it's the first
  initiative that wires all of them together, which is exactly why the
  second review flagged it as the point where incomplete contracts
  upstream become expensive to discover.

## Closed

### 06.1 - Plan + preview (revised)

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Install plan and preview · **Size:** M · **Depends on:** 02.3, 03.4, 04.3, 05.2 · **Spec:** [06.1-plan-and-preview.md](06.1-plan-and-preview.md)
- **Goal:** Resolve real skill content, translate it for the target assistant, compute a conflict/file preview against a validated target directory, and return a discriminated `PreparedInstall`.

### 06.2 - Transactional apply + verify (revised)

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Transactional apply and verify · **Size:** M · **Depends on:** 06.1 · **Spec:** [06.2-apply-and-verify.md](06.2-apply-and-verify.md)
- **Goal:** Apply a `PreparedInstall` via a staged directory swap with target-tree snapshot revalidation, post-swap verification, rollback recovery outcomes, and `state.json` persistence.
