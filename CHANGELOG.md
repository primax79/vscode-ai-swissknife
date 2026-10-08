# Changelog

All notable changes to the "AI Swissknife" extension are documented in this file.

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
