# 45 — Claude Code plugins, native management — Implementation plan

> Source: `specs/claude-plugins-study.md`; owner decisions 2026-10-08: **CP-Q1 = C** (native management: install, update, enable/disable, uninstall) and **CP-Q2** (everything through the `claude plugin` CLI, never by editing Claude's own JSON files). Working assumptions, **not yet confirmed by the owner**: **CP-Q3** plugins appear inside the Installed tree of the Claude environment (parent = plugin, children = its components, token cost on the parent); **CP-Q4 (confirmed by the owner, 2026-10-08, after an explanation of the three scopes)** Claude's `user` / `project` (shared with the team via the repo) / `local` (private to the owner) scopes map to Global / Workspace / "Workspace (private)" (distinct badge); **CP-Q5** installing from our Sources into Claude defaults to a native plugin, other assistants keep loose artifacts.
> **Priority lowered to P3 by the owner (2026-10-08): "when the rest is ready"**. The spike 45.1 was started and is paused; its partial findings (isolation via `CLAUDE_CONFIG_DIR`, binary location, marketplace add/list shapes) are in `notes/45.1-findings.md`.
> Inline plan, tasks expanded because they are delegated. Spike 45.1 gates the rest.

**Depends on:** 40.1, 40.2, 40.4 (tree, rows, scope vocabulary) for the UI tasks; 42.3 for action placement. 45.1 and 45.2 depend on nothing.

## Facts (verified, details in the study)

`claude plugin list --json` returns `{id, version, scope: user|project|local, enabled, installPath, projectPath?, projectEnabled?, installedAt, lastUpdated}`; `claude plugin details <id>` returns the component inventory (skills/agents/hooks/MCP/LSP) and the projected always-on token cost; the CLI also has `install | uninstall | enable | disable | update | marketplace add|remove|update|list | list --available`; `install --accept-command <sha256>` guards marketplaces that declare an install command.

## Locked-in decisions

- Mechanism = CLI only. A single wrapper module (`ClaudeCli`) is the only code that spawns `claude`; nothing else reads or writes `~/.claude/plugins/*` or the `enabledPlugins` keys.
- Safety: never pass `-y` / `--accept-command` on the user's behalf; a command-source install shows the declared command and its sha256 in a modal and proceeds only on explicit confirmation. Never run `claude plugin eval`.
- Disable for plugins is `claude plugin disable` (native); initiative 43's `_disabled` folder does not apply.
- Uninstall of a plugin is the CLI's `uninstall` (not our trash: Claude owns the files in its cache); the confirmation says so.
- The wrapper has timeouts, a clear "claude CLI not found" error with the PATH it searched, and tolerates unknown JSON fields; unknown/failed output is reported, never guessed.
- Vocabulary (CONTEXT.md): "Workspace", never "Project"; Claude's `project` scope is shown as Workspace.

## Tasks

| Task | Title | Depends on | Size | Executor |
| --- | --- | --- | --- | --- |
| [45.1](45.1-cli-spike.md) | **Spike**: verify the CLI behaviour the design relies on | - | S | self (real CLI) |
| [45.2](45.2-claude-cli-wrapper.md) | `ClaudeCli` wrapper + read model (list, details, marketplaces) | 45.1 | M | delegated |
| [45.3](45.3-plugin-places-in-tree.md) | Plugin places in the Installed tree and Dashboard (read-only), token cost, duplicate detection | 45.2, 40.1, 40.2, 40.4 | M | delegated |
| [45.4](45.4-plugin-actions.md) | Actions: enable/disable, update, uninstall | 45.3, 42.3 | M | delegated |
| [45.5](45.5-install-and-marketplaces.md) | Install from marketplaces, marketplace sync from our Sources, install-mode choice | 45.4 | M | delegated |
