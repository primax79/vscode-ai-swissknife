# Task Index

Live registry of planned and in-progress development. For how this
directory works see [`AGENTS.md`](AGENTS.md); for shared project facts see
[`CONTEXT.md`](CONTEXT.md). This file is the state: what exists, priority,
status.

**2026-08-18/19 — Phase 1 completed**:
Hardening tasks 02.3, 03.4, 04.3, 05.2 and initiatives 06 (Install Engine) and 07 (Minimal UI)
have been implemented across isolated worktrees, strictly validated against all hardening contracts,
and merged into `main`. Full test suite passes 71/71 tests.

**2026-08-19 — Phase 2 opened**:
Phase 2 widens the platform to support additional artifact kinds (`agent`, `command`, `mcp-server`),
additional source types (`git-marketplace`, `remote-url`, `git-single-item`), and additional
target adapters (GitHub Copilot). See [`specs/phase-2-spec.md`](specs/phase-2-spec.md).

**2026-08-19 — Phase 4 planned**:
Initiatives 17-21 close the remaining gap against `SPEC.md`'s full scope: Form Editor Webview,
Cross-Assistant Sync, `hook` kind + active `rule` merge, `remote-url`/`git-single-item` sources,
and Codex CLI/Gemini CLI adapters. All five are specced and broken into tasks but not yet started —
see [`specs/phase-4-spec.md`](specs/phase-4-spec.md). Note: 19.1 (hook path verification) and 21.1
(Gemini agent verification) are mandatory research spikes that gate the adapter code in their own
initiatives — do not skip straight to implementation there.

**2026-09-07 — Phase 5 opened**:
Initiative 22 gives the already-existing but dead `desiredInstallations` field a real purpose:
project-scoped recommended installations modeled on VS Code's own workspace extension
recommendations (`.vscode/extensions.json`) — a curator marks artifacts as recommended, the
recommendation travels with `git clone` inside the existing shared manifest, and opening the
workspace offers to install what's missing. See [`specs/project-recommendations.md`](specs/project-recommendations.md).
Task 22.2 (resolution engine) gates 22.3 and 22.4 — do not start either until it lands.

**2026-09-07 — Phase 6 opened**:
Initiatives 23-27 overhaul the usability/information-architecture of the two UI
surfaces built across Phases 1-5: the sidebar (Sources/Available/Installed)
stays action-oriented (browse/install/promote), while the `DashboardPanel`
webview becomes the state/detail/cross-reference hub — real per-item detail
(origin, diff-vs-original, cross-framework "installed also in"), a `Move`
action alongside the existing `Copy`, a `Promote` disambiguation fix, a
rebuilt unified-table Dashboard with filters instead of structural
managed/unmanaged sections, and two new Dashboard entry points (status bar
item, per-source filtered jump). See
[`specs/phase-6-spec.md`](specs/phase-6-spec.md). Multi-engine review
(Codex + Kilo/Gemini, both rounds) complete and incorporated — accepted for
task breakdown.

**2026-09-08 — Phase 7 opened**:
Initiative 28 unifies sidebar navigation based on hands-on `.vsix` testing
feedback: `Sources` and `Available` merge into one tree (expanding a
source shows its content directly, no more hidden select-to-filter
coupling), and `Installed` gains a per-kind grouping level under each
assistant/scope group. Narrowly revisits (does not reverse) Phase 6's
sidebar/Dashboard split — see [`specs/phase-7-spec.md`](specs/phase-7-spec.md)
§0 for why. Implemented directly, no delegated tasks.

