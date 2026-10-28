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
Multi-engine review (Codex + Kilo/gemini-3.7-flash) complete and
incorporated — accepted for task breakdown. Initiative 31 (provider
action-layer decoupling) is a hard prerequisite for 33 and 34 — do not
start either until 31 lands. **Revised at task-breakdown time**: despite
the spec's own initial "independent of Phase 8" framing, 29/30's
`AssistantId → Adapter`/`Source.type → resolver` call-site migration
touches the exact same lines Initiative 31 decouples — see
`specs/phase-9-spec.md` §7.1 — so all four initiatives were sequenced
after Phase 8's full merge, not run in parallel with it.

**2026-09-09 — Phase 9 complete**: all four initiatives (31-34) merged.
31 (provider action-layer decoupling), 32 (Dashboard structural skeleton:
section tabs, provider wiring, incremental postMessage updates), 33
(Sources & Catalog section: browse/add/remove/export/import sources,
lazy catalog browsing with diagnostics, preview, install single/folder/
source, installed-in badges), 34 (Recommendations section with install-
one/install-all/unrecommend, Uninstall/Update-to-latest in the detail
panel with server-side re-resolution by stable identity, cross-refresh
audit). Full `typecheck && lint && test && build` gate green throughout;
several real bugs found and fixed along the way (two pre-existing test-
isolation issues unrelated to this phase, multiple send-but-never-
consume `postMessage` field bugs, missing cross-refresh calls on
Initiative-26-era Dashboard actions) — see the individual merge commits
for detail.

**2026-09-14 — Initiative 35 complete**: hands-on `.vsix` testing
feedback on Phase 9 (instant loading shell, Overview content, Installed
per-tool comparison matrix replacing the flat table, catalog rows as a
real grid table, icon-only buttons), specced inline in its own
[Dashboard: correzioni dai test pratici](done/35-dashboard-hands-on-fixes/plan.md) — no separate spec file.
Followed by two unplanned fixes (Dashboard buttons silently failing on
artifact names containing an apostrophe).

**2026-09-23 — Test-isolation fix, all planned development complete**:
the UI test suite was reading the developer's real `~/.ai-swissknife`
global manifest and running real `git fetch`es of its registered sources
(providers built without `homeRoot` fall back to `os.homedir()`), which
also made the suite flaky (a fetch started under the real HOME could
write into a later test's temp home while it was being removed —
`ENOTEMPTY`). Fixed with a file-wide HOME sandbox in `ui.test.ts`, plus
threading `homeRoot` through the `SourceResolver` opts so resolver cache
dirs honour it (`discovery`, `drift`, `availableView` call sites). No
open initiatives remain; next work is expected to come from another
hands-on testing round.

## Initiatives

`#` is the stable id (folder/task prefix); it is NOT reading order —
`Priority` is.

