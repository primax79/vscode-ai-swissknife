# Study: giving agents access to ai-swissknife through MCP and/or a CLI

Status: **for owner evaluation**, nothing decided or scheduled. Triggered by the owner (2026-10-08): "can we give access to this extension via MCP? or via CLI?".
Grounded in: import analysis of `src/` (which layers need `vscode`), `src/domain/registry.ts` (state files), `src/adapters/registry.ts` (`getEnabledAdapters`), and the workspace precedent `vscode-mcp-dap-debugger/` (extension + MCP + CLI).

## 1. What exists and what constrains the design (verified)

- **The core is already headless.** Files importing `vscode`: `domain` 0 of 3, `engine` 0 of 13, `sources` 0 of 10, `translator` 0 of 6, `adapters` 1 of 8 (and that one, `registry.ts:43-51`, does a guarded `require('vscode')` with a fallback that enables all assistants), `ui` 12 of 13. So inventory (`scanInstalledInventory`), drift (`checkForUpstreamUpdate`), planning/applying installs (`planInstall`, `applyInstall`, and the 37.1 matrix `planInstallMatrix` / `applyInstallMatrix`), source resolution, translation and the manifest/state files all run without VS Code.
- **The orchestration around them lives in `ui/`**, interleaved with `vscode` prompts (e.g. `doUninstallItem`, `removeManagedInstallation`, `doSyncItem`, source add/remove, recommend/unrecommend, promote). Exposing those as non-interactive operations needs a thin "services" layer extracted from `ui/` (initiative 31 started this for the Dashboard; 41/42 add more flows).
- **State files** (`manifest.json`, `state.json`) are written atomically (`atomicWriteJson`) but with **no cross-process lock and no read-modify-write protection**: an extension and a CLI writing at the same moment can lose an update (last writer wins). Rare, but real once two processes write.
- **Precedent in this workspace**: `vscode-mcp-dap-debugger` is an extension that hosts an HTTP MCP server (express + auth token, port discovery file), ships a `bin` CLI inside the vsix (`$DAP_CLI call <tool> '<json>'`, `list`, `read`), registers tools from zod schemas and documents itself to agents through an AGENTS.md block. Same shape would work here.

## 2. Options

| Option | What it is | Pros | Cons |
| --- | --- | --- | --- |
| **A. Bridge to the running extension** | The extension starts a local server (token-protected, loopback only); an MCP endpoint and a CLI talk to it | Sees live UI state, can open the Dashboard / focus an item, no second writer | Needs VS Code running; port/token discovery; tools sit on UI-coupled code (prompts) so every operation needs a non-interactive twin; harder to use in CI or from a plain terminal |
| **B. Headless core: standalone CLI + stdio MCP server** | One Node package over the existing headless layers; runs without VS Code; usable from Claude Code, Kilo, scripts, CI | Cheapest to start (read-only tools need no refactor), no GUI dependency, matches how agents already launch MCP servers | Needs the services extraction for write operations; second writer of the state files (lock needed); no access to live UI state |
| **C. Both, sharing one tool table** | B first; the bridge later, only for UI-state tools (open Dashboard, current selection) | Best of both, no duplicated logic | More to maintain |

CLI and MCP are two faces of **one tool table** (name, input schema, handler): the MCP server lists the tools; the CLI exposes `call <tool> <json>` and `list`. A CLI is also cheaper for agents that have a shell (no tool definitions in the context); an MCP server is the right face for hosts that only speak MCP.

## 3. Candidate tools (read-only first)

- **Read-only, available today without refactoring:** `list_sources`, `list_catalog` (artifacts of a source), `list_installed` (managed + observed, with state: drift, identical/differs), `check_updates`, `get_item` (origin, diff summary, installed-in places), `plan_install` (the 37.1 matrix summary: new / conflict / unsupported per assistant x scope), `resolve_origin`.
- **Write, after the services extraction, always plan -> apply:** `apply_install` (takes the plan, requires the explicit `overwrite` flag for conflicts), `update_item`, `uninstall_item` (soft by default), `promote_item`, `add_source` / `remove_source` / `refresh_source`, `recommend` / `unrecommend`.

## 4. Risks and safety rules (proposed)

- An agent that can install is an agent that can add skills, agents, **hooks and MCP servers** to its own or another tool's configuration: a prompt-injection and code-execution path. Proposed defaults: **read-only unless started with an explicit write flag**; even with it, `hook` and `mcp-server` kinds are refused unless a second flag allows them; every write goes through plan -> apply with a human-readable summary the agent must show; never auto-accept anything (same rule as 45); uninstall is soft by default.
- The server must treat all input as untrusted: reuse the hardened source resolution of 44.1 (URL/ref/id validation) and path-containment checks; no tool takes a raw filesystem path outside the known roots.
- Concurrency: add a small cross-process lock around read-modify-write of `manifest.json` / `state.json` before the CLI is allowed to write (the extension would take the same lock).
- Loopback only and a random token if option A is ever built; no network listener for B (stdio).

## 5. Suggested path (for evaluation)

1. **Read-only B first** (S/M): a `bin` CLI and a stdio MCP server in this repo (built by the same esbuild config, shipped inside the vsix like the DAP debugger, also runnable with `npx`-style invocation), exposing the read-only tools above plus an AGENTS.md block that documents the commands. No refactor of `ui/`.
2. **Services extraction + lock**, then the write tools behind the flags.
3. **Bridge (A)** only if a UI-state tool turns out to be wanted.

## 6. Questions for the owner

- **Owner decision (2026-10-08): "limitiamoci a cli"** : CLI only, **no MCP server** for now. This settles the architecture as the headless core (option B), CLI face only; the bridge (A) and the MCP face are deferred.
- **MC-Q1** ~~architecture~~ answered by the decision above: headless CLI over the existing core.
- **MC-Q2** write policy: **decided by the architect (delegated by the owner, 2026-10-08)**: read-only by default; writes need an explicit `--write` flag, `hook` and `mcp-server` kinds are refused unless a second flag allows them; every write goes plan -> apply.
- **MC-Q3** priority: **decided by the architect (delegated)**: a parallel, low-priority track; read-only commands first (they touch no `ui/` code); writes after the services extraction and the lock.
- **MC-Q4** delivery: **decided by the architect (delegated)**: inside the vsix as a `bin` entry (like the DAP debugger) plus an AGENTS.md block documenting it.

Captured in initiative 46.
