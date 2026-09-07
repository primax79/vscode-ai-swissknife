# 22 — Project-scoped recommended installations — Implementation plan

> **Derived from spec:** [`../specs/project-recommendations.md`](../specs/project-recommendations.md)
> **Revised 2026-09-07** after an independent Codex review found a circular
> dependency between the original 22.3/22.4 ordering and an unsafe
> auto-resolve-on-open design — see the spec's "Reviewed by" note and each
> task's own callouts.

Tasks (each = one commit):

1. **[22.1 — Recommend/unrecommend commands + tree decoration](22.1-recommend-commands.md)**: write/remove a `DesiredInstallation` from the project manifest via context-menu actions on Available and Installed items (prompting for an assistant when recommending from Available, since `AvailableArtifactItem` doesn't carry one), with a distinct "Recommended" decoration and dual-view refresh.
2. **[22.2 — Recommendation resolution engine](22.2-resolution-engine.md)**: pure `src/engine/` function diffing `desiredInstallations` against `state.json` and a map of per-source resolution *attempts* into `satisfied` / `pending` / `broken` (three distinct broken reasons), with unit tests and fixtures — no VS Code API.
3. **[22.3 — "Install Recommended" command + Available-view "Recommended" filter](22.3-install-recommended.md)**: always-available command that resolves sources on demand, runs 22.2, previews, and installs via a small shared install-runner (not `installBatch`, which prompts once for a whole-batch assistant/scope) — plus the "Recommended" grouping in the Available view.
4. **[22.4 — Workspace-open detection + notification](22.4-open-prompt.md)**: wire a **local-only** (no network) unsatisfied-count check into `extension.ts` activation (non-blocking, explicit `.catch()`), with `Install All` / `Review` / `Don't ask again for this workspace` actions reusing 22.3's resolve-and-install path and Recommended filter, and `workspaceState`-backed dismissal.
5. **[22.5 — Git hygiene for the shared manifest](22.5-gitignore-hygiene.md)**: centralized inside `writeManifest` itself — append-if-missing `.gitignore` entry for the project `state.json` path on every project-scope manifest write, non-destructive, skipped if no `.gitignore` exists. Independent of 22.1-22.4.

**Task order and gating:**

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