<!-- ai-orch:generated initiatives -->
| Priority | #   | Initiative                                                                                | Status                         | Depends on             | Size |
| -------- | --- | ----------------------------------------------------------------------------------------- | ------------------------------ | ---------------------- | ---- |
| 1 | 01 | [Scaffold del progetto](done/01-project-scaffold/plan.md) | done | — | S |
| 2 | 02 | [Tipi di dominio + store del registro](done/02-domain-and-registry/plan.md) | done | 01 | S |
| 3 | 03 | [Adapter Claude + Kilo (skill+rule)](done/03-claude-kilo-adapters/plan.md) | done | 02 | M |
| 4 | 04 | [Resolver delle sorgenti (git-custom + local-folder)](done/04-source-resolver/plan.md) | done | 02 | M |
| 5 | 05 | [Modello canonico + traduttore (skill)](done/05-translator-skill/plan.md) | done | 03.4 | M |
| 6 | 06 | [Motore di installazione (pipeline)](done/06-install-engine/plan.md) | done | 05, 02.3, 03.4, 04.3 | M |
| 7 | 07 | [UI minimale (3 viste)](done/07-minimal-ui/plan.md) | done | 06 | M |
| 8 | 08 | [Supporto agli artefatti agent](done/08-agent-support/plan.md) | done | 07 | M |
| 9 | 09 | [Supporto agli artefatti command](done/09-command-support/plan.md) | done | 08 | M |
| 10 | 10 | [Supporto agli artefatti MCP-server](done/10-mcp-support/plan.md) | done | 08 | L |
| 11 | 11 | [Resolver delle sorgenti marketplace](done/11-marketplace-sources/plan.md) | done | 08, 09, 10 | M |
| 12 | 12 | [Adapter GitHub Copilot](done/12-copilot-adapter/plan.md) | done | 08, 09, 10 | M |
| 13 | 13 | [Rilevamento di drift e aggiornamenti](done/13-drift-and-updates/plan.md) | done | 12 | M |
| 14 | 14 | [Rilevamento e promozione](done/14-discovery-promotion/plan.md) | done | 13 | M |
| 15 | 15 | [File watcher per la coerenza](done/15-file-watchers/plan.md) | done | 13 | S |
| 16 | 16 | [Webview della dashboard di gestione](done/16-dashboard-webview/plan.md) | done | 13, 14, 15 | L |
| 17 | 17 | [Webview dell'editor a modulo](done/17-form-editor/plan.md) | done | 08, 09, 10, 16 | M |
| 18 | 18 | [Sincronizzazione tra assistenti](done/18-cross-assistant-sync/plan.md) | done | 06, 13, 14, 16 | M |
| 19 | 19 | [Tipo `hook` + merge attivo di `rule`](done/19-hook-and-rule-merge/plan.md) | done | 03, 06, 12 | L |
| 20 | 20 | [Sorgenti `remote-url` e `git-single-item`](done/20-remote-url-and-single-item-sources/plan.md) | done | 04, 11 | M |
| 21 | 21 | [Adapter Codex CLI e Gemini CLI](done/21-codex-gemini-adapters/plan.md) | done | 03, 05, 08, 09, 10, 12 | L |
| 22 | 22 | [Installazioni consigliate a livello di progetto](done/22-project-recommendations/plan.md) | done | 02, 06, 07 | M |
| 23 | 23 | [Ricerca di identità cross-framework + accessor condiviso dei contenuti](done/23-cross-framework-lookup/plan.md) | done | 13, 14 | M |
| 24 | 24 | [Diff rispetto all'originale + anteprima prima dell'installazione](done/24-diff-and-preview/plan.md) | done | 23 | M |
| 25 | 25 | [Azione Move + correzione della disambiguazione di Promote](done/25-move-and-promote-fix/plan.md) | done | 14, 18 | M |
| 26 | 26 | [Ricostruzione della Dashboard: tabella unificata, filtri, dettaglio](done/26-dashboard-rebuild/plan.md) | done | 16, 23, 24, 25 | L |
| 27 | 27 | [Nuovi punti di accesso alla Dashboard](done/27-dashboard-entry-points/plan.md) | done | 22, 26 | S |
| 28 | 28 | [Iniziativa 28 — Unificazione della navigazione nella sidebar](done/28-sidebar-unification/plan.md) | done | 16, 22 | M |
| 29 | 29 | [Registro degli adapter e configurazione degli assistenti abilitati](done/29-adapter-registry/plan.md) | done | 03, 12, 21 | M |
| 30 | 30 | [Registro dei risolutori di sorgenti](done/30-source-resolver-registry/plan.md) | done | 04, 11, 20 | M |
| 31 | 31 | [Dashboard: disaccoppiamento del livello di azione dei provider](done/31-dashboard-action-decoupling/plan.md) | done | 28, 29, 30 | M |
| 32 | 32 | [Dashboard: scheletro strutturale](done/32-dashboard-skeleton/plan.md) | done | 28, 29 | M |
| 33 | 33 | [Dashboard: sezione Sources & Catalog](done/33-dashboard-sources-catalog/plan.md) | done | 31, 32 | L |
| 34 | 34 | [Dashboard: sezione Recommendations + parità delle azioni di Installed](done/34-dashboard-recommendations-parity/plan.md) | done | 31, 32 | M |
| 35 | 35 | [Dashboard: correzioni dai test pratici](done/35-dashboard-hands-on-fixes/plan.md) | done | 31, 32, 33, 34 | M |
| 36 | 36 | [Wizard di aggiunta sorgente](done/36-add-source-wizard/plan.md) | done | 29, 30, 31 | M |
| 37 | 37 | [Installazione su più assistenti e ambiti](37-install-multi-target/plan.md) | in progress (done: 37.1; next: 37.2–37.3) | 29, 31 | M |
| 38 | 38 | [Aggiornamento per singola sorgente](done/38-per-source-refresh/plan.md) | done | 31, 33 | S |
| 39 | 39 | [Scheda Installed della Dashboard: bug, parità delle azioni, chiarezza degli stati](39-dashboard-installed-fixes/plan.md) | in progress (done: 39.1, 39.4; running: 39.2) | 31, 32, 34, 35 | M |
| 40 | 40 | [Dashboard Installed: una riga comprimibile per oggetto, una riga figlia per posizione](done/40-dashboard-collapsible-objects/plan.md) | done | 35, 39.1 | L |
| 41 | 41 | ["Install elsewhere" da una riga della Dashboard](41-install-elsewhere/plan.md) | in progress (done: 41.1; next: 41.2) | 37, 40 | M |
| 42 | 42 | [Azioni sugli elementi, completamento Tier 1](42-item-actions-tier1/plan.md) | in progress (done: 42.1; next: 42.2–42.5) | 39.2, 40 | M |
| 43 | 43 | [Stato disabilitato per gli elementi installati](43-disabled-state/plan.md) | in progress (done: 43.1–43.3; next: 43.4) | 40, 42 | L |
| 44 | 44 | [Hardening e correzioni emersi dal confronto incrociato con kilocode-dev](44-hardening-from-kilocode-dev/plan.md) | in progress (done: 44.1, 44.3–44.6; next: 44.2) | 36.1, 38.1 | M |
| 45 | 45 | [Plugin di Claude Code, gestione nativa](45-claude-plugins/plan.md) | in progress (done: 45.2; next: 45.3–45.5) | 40, 42 | L |
| 46 | 46 | [Accesso CLI a ai-swissknife](done/46-cli-access/plan.md) | done | 37.1, 44.1 | M |
| 47 | 47 | [Aggiorna tutto (Update all)](done/47-update-all/plan.md) | done | 37.1 | M |
| 48 | 48 | [Funzionalità per i manutentori nella CLI — solo bozza](48-cli-maintainer-features/plan.md) | in progress (done: 48.1, 48.1b; running: 48.2) | 46, 47 | L |
| 49 | 49 | [Install provenance and update detection](49-install-provenance/plan.md) | in progress (done: 49.1–49.5; to verify: 49.6–49.7) | - | - |
<!-- /ai-orch:generated initiatives -->

## Use cases

<!-- ai-orch:generated use-cases -->
| Id | Priority | Use Case | Stage | Actor | Linked tasks |
| --- | --- | --- | --- | --- | --- |
| UC001 (Register source and browse skills) | P1 | [Register a custom Git or local source and browse its loose skills](use-cases/UC001-register-a-custom-git-or-local-source-and-browse-its-loose-skills.md) | untested (proposed) | User | 02.1, 02.2, 02.3, 04.1, 04.2, 04.3, 07.1, 07.2, 07.3 |
| UC002 (Install skill transactionally) | P1 | [Preview and transactionally install a skill onto Claude or Kilo](use-cases/UC002-preview-and-transactionally-install-a-skill-onto-claude-or-kilo.md) | untested (proposed) | User | 03.1, 03.2, 03.3, 03.4, 05.1, 05.2, 06.1, 06.2, 07.1, 07.2, 07.3 |
| UC003 (Manifest and state persistence) | P1 | [Separate shared manifest intent from machine-local install state](use-cases/UC003-separate-shared-manifest-intent-from-machine-local-install-state.md) | untested (proposed) | User | 02.1, 02.2, 02.3, 06.1, 06.2, 07.1, 07.2, 07.3 |
| UC004 (Install agents and commands) | P1 | [Translate and install agents and commands across Claude, Kilo, Copilot](use-cases/UC004-translate-and-install-agents-and-commands-across-claude-kilo-copilot.md) | untested (proposed) | User | 08.1, 08.2, 08.3, 09.1, 09.2, 09.3, 12.1, 12.2, 12.3 |
| UC005 (Manage MCP server configs) | P1 | [Merge and remove MCP server entries in JSON/JSONC assistant configs](use-cases/UC005-merge-and-remove-mcp-server-entries-in-json-jsonc-assistant-configs.md) | in development (proposed) | User | 10.1, 10.2, 10.3, 12.1, 12.2, 12.3, 44.1, 44.2, 44.3, 44.4, 44.5, 44.6 |
| UC006 (Resolve marketplace catalog) | P1 | [Resolve multi-plugin catalogs from git-marketplace sources](use-cases/UC006-resolve-multi-plugin-catalogs-from-git-marketplace-sources.md) | untested (proposed) | User | 11.1, 11.2, 11.3 |
| UC007 (Detect drift and updates) | P1 | [Detect local drift and upstream updates on managed installations](use-cases/UC007-detect-local-drift-and-upstream-updates-on-managed-installations.md) | untested (proposed) | User | 13.1, 13.2, 13.3, 15.1, 15.2 |
| UC008 (Discover and promote items) | P1 | [Discover unmanaged artifacts in assistant folders and promote them](use-cases/UC008-discover-unmanaged-artifacts-in-assistant-folders-and-promote-them.md) | untested (proposed) | User | 14.1, 14.2, 14.3 |
| UC009 (Management Dashboard webview) | P2 | [Inspect and manage inventory from the Management Dashboard webview](use-cases/UC009-inspect-and-manage-inventory-from-the-management-dashboard-webview.md) | untested (proposed) | User | 15.1, 15.2, 16.1, 16.2, 16.3 |
| UC010 (Structured Form Editor) | P2 | [Create or edit artifacts via the structured Form Editor webview](use-cases/UC010-create-or-edit-artifacts-via-the-structured-form-editor-webview.md) | untested (proposed) | User | 17.1, 17.2, 17.3 |
| UC011 (Cross-assistant sync) | P1 | [Sync an installed artifact across assistants and scopes](use-cases/UC011-sync-an-installed-artifact-across-assistants-and-scopes.md) | untested (proposed) | User | 18.1, 18.2, 18.3 |
| UC012 (Install hooks and merge rules) | P1 | [Install hooks and merge demarcated rules non-destructively](use-cases/UC012-install-hooks-and-merge-demarcated-rules-non-destructively.md) | untested (proposed) | User | 19.1, 19.2, 19.3, 19.4 |
| UC013 (Resolve single-item and URL sources) | P2 | [Resolve artifacts from git-single-item and remote-url sources](use-cases/UC013-resolve-artifacts-from-git-single-item-and-remote-url-sources.md) | in development (proposed) | User | 20.1, 20.2, 20.3, 44.1, 44.2, 44.3, 44.4, 44.5, 44.6 |
| UC014 (Codex and Gemini CLI adapters) | P1 | [Install and manage artifacts for Codex CLI and Gemini CLI](use-cases/UC014-install-and-manage-artifacts-for-codex-cli-and-gemini-cli.md) | untested (proposed) | User | 21.1, 21.2, 21.3, 21.4 |
| UC015 (Curate project recommendations) | P2 | [Mark or unmark project-scoped recommended artifacts in manifest.json](use-cases/UC015-mark-or-unmark-project-scoped-recommended-artifacts-in-manifest-json.md) | untested (proposed) | Project maintainer | 22.1, 22.2, 22.3, 22.4, 22.5 |
| UC016 (Install workspace recommendations) | P1 | [Prompt on workspace open and install recommended project artifacts](use-cases/UC016-prompt-on-workspace-open-and-install-recommended-project-artifacts.md) | untested (proposed) | User | 22.1, 22.2, 22.3, 22.4, 22.5 |
| UC017 (Cross-framework lookup and diff) | P2 | [Inspect cross-framework presence and diff against upstream original](use-cases/UC017-inspect-cross-framework-presence-and-diff-against-upstream-original.md) | untested (proposed) | User | 23.1, 23.2, 23.3, 24.1, 24.2, 26.1, 26.2 |
| UC018 (Move artifact with soft-delete) | P1 | [Move an installed artifact to another assistant or scope with soft-delete](use-cases/UC018-move-an-installed-artifact-to-another-assistant-or-scope-with-soft-delete.md) | untested (proposed) | User | 25.1, 25.2, 25.3, 25.4, 25.5 |
| UC019 (Disambiguate source on promote) | P1 | [Disambiguate multiple matching sources when promoting an unmanaged item](use-cases/UC019-disambiguate-multiple-matching-sources-when-promoting-an-unmanaged-item.md) | untested (proposed) | User | 25.1, 25.2, 25.3, 25.4, 25.5 |
| UC020 (Status bar and source jump) | P2 | [Open the Dashboard from the status bar pending badge or filtered by source](use-cases/UC020-open-the-dashboard-from-the-status-bar-pending-badge-or-filtered-by-source.md) | untested (proposed) | User | 26.1, 26.2, 27.1, 27.2 |
| UC021 (Unified Sources catalog tree) | P2 | [Browse source contents directly inside the unified Sources sidebar tree](use-cases/UC021-browse-source-contents-directly-inside-the-unified-sources-sidebar-tree.md) | in development (proposed) | User | 28.1, 28.2, 44.1, 44.2, 44.3, 44.4, 44.5, 44.6 |
| UC022 (Installed tree kind grouping) | P2 | [Browse installed and unmanaged items grouped by kind in the sidebar](use-cases/UC022-browse-installed-and-unmanaged-items-grouped-by-kind-in-the-sidebar.md) | untested (proposed) | User | 28.1, 28.2 |
| UC023 (Configure enabled assistants) | P2 | [Configure which AI assistants are enabled in the sidebar and pickers](use-cases/UC023-configure-which-ai-assistants-are-enabled-in-the-sidebar-and-pickers.md) | untested (proposed) | User | 29.1, 29.2, 29.3, 29.4, 29.5, 30.1, 30.2, 30.3, 30.4 |
| UC024 (Dashboard sources and catalog) | P2 | [Manage sources, export/import config, and install from Dashboard catalog](use-cases/UC024-manage-sources-export-import-config-and-install-from-dashboard-catalog.md) | untested (proposed) | User | 31.1, 31.2, 31.3, 31.4, 32.1, 32.2, 32.3, 33.1, 33.2, 33.3, 33.4, 33.5, 35.1, 35.2, 35.3, 35.4, 35.5 |
| UC025 (Dashboard recommendations & parity) | P1 | [Act on workspace recommendations and update or uninstall from Dashboard](use-cases/UC025-act-on-workspace-recommendations-and-update-or-uninstall-from-dashboard.md) | untested (proposed) | User | 31.1, 31.2, 31.3, 31.4, 34.1, 34.2, 34.3, 35.1, 35.2, 35.3, 35.4, 35.5 |
| UC026 (Trash list, restore, empty) | P1 | [Soft-delete, list, restore, and empty trashed artifacts across scopes](use-cases/UC026-soft-delete-list-restore-and-empty-trashed-artifacts-across-scopes.md) | in development (proposed) | User | 39.1, 39.2, 39.3, 39.4, 42.1, 42.2, 42.3, 42.4, 42.5 |
| UC027 (Update all outdated items) | P1 | [Batch-update all outdated managed items while protecting local edits](use-cases/UC027-batch-update-all-outdated-managed-items-while-protecting-local-edits.md) | untested (proposed) | User | 47.1, 47.2, 47.3, 47.4 |
| UC028 (Multi-target install & refresh) | P1 | [Install an artifact to multiple assistants and scopes or refresh one source](use-cases/UC028-install-an-artifact-to-multiple-assistants-and-scopes-or-refresh-one-source.md) | in development (proposed) | User | 36.1, 36.2, 36.3, 37.1, 37.2, 37.3, 38.1, 38.2, 40.1, 40.2, 40.3, 40.4, 40.5 |
| UC029 (Disable and enable items) | P2 | [Disable and re-enable installed skills, agents, and commands in place](use-cases/UC029-disable-and-re-enable-installed-skills-agents-and-commands-in-place.md) | in development (proposed) | User | 43.1, 43.2, 43.3, 43.4 |
| UC030 (Claude CLI plugin read model) | P3 | [Query Claude Code installed plugins, details, and marketplaces via CLI](use-cases/UC030-query-claude-code-installed-plugins-details-and-marketplaces-via-cli.md) | in development (proposed) | User | 45.1, 45.2, 45.3, 45.4, 45.5 |
| UC031 (Headless CLI read commands) | P1 | [Inspect sources, catalog, installed items, updates, and plans via CLI](use-cases/UC031-inspect-sources-catalog-installed-items-updates-and-plans-via-cli.md) | untested (proposed) | Operator | 46.1, 46.2, 46.3, 46.4, 46.5 |
| UC032 (CLI write commands & state lock) | P1 | [Execute plan-first CLI write commands with state locking and code gates](use-cases/UC032-execute-plan-first-cli-write-commands-with-state-locking-and-code-gates.md) | untested (proposed) | Operator | 46.1, 46.2, 46.3, 46.4, 46.5 |
| UC033 (CLI redistribute edited skill) | P1 | [Redistribute edited local-folder artifacts to all installed copies via CLI](use-cases/UC033-redistribute-edited-local-folder-artifacts-to-all-installed-copies-via-cli.md) | untested (proposed) | Agent session | 46.1, 46.2, 46.3, 46.4, 46.5 |
| UC034 (CLI multi-root workspace scan) | P2 | [Scan multiple workspace roots via CLI with depth and ignore rules](use-cases/UC034-scan-multiple-workspace-roots-via-cli-with-depth-and-ignore-rules.md) | in development (proposed) | Operator | 48.1, 48.1b, 48.2, 48.3, 48.4, 48.5, 48.6, 48.7, 48.8 |
<!-- /ai-orch:generated use-cases -->

## Next up

Emergent tasks (`T###`) sit beside the initiatives; see [`AGENTS.md`](AGENTS.md), "Emergent tasks". None open today: all initiatives are done and the next work is expected from a hands-on testing round.

<!-- ai-orch:generated next-up -->
| Id | Priority | Task | Executor | Handoff |
| --- | --- | --- | --- | --- |
<!-- /ai-orch:generated next-up -->

## Tasks by category

No emergent tasks yet. Add a category folder (`tasks/<category>/` with a `README.md` and `notes/`) with the first task.

<!-- ai-orch:generated tasks-by-category -->

<!-- /ai-orch:generated tasks-by-category -->

## Decisions waiting

<!-- ai-orch:generated decisions -->
| Task | Question (exact) | Decider | Blocks |
| --- | --- | --- | --- |
| - | None. | - | - |
<!-- /ai-orch:generated decisions -->

## Done

<!-- ai-orch:generated done -->
| Id | Task | Result | Closed |
| --- | --- | --- | --- |
| T001 (Test senza HOME reale) | [Test di discovery indipendenti dalla HOME reale](done/tests/T001-test-di-discovery-indipendenti-dalla-home-reale.md) | done | 2026-10-27 |
<!-- /ai-orch:generated done -->

## Specs

<!-- ai-orch:generated specs -->
| Spec                                                         | Drives                     |
| ------------------------------------------------------------ | -------------------------- |
| [actions-study](specs/actions-study.md) | - |
| [adapter-and-source-registries](specs/adapter-and-source-registries.md) | 29, 30           |
| [claude-plugins-study](specs/claude-plugins-study.md) | - |
| [cli-wishlist-comparison](specs/cli-wishlist-comparison.md) | - |
| [dev-deploy-study](specs/dev-deploy-study.md) | - |
| [disabled-state-study](specs/disabled-state-study.md) | - |
| [foundations](specs/foundations.md)                          | 01, 02, 03, 04, 05, 06, 07 |
| [install-provenance-and-update-detection](specs/install-provenance-and-update-detection.md) | - |
| [mcp-cli-access-study](specs/mcp-cli-access-study.md) | - |
| [phase-2-spec](specs/phase-2-spec.md)                        | 08, 09, 10, 11, 12         |
| [phase-3-spec](specs/phase-3-spec.md)                        | 13, 14, 15, 16             |
| [phase-4-spec](specs/phase-4-spec.md)                        | 17, 18, 19, 20, 21         |
| [phase-6-spec](specs/phase-6-spec.md)                        | 23, 24, 25, 26, 27         |
| [phase-7-spec](specs/phase-7-spec.md)                        | 28                         |
| [phase-9-spec](specs/phase-9-spec.md)                        | 31, 32, 33, 34             |
| [project-recommendations](specs/project-recommendations.md)  | 22                         |
<!-- /ai-orch:generated specs -->

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

Phase 8 (internal registries, independent of each other):
03, 12, 21 ──────────────────► 29 (Adapter registry + enabled-assistants config)
04, 11, 20 ──────────────────► 30 (Source-resolver registry)

Phase 9 (Dashboard superset of sidebar, sequenced after Phase 8):
28, 29, 30 ──► 31 (action-layer decoupling) ──┬──► 33 (Sources & Catalog)
28, 29 ──────► 32 (structural skeleton) ──────┴──► 34 (Recommendations + parity)

Hands-on fixes:
31, 32, 33, 34 ──────────────► 35 (Dashboard hands-on testing fixes)
```

---

Delegation rules, the pipeline, and the folder convention live in
[`AGENTS.md`](AGENTS.md).
