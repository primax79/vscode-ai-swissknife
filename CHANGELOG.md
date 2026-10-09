# Changelog

All notable changes to the "AI Swissknife" extension are documented in this file.

## [0.6.0] - 2026-10-09

- Changed: the Dashboard **Installed tab is now a collapsible tree**: one row per object with a strip of icons (assistant + scope) for every place it is installed in and one badge for the worst state, expanding to one row per place (40.2). The separate Unmanaged table is gone: unmanaged items are rows of the same tree.
- Changed: the project scope is called **Workspace** everywhere, with shared Global / Workspace icons (40.4).
- Added: **Restore from Trash...** and **Empty Trash...** commands (soft-deleted items now record where they came from) (42.1).
- Added: `ai-swissknife redistribute <folder> [--write]` for agents: after editing a skill in a folder registered as a local-folder source, push the change to every installed copy (plan first; modified copies skipped unless `--force`, previous version saved to the trash) (46.5). `--roots` scans several workspaces (48.1); `describe` and an `AGENTS.md` document the CLI (46.2).
- Internal (no UI yet): disable/enable of skills, agents and commands by moving them to a sibling `_disabled` folder (verified with the real Kilo), including inventory of disabled items (43.2, 43.3); a wrapper for the Claude Code plugin CLI (45.2).

## [0.5.0] - 2026-10-09

- Added: **Update All** (command palette, a button in the title bar of each environment view, and in the Dashboard acting on the current filters, plus a clickable "Updates Available" card). Summary first; items modified locally are skipped unless you opt in, in which case your version is saved to the trash first (47.1, 47.2).
- Added: a refresh button on each source (sidebar and Dashboard) that re-resolves only that source (38.1, 38.2); a loading spinner per source while it resolves (44.5).
- Changed: Add Source can target Global and Workspace at once, with one local path per scope and a "Replace?" prompt for an existing id (36.3).
- Fixed: installing an MCP server into Kilo wrote to a file Kilo does not read and in a shape Kilo rejects; it now writes the `mcp` entry of `kilo.jsonc` in Kilo's `local`/`remote` shape, preserving comments (44.3).
- Fixed: skill frontmatter with folded/literal block scalars (`description: >`) was read as `">"` (44.4).
- Added: a read-only command-line interface (`dist/cli.js`, `ai-swissknife` bin) for agents and scripts (46.1) and a cross-process lock for manifest/state writes (46.3).
- Internal: drift checks resolve each source once (47.4); object-to-places model for the upcoming collapsible tree (40.1).

## [0.4.0] - 2026-10-08

- Changed: the Dashboard item detail panel now shows a header (kind, assistant,
  scope), the state in words, a computed origin (it no longer says "no known
  origin" for items that match a registered source), the file location and a
  single action bar with labelled buttons; Diff moved into the bar (39.4).
- Security hardening: git sources now validate the URL, branch/tag/commit and
  cache id before running git, use `--` separators and a protocol allow-list
  (44.1).

## [0.3.0] - 2026-10-08

- Changed: Add Source wizard reordered to type, scope, location, then id and
  display name prefilled from the location; the branch/tag pin is now an
  optional "Advanced" step; scope is labelled Global / Workspace (36.2).
- Internal: refresh of a single source in the catalog (`refreshSource`), not
  yet wired to a button (38.1).

## [0.2.0] - 2026-10-08

- Fixed: the Dashboard Installed tab showed `[object Object]` after a data
  refresh, and the Unmanaged table was not refreshed (39.1).
- Internal: pure helper to validate a source location and derive its id/name
  (36.1, not yet wired into the Add Source flow).

## [0.1.0] - 2026-10-08

- Internal: engine helper to plan and apply an install across several
  assistants and scopes at once (`installMatrix`); not yet wired into the UI.

## [0.0.1] - 2026-09-07

Initial release.

- Cross-assistant package manager, marketplace, and editor extension for
  Claude Code, Kilo Code, GitHub Copilot, Codex CLI, and Google Gemini CLI.
- Skill, agent, command, MCP server, hook, and rule artifact kinds.
- `local-folder`, `git-custom`, `git-marketplace`, `git-single-item`, and
  `remote-url` source types.
- Sources, Available, and Installed tree views, a management Dashboard, and
  a structured Form Editor.
- Transactional install engine (resolve → plan → preview → apply → verify)
  with rollback and SHA-256 integrity verification.
- Cross-assistant translation, cross-assistant/cross-scope sync, drift and
  upstream update detection, and unmanaged-artifact discovery/promotion.
