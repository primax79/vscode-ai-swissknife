# 22 — Project-scoped recommended installations — Implementation plan

> **Derived from spec:** [`../specs/project-recommendations.md`](../../specs/project-recommendations.md)
> **Revised 2026-09-07** after an independent Codex review found a circular
> dependency between the original 22.3/22.4 ordering and an unsafe
> auto-resolve-on-open design — see the spec's "Reviewed by" note and each
> task's own callouts.

Tasks (each = one commit):

## Tasks

## Task order and gating

- **22.2 gates 22.3 and 22.4** — both call into the same resolution
  function, so it must be implemented and tested first.
- **22.3 gates 22.4** — 22.4's `Review` action and its `Install All` action
  both reuse 22.3's Recommended filter and install-runner respectively; the
  original draft had this backwards (22.4's "Review" needing a filter that
  a later-ordered 22.3 hadn't built yet) and has been corrected.
- **22.1 is independent of 22.2-22.4** (it only writes/decorates
  `desiredInstallations`; resolution reads it) and **22.5 is independent of
  all four** (centralized in `writeManifest`, not in any UI handler) — both
  could ship in parallel with the others, but are listed in reading order
  for a single agent working through the initiative sequentially.

## Closed

### 22.1 - Recommend/unrecommend commands + tree decoration

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Recommend and unrecommend commands · **Size:** S · **Depends on:** 02, 07 · **Spec:** [22.1-recommend-commands.md](22.1-recommend-commands.md)
- **Goal:** Add context-menu actions on Available and Installed items to write or remove `DesiredInstallation` entries in the project manifest with a Recommended decoration and dual-view refresh.

### 22.2 - Recommendation resolution engine

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Recommendation resolution engine · **Size:** M · **Depends on:** 02, 06 · **Spec:** [22.2-resolution-engine.md](22.2-resolution-engine.md)
- **Goal:** Implement pure `resolveRecommendations` in `src/engine/recommendations.ts` classifying `desiredInstallations` against `state.json` and source resolution attempts into `satisfied`, `pending`, and `broken`.

### 22.3 - "Install Recommended" command + Available-view "Recommended" filter

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Install Recommended and tree group · **Size:** M · **Depends on:** 22.2 · **Spec:** [22.3-install-recommended.md](22.3-install-recommended.md)
- **Goal:** Add the `aiSwissknife.installRecommended` command and the `Recommended` grouping in `AvailableTreeDataProvider` using per-entry target assistant/scope installation.

### 22.4 - Workspace-open detection + notification

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Workspace-open recommendation prompt · **Size:** S · **Depends on:** 22.2, 22.3 · **Spec:** [22.4-open-prompt.md](22.4-open-prompt.md)
- **Goal:** Wire a local-only unsatisfied-recommendations check on activation offering `Install All`, `Review`, and `Don't ask again for this workspace`.

### 22.5 - Git hygiene for the shared manifest

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Project state.json gitignore hygiene · **Size:** XS · **Depends on:** 02 · **Spec:** [22.5-gitignore-hygiene.md](22.5-gitignore-hygiene.md)
- **Goal:** Ensure `writeManifest` at project scope non-destructively appends the project `state.json` path to an existing `.gitignore`.
