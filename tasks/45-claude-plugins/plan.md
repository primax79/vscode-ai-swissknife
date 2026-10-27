# 45 — Claude Code plugins, native management — Implementation plan

> Source: `specs/claude-plugins-study.md`; owner decisions 2026-10-08: **CP-Q1 = C** (native management: install, update, enable/disable, uninstall) and **CP-Q2** (everything through the `claude plugin` CLI, never by editing Claude's own JSON files). Working assumptions, **not yet confirmed by the owner**: **CP-Q3** plugins appear inside the Installed tree of the Claude environment (parent = plugin, children = its components, token cost on the parent); **CP-Q4 (confirmed by the owner, 2026-10-08, after an explanation of the three scopes)** Claude's `user` / `project` (shared with the team via the repo) / `local` (private to the owner) scopes map to Global / Workspace / "Workspace (private)" (distinct badge); **CP-Q5** installing from our Sources into Claude defaults to a native plugin, other assistants keep loose artifacts. (CP-Q4 was confirmed by the owner earlier.)
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

### 45.1 - Spike: verify the CLI behaviour the design relies on

- **Status:** `paused` (partial findings in notes/45.1-findings.md; paused 2026-10-08 per owner P3 priority decision) · **Short:** Claude plugin CLI spike · **Size:** S · **Kind:** investigation · **Depends on:** - · **Spec:** [45.1-cli-spike.md](45.1-cli-spike.md)
- **Goal:** Verify `claude plugin` CLI binary discovery, JSON output schemas, scope semantics, non-interactive flags, and version gating in an isolated config directory.

### 45.2 - `ClaudeCli` wrapper + read model (list, details, marketplaces)

- **Status:** `delivered` (merged f03e346 2026-10-09) · **Short:** ClaudeCli wrapper and read model · **Size:** M · **Depends on:** 45.1 · **Spec:** [45.2-claude-cli-wrapper.md](45.2-claude-cli-wrapper.md)
- **Goal:** Implement `src/engine/claudeCli.ts` with binary resolution and typed read functions (`listPlugins`, `listAvailablePlugins`, `pluginDetails`, `listMarketplaces`).

### 45.3 - Plugin places in the Installed tree and Dashboard (read-only), token cost, duplicate detection

- **Status:** `open` · **Short:** Plugin places in UI · **Size:** M · **Depends on:** 45.2, 40.1, 40.2, 40.4 · **Spec:** [45.3-plugin-places-in-tree.md](45.3-plugin-places-in-tree.md)
- **Goal:** Render Claude plugin installations as read-only places in the Installed tree and Dashboard with component children, always-on token cost badges, and loose-artifact duplicate detection.

### 45.4 - Actions: enable/disable, update, uninstall

- **Status:** `open` · **Short:** Claude plugin actions · **Size:** M · **Depends on:** 45.3, 42.3 · **Spec:** [45.4-plugin-actions.md](45.4-plugin-actions.md)
- **Goal:** Implement `enablePlugin`, `disablePlugin`, `updatePlugin`, and `uninstallPlugin` in `ClaudeCli` and wire them to the sidebar and Dashboard plugin rows.

### 45.5 - Install from marketplaces, marketplace sync from our Sources, install-mode choice

- **Status:** `open` · **Short:** Plugin install and marketplaces · **Size:** M · **Depends on:** 45.4 · **Spec:** [45.5-install-and-marketplaces.md](45.5-install-and-marketplaces.md)
- **Goal:** Support installing Claude plugins natively from marketplaces (with command-source sha256 confirmation), registering/updating Claude marketplaces from Sources, and choosing native plugin vs. loose artifact install mode.