**2026-09-08 — Phase 8 opened**:
Initiatives 29-30 are an internal refactor, not new user-facing scope
(beyond 29.4/29.5's config UI): the `AssistantId → Adapter` and
`Source.type → resolver` mappings are each duplicated across the codebase
today (verbatim-duplicated functions, independent ternaries, nine copies
of the same 5-id literal array — see
[`specs/adapter-and-source-registries.md`](specs/adapter-and-source-registries.md)
§0 for the full grep-verified inventory) instead of living in one place to
iterate over. 29 enriches the existing `Adapter` interface in place (not a
new wrapping class — explicit user decision, see the spec's Locked-in
decisions) with `displayName`/`iconId`, adds a registry, migrates every
duplicated call site, and adds a native VS Code setting + command for
enabling/disabling assistants' sidebar sections. 30 does the equivalent for
`Source.type` (a new `SourceResolver` interface wrapping the five existing
resolver modules, additive). Independent of each other; both are internal
groundwork with no dependency on any earlier initiative beyond the
already-shipped adapters/sources code itself.

**2026-09-08 — Phase 9 opened**:
Direct user assessment after Phases 1-7: the sidebar (`Sources`+`Installed`)
covers almost every feature; the `DashboardPanel` webview, by comparison,
only wires 9 of the ~26 total user-triggerable actions the extension
supports (no Sources management, no catalog browse-and-install, no
Recommendations surface, no Uninstall/Update-to-latest, no create entry
point — see [`specs/phase-9-spec.md`](specs/phase-9-spec.md) §0 for the
full grep-verified inventory). This phase makes the Dashboard a superset of
sidebar capability — reusing the same engine/domain logic, organized more
comfortably/elegantly/structurally than the sidebar's tree model, in the
existing visual style — while leaving the sidebar itself untouched. Narrows
further the "Sidebar = action, Dashboard = state/detail" decision locked in
`specs/phase-6-spec.md` §3 and narrowed by `specs/phase-7-spec.md`: the
*split of responsibility* stands, the *split of availability* does not.
Independent of Phase 8 (29-30) — different files, no shared dependency.
Multi-engine review (Codex + Kilo/gemini-3.7-flash) complete and
incorporated — accepted for task breakdown. Initiative 31 (provider
action-layer decoupling) is a hard prerequisite for 33 and 34 — do not
start either until 31 lands.

## Initiatives

`#` is the stable id (folder/task prefix); it is NOT reading order —
`Priority` is.

| Priority | #   | Initiative                                                                                | Status                         | Depends on             | Size |
| -------- | --- | ----------------------------------------------------------------------------------------- | ------------------------------ | ---------------------- | ---- |
| 1        | 01  | [Project scaffold](01-project-scaffold/plan.md)                                           | ✅ done                         | —                      | S    |
| 2        | 02  | [Domain types + registry store](02-domain-and-registry/plan.md)                           | ✅ done (02.3 hardening merged) | 01                     | S    |
| 3        | 03  | [Claude + Kilo adapters (skill+rule)](03-claude-kilo-adapters/plan.md)                    | ✅ done (03.4 hardening merged) | 02                     | M    |
| 4        | 04  | [Source resolver (git-custom + local-folder)](04-source-resolver/plan.md)                 | ✅ done (04.3 hardening merged) | 02                     | M    |
| 5        | 05  | [Canonical model + translator (skill)](05-translator-skill/plan.md)                       | ✅ done (05.2 hardening merged) | 03.4                   | M    |
| 6        | 06  | [Install engine (pipeline)](06-install-engine/plan.md)                                    | ✅ done (06.1/06.2 merged)      | 05, 02.3, 03.4, 04.3   | M    |
| 7        | 07  | [Minimal UI (3 views)](07-minimal-ui/plan.md)                                             | ✅ done (07.1/07.2/07.3 merged) | 06                     | M    |
| 8        | 08  | [Agent artifact support](08-agent-support/plan.md)                                        | ✅ done                         | 07                     | M    |
| 9        | 09  | [Command artifact support](09-command-support/plan.md)                                    | ✅ done                         | 08                     | M    |
| 10       | 10  | [MCP-server artifact support](10-mcp-support/plan.md)                                     | ✅ done                         | 08                     | L    |
| 11       | 11  | [Marketplace sources resolver](11-marketplace-sources/plan.md)                            | ✅ done                         | 08, 09, 10             | M    |
| 12       | 12  | [GitHub Copilot adapter](12-copilot-adapter/plan.md)                                      | ✅ done                         | 08, 09, 10             | M    |
| 13       | 13  | [Drift & update detection](13-drift-and-updates/plan.md)                                  | ✅ done                         | 12                     | M    |
| 14       | 14  | [Discovery & promotion](14-discovery-promotion/plan.md)                                   | ✅ done                         | 13                     | M    |
| 15       | 15  | [File watchers for consistency](15-file-watchers/plan.md)                                 | ✅ done                         | 13                     | S    |
| 16       | 16  | [Management dashboard webview](16-dashboard-webview/plan.md)                              | ✅ done                         | 13, 14, 15             | L    |
| 17       | 17  | [Form editor webview](17-form-editor/plan.md)                                             | ✅ done                         | 08, 09, 10, 16         | M    |
| 18       | 18  | [Cross-assistant sync](18-cross-assistant-sync/plan.md)                                   | ✅ done                         | 06, 13, 14, 16         | M    |
| 19       | 19  | [`hook` kind + active `rule` merge](19-hook-and-rule-merge/plan.md)                       | ✅ done                         | 03, 06, 12             | L    |
| 20       | 20  | [`remote-url` & `git-single-item` sources](20-remote-url-and-single-item-sources/plan.md) | ✅ done                         | 04, 11                 | M    |
| 21       | 21  | [Codex CLI & Gemini CLI adapters](21-codex-gemini-adapters/plan.md)                       | ✅ done                         | 03, 05, 08, 09, 10, 12 | L    |
| 22       | 22  | [Project-scoped recommended installations](22-project-recommendations/plan.md)           | ✅ done                         | 02, 06, 07             | M    |
| 23       | 23  | [Cross-framework identity lookup + shared content accessor](23-cross-framework-lookup/plan.md) | ✅ done (23.1/23.2/23.3 merged)        | 13, 14                 | M    |
| 24       | 24  | [Diff-vs-original + preview-before-install](24-diff-and-preview/plan.md)                 | ✅ done (24.1/24.2 merged)             | 23                     | M    |
| 25       | 25  | [Move action + Promote disambiguation fix](25-move-and-promote-fix/plan.md)               | ✅ done (25.1/25.2/25.3/25.4/25.5 merged) | 14, 18              | M    |
| 26       | 26  | [Dashboard rebuild: unified table, filters, detail](26-dashboard-rebuild/plan.md)          | ✅ done (26.1/26.2 merged)             | 16, 23, 24, 25         | L    |
| 27       | 27  | [New Dashboard entry points](27-dashboard-entry-points/plan.md)                            | ✅ done (27.1/27.2 merged)             | 22, 26                 | S    |
| 28       | 28  | [Sidebar navigation unification](28-sidebar-unification/plan.md)                           | ✅ done (28.1/28.2)                    | 16, 22                 | M    |
| 29       | 29  | [Adapter registry & enabled-assistants config](29-adapter-registry/plan.md)                | ✅ done (29.1-29.5 merged; 29.5 setting reshaped array→object-of-booleans post-testing feedback) | 03, 12, 21             | M    |
| 30       | 30  | [Source-resolver registry](30-source-resolver-registry/plan.md)                            | ✅ done (30.1-30.4 merged; plan.ts's `resolveArtifactContent` dispatch intentionally out of scope, see note) | 04, 11, 20             | M    |
| 31       | 31  | [Dashboard: provider action-layer decoupling](31-dashboard-action-decoupling/plan.md)      | ✅ done (31.1-31.4 merged)             | 28, 29, 30             | M    |
| 32       | 32  | [Dashboard: structural skeleton](32-dashboard-skeleton/plan.md)                            | ✅ done (32.1-32.3 merged)             | 28, 29                 | M    |
| 33       | 33  | [Dashboard: Sources & Catalog section](33-dashboard-sources-catalog/plan.md)                | ✅ done (33.1-33.5 merged)             | 31, 32                 | L    |
| 34       | 34  | [Dashboard: Recommendations + Installed action parity](34-dashboard-recommendations-parity/plan.md) | 📋 planned                   | 31, 32                 | M    |

## Specs

| Spec                                                         | Drives                     |
| ------------------------------------------------------------ | -------------------------- |
| [foundations](specs/foundations.md)                          | 01, 02, 03, 04, 05, 06, 07 |
| [phase-2-spec](specs/phase-2-spec.md)                        | 08, 09, 10, 11, 12         |
| [phase-3-spec](specs/phase-3-spec.md)                        | 13, 14, 15, 16             |
| [phase-4-spec](specs/phase-4-spec.md)                        | 17, 18, 19, 20, 21         |
| [project-recommendations](specs/project-recommendations.md)  | 22                         |
| [phase-6-spec](specs/phase-6-spec.md)                        | 23, 24, 25, 26, 27         |
| [phase-7-spec](specs/phase-7-spec.md)                        | 28                         |
| [adapter-and-source-registries](specs/adapter-and-source-registries.md) | 29, 30           |
| [phase-9-spec](specs/phase-9-spec.md)                        | 31, 32, 33, 34             |

## Dependency graph

```text
Phase 1 & 2:
01 ──► 02 ──► 03 ──► 04 ──► 05 ──► 06 ──► 07 ──► 08 ──► 09 ──► 10 ──► 11 ──► 12

Phase 3:
12 ──► 13 (Drift & Updates) ──┬──► 14 (Discovery & Promotion) ──┬──► 16 (Dashboard Webview)
                              └──► 15 (File Watchers) ──────────┘

Phase 4 (independent of each other beyond shared Phase 1-3 prerequisites):
16 ────────────────────► 17 (Form Editor)
06, 13, 14 ─────────────► 18 (Cross-Assistant Sync)
03, 06, 12 ─────────────► 19 (hook + rule merge)
04, 11 ─────────────────► 20 (remote-url + git-single-item)
03, 05, 08, 09, 10, 12 ─► 21 (Codex + Gemini adapters)

Phase 6 (sidebar/Dashboard usability overhaul):
13, 14 ──────────────────► 23 (Cross-framework lookup + content accessor)
23 ───────────────────────► 24 (Diff-vs-original + preview-before-install)
14, 18 ────────────────────► 25 (Move action + Promote disambiguation fix)
16, 23, 24, 25 ─────────────► 26 (Dashboard rebuild)
22, 26 ─────────────────────► 27 (New Dashboard entry points)

Phase 7 (sidebar navigation unification):
16, 22 ──────────────────────► 28 (Sources+Available merge, Installed kind-grouping)
```

---

Delegation rules, the pipeline, and the folder convention live in
[`AGENTS.md`](AGENTS.md).
