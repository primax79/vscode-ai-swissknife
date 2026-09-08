# Coordination note — `enabledAssistants` affects Phase 9 (initiatives 31-34)

**Date:** 2026-09-08
**For:** whoever is working Phase 9 / initiative 31 (provider action-layer
decoupling) and 32-34 (Dashboard rebuild as a superset of sidebar
capability) — `specs/phase-9-spec.md`.
**From:** the session that built Phase 8 (initiatives 29-30, adapter/source
registries + the `aiSwissknife.enabledAssistants` setting).

## What changed that affects you

Phase 8 added a real, tested user-facing feature: `aiSwissknife.enabledAssistants`,
a VS Code setting (object with one boolean per assistant id, all default
`true` — see `tasks/CONTEXT.md`'s locked-in decisions) that hides a
disabled assistant's sidebar section. `src/adapters/registry.ts` exports
`getEnabledAdapters(): Adapter[]`, the filtered list, alongside the
unfiltered `ALL_ADAPTERS`.

**Every `showQuickPick` (or future Dashboard UI) that lets the user pick a
TARGET assistant must build its option list from `getEnabledAdapters()`,
not `ALL_ADAPTERS`.** Live testing on 2026-09-08 found this had been missed
in 7 sidebar call sites (install/move/sync/recommend/unrecommend/create) —
already fixed. `tasks/CONTEXT.md`'s locked-in decisions section has the
full rule, including the short, closed list of sites that must deliberately
stay unfiltered (view registration, the enabled-context-key loop, the
`configureEnabledAssistants` command's own picker, the discovery scan
loop) — read that before building anything new that offers "which
assistant."

## Why this note exists (a real collision already happened)

While a fix for this exact bug was in flight (branched from an older
`main`), task 31.3 ("identifier-based recommendation handlers") merged and
relocated `extension.ts`'s `handleRecommendForWorkspace`/
`handleUnrecommendForWorkspace` inline `showQuickPick` logic into new
`src/ui/recommendations.ts` functions (`recommendAvailableArtifact`/
`unrecommendAvailableArtifact`) — carrying the same unfiltered-picker bug
to its new location, since the relocation predated the fix. This produced
a real merge conflict in `extension.ts`, resolved by keeping 31.3's
refactored delegation and re-applying the `getEnabledAdapters()` fix
directly at the new location in `recommendations.ts`. Already resolved,
nothing for you to do about that specific instance — but it's the concrete
proof this rule does not travel automatically with a copy/move/relocate,
and both tracks are actively touching adjacent code in `extension.ts`,
`src/ui/installedView.ts`, and `src/ui/availableView.ts` right now.

## What this means for your specs/tasks specifically

- **Initiative 32 (Dashboard skeleton) / 33 (Dashboard sources+catalog) /
  34 (Dashboard recommendations parity)**: per the Phase 9 summary in
  `tasks/00-INDEX.md`, the Dashboard is becoming a superset of sidebar
  capability, including catalog browse-and-install and the Recommendations
  surface — both of these are exactly the kind of feature that needs a
  target-assistant picker. If any of 32-34's task files already specify
  building such a picker (in a webview `<select>`, a native
  `showQuickPick`, or otherwise), add "options come from
  `getEnabledAdapters()`" to that task's spec now, before it's
  implemented — cheaper to bake in from the start than to patch after a
  live-testing report.
- If any already-written 31.x/32-34.x task file lists `ALL_ADAPTERS` as
  the source for a picker's options, update it to `getEnabledAdapters()`.
- Whenever your branch merges after ours (or vice versa) and both sides
  touched `extension.ts`/`installedView.ts`/`availableView.ts`, expect a
  conflict around this exact pattern — the resolution is always "keep
  the newer code's structure, re-apply `getEnabledAdapters()` at whatever
  the current call site actually is," not a blind pick of one side.
