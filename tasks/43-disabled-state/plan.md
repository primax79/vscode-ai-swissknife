# 43 — Disabled state for installed items — Implementation plan

> Source: `specs/disabled-state-study.md`; owner decisions 2026-10-08: **D-Q1 a** layout A (`_disabled/<kind>/<name>` as a *sibling* of the scanned dir under each assistant root; fallback B `.ai-swissknife/_disabled/<assistant>/<kind>/<name>` for any assistant the spike shows to scan the sibling), **D-Q2 a** first iteration only skill / agent / command, **D-Q3 a** disabled items stay visible in the Dashboard, muted, with a "Disabled" filter pill and an Enable action, **D-Q4 a** the partial "manual only" mode (`disable-model-invocation`) is out of scope.
> The spike (43.1) gates everything else, as 19.1 and 21.1 did. Tasks 43.2-43.4 are **outlines**: they are specified in full after 43.1 reports, because the layout depends on its findings.

**Depends on:** 40.1 (place model, for the `disabled` state), 40.2 (rows), 42.3 (action placement). The spike and the engine tasks do not depend on the UI work.

## Locked-in decisions

- **Claude plugins are out of this initiative** (owner, 2026-10-08, initiative 45): they have a native disable (`claude plugin disable`), so no `_disabled` folder is used for them.

- Disable and enable are a single `rename` (move, never copy); enable returns the item to the exact original path; nothing is overwritten on enable (name collision -> ask).
- User-facing vocabulary: states "Disabled" / "Enabled"; scope "Workspace" / "Global" (CONTEXT.md).
- Managed items keep their record: state gets a `disabled` flag and the updated `path` (state `schemaVersion` bump + migration); unmanaged items are self-described by the folder layout.
- Discovery/inventory must scan the disabled locations; a disabled path must never be reported as `missing-on-disk`.

## Tasks

| Task | Title | Depends on | Size | Executor |
| --- | --- | --- | --- | --- |
| [43.1](43.1-discovery-spike.md) | **Spike**: verify per assistant that `_disabled/` as a sibling is not loaded | - | S | self; **done 2026-10-09: Kilo verified (layout A works), Claude unverified, others untested** (`notes/43.1-findings.md`) |
| [43.2](43.2-engine-disable-enable.md) | Engine: `disableItem` / `enableItem` for file kinds + state flag + migration (outline below) | 43.1 | M | delegated |
| [43.3](43.3-inventory-disabled.md) | Inventory: scan disabled locations, `disabled` place state, no false `missing-on-disk` (outline) | 43.2, 40.1 | M | delegated |
| 43.4 | UI: Disable/Enable action (context menu + detail bar), muted badge, "Disabled" filter pill (outline) | 43.2, 43.3, 40.2, 42.3 | M | delegated |

### Outlines (to be turned into full task files after 43.1)

- **43.2** `src/engine/disable.ts`: `planDisable/applyDisable(place)` and `applyEnable(place)`; target path per adapter via a new `getDisabledPath(kind, name, scope)` on the adapter interface (layout A by default, B where 43.1 says so); rename with rollback if the state write fails; collision prompt data returned to the caller; state `disabled: true` + `path`; migration of old state files (no flag = enabled).
- **43.3** scan `<root>/_disabled/<kind>/*` per assistant and scope; observed items found there become places with state `disabled` (unmanaged) or are matched to their record (managed); drift ignores disabled paths; update on a disabled managed item updates in place and stays disabled.
- **43.4** one toggle action `Disable` / `Enable` (icon `$(circle-slash)` / `$(play)`), in the context menu and detail bar (42.3 rules), muted/strikethrough rendering of disabled rows with the usual icons, "Disabled" pill in the Membership-style filter bar (40.5), Install-elsewhere and counts treat a disabled place as present.
