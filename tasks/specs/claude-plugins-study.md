# Study: Claude Code plugins in ai-swissknife

Status: **for owner evaluation**, nothing decided or scheduled. Triggered by the owner (2026-10-08): "how do we handle Claude plugins?".
Grounded in: the real state on this machine (`~/.claude/plugins/{installed_plugins.json,known_marketplaces.json,cache/}`, `~/.claude/settings.json`), the installed Claude CLI (`claude plugin --help`, `list --json`, `details`), `SPEC.md` (lines ~60, 119, 148, 175-184, 349-373), `src/sources/gitMarketplace.ts`.

## 1. How Claude Code manages plugins (verified here)

- **Marketplaces**: `known_marketplaces.json` (name -> source, `installLocation`, optional `autoUpdate`) plus `extraKnownMarketplaces` in `settings.json`.
- **Installed plugins**: `installed_plugins.json` (version 2): `plugin@marketplace` -> installs with `scope` = `user` | `project` | `local`, `projectPath`, `installPath` under `cache/<marketplace>/<plugin>/<version>`, `version`, `gitCommitSha`, timestamps.
- **Enabled state**: `enabledPlugins` in `settings.json` (user) and the project/local settings; the CLI reports `enabled` and `projectEnabled` per install. **A native disable exists** (`claude plugin disable`).
- **A complete CLI**: `claude plugin install | uninstall | enable | disable | update | list [--json] [--available] | details <id> | configure | validate | prune`, and `claude plugin marketplace add | remove | update | list`. `list --json` returns `{id, version, scope, enabled, installPath, projectPath, projectEnabled, installedAt, lastUpdated}`. `details <id>` returns the **component inventory** (skills / agents / hooks / MCP / LSP) and a **projected always-on token cost** (e.g. `gcube-developer-tools`: 6 skills, ~1,000 tokens added to every session).
- A plugin is a **bundle**: skills, agents, commands, hooks, MCP servers; its skills are namespaced (`gcube-developer-tools:gcube-repo-standards`).
- A security gate exists: `install --accept-command <sha256>` for marketplaces that declare an install command.

## 2. What ai-swissknife does today

- A Claude marketplace is just a `git-marketplace` **source**: `gitMarketplace.ts` reads `.claude-plugin/marketplace.json`, walks each plugin directory and extracts **skills, agents and commands as loose artifacts** (`findSkillDirs/findAgentFiles/findCommandFiles`, `:130-171`). Install copies loose files into `.claude/skills|agents|commands` (or Kilo's dirs, after translation).
- The plugin as a unit is lost: no plugin version/commit tracking by Claude, no bundled hooks/MCP, no namespacing, no native update, and the loose copy has no link to Claude's plugin state.
- **Blind spot**: the Installed inventory scans only `~/.claude/{skills,agents,commands}` and the project `.claude/`. The 7 plugins you have enabled (`agent-tooling-meta`, `common-tools`, `gcube-developer-tools`, `architect-side`, ...) and the other 3 installed ones are **invisible** in the sidebar and in the Dashboard.
- Risk of **shadowing/duplicates**: the same skill can exist loose (installed by us) and inside an enabled plugin; nothing detects it. This is also a real example of the "installed also in" idea of initiative 40/41.
- Scopes do not map one to one: Claude has `user`, `project` and `local` (private to the project, in `settings.local.json`); we have Global and Workspace only.

## 3. Options

| Option | What it means | Pros | Cons |
| --- | --- | --- | --- |
| **A. Status quo** | Keep flattening plugins to loose artifacts; ignore Claude's native plugins | Nothing to build | The blind spot and the shadowing stay; no plugin updates, hooks/MCP bundles lost |
| **B. Observe-only** | Show Claude's installed plugins (read from `claude plugin list --json` + `details`) as read-only places: id, version, scope, enabled, components, token cost | Cheap, safe, removes the blind spot, gives the token-cost view, enables duplicate detection | No actions yet |
| **C. Native management** | New artifact kind `plugin` for the Claude environment: install (adding the marketplace if needed), update, enable/disable, uninstall, details, all by **calling the `claude plugin` CLI** | One source of truth (Claude's own); native enable/disable (no `_disabled` folder, cf. initiative 43); no phantom-file bug class (cf. 44.3) | Requires `claude` on the PATH of the extension host (GUI-launched VS Code can lack it; same class of problem as the SSH agent note in `gitProcess.ts`); CLI output/flags can change with versions; interactive prompts must never be auto-accepted |
| **D. Bundle translation for other assistants** | Keep and improve the existing flatten, as the way to bring a Claude plugin's contents to Kilo/Codex/Gemini/Copilot | Already the only way for non-Claude targets | Same limits as A for Claude itself |

Mechanism choice inside C: **call the CLI, do not edit Claude's JSON files by hand** (Claude owns that state and its format is versioned; the kilocode-dev analysis §2.9 is exactly the failure of writing someone else's config files directly).

## 2b. How it fits the existing model

- A Claude plugin install is a **place** with (assistant = Claude, scope user -> Global, project -> Workspace, local -> "Workspace (private)", state enabled / disabled / update-available), a **parent row** whose children are its components (skills, agents, ...) with the token cost shown on the parent. It reuses the tree of initiative 40, the actions of 42 (Update, Uninstall, Favorite = enabled-by-default?) and the native disable instead of 43's folder move.
- A Claude marketplace and an ai-swissknife `git-marketplace` source can be **the same repository**: offer "also register as a Claude marketplace" (`claude plugin marketplace add`) so plugins from our Sources can be installed natively.
- Installing a plugin's content into **Claude** from a source then has two modes: *as a plugin* (native, recommended for Claude) or *as loose artifacts* (today's behaviour, the only mode for other assistants).

## 4. Suggested path (for evaluation)

1. **B first** (observe-only, S/M): `claude plugin list --json` + `details` through a small `ClaudeCli` wrapper (PATH resolution with a clear error when missing, timeouts, JSON parsing guarded), shown in the Installed tree of the Claude environment and in the Dashboard; duplicate detection against loose copies.
2. **C next, per action**: enable/disable first (smallest, safest, instantly useful), then update, uninstall, install, marketplace sync.
3. D stays as is.

## 5. Questions for the owner

- **CP-Q1** ~~scope of support~~ **answered (owner, 2026-10-08): C, native management** (install, update, enable/disable, uninstall, all through the `claude plugin` CLI). Built incrementally: read-only listing first inside the plan, then each action.
- **CP-Q2** ~~mechanism~~ **answered: call the CLI**, never edit Claude's JSON files.
- **CP-Q3** where plugins appear: **working assumption, not yet confirmed**: inside the Installed tree of the Claude environment (parent = plugin, children = components, token cost on the parent).
- **CP-Q4** Claude's `local` scope: ~~working assumption~~ **answered a (owner, 2026-10-08)**: shown as "Workspace (private)" with a distinct badge; `user` = Global, `project` = Workspace (shared with the team).
- **CP-Q5** default install mode for Claude targets: **working assumption**: as a native plugin for Claude, loose artifacts for the other assistants.

Captured in initiative 45.
