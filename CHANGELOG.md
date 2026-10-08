# Changelog

All notable changes to the "AI Swissknife" extension are documented in this file.

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
