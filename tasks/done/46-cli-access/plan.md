# 46 — CLI access to ai-swissknife — Implementation plan

> Source: `specs/mcp-cli-access-study.md`; owner decision 2026-10-08: **"limitiamoci a cli"** (CLI only, no MCP server for now). Decided by the architect (delegated by the owner, 2026-10-08): **MC-Q2** read-only by default, writes behind `--write`, `hook`/`mcp-server` kinds refused unless a second flag allows them, every write plan -> apply; **MC-Q3** a parallel, low-priority track (reads first); **MC-Q4** shipped inside the vsix as a `bin` entry plus an AGENTS.md block.
> Inline plan, tasks expanded because they are delegated.

**Depends on:** 37.1 (merged: `planInstallMatrix` / `applyInstallMatrix`), 44.1 (merged: hardened source resolution). Read-only tasks touch no `src/ui/` file, so they do not conflict with the Dashboard/tree work.

## Contract (applies to every CLI task)

- Binary `ai-swissknife` (package `bin`), built to `dist/cli.js` by the existing esbuild setup, shipped in the vsix, runnable with `node dist/cli.js`.
- **stdout is pure JSON** (one document per invocation), **stderr is logs**; exit code 0 on success, non-zero on failure, and failures also print `{ "error": { "code": "...", "message": "..." } }` on stdout (same convention as the workspace's DAP debugger CLI, so agents already know it).
- No `vscode` import anywhere in the CLI bundle (a build-time check fails if `vscode` ends up in `dist/cli.js`).
- Roots: `--workspace <path>` (default: the current directory; used for the Workspace scope), `--home <path>` (default `os.homedir()`; used by tests), `--assistants a,b` (default: all, since there is no VS Code setting outside the extension).
- Vocabulary: scopes are `global` / `project` in the JSON (domain values) and documented as Global / Workspace in `--help` text.
- Nothing in the CLI prompts; anything that would need a confirmation is a plan/apply pair.
- Never reads or writes outside the known roots (`~/.ai-swissknife`, the workspace manifest dir, assistant config dirs through the adapters).

## Tasks

## Closed

### 46.1 - CLI skeleton + read-only commands (sources, catalog, installed, updates, item, plan-install)

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** CLI skeleton and read commands · **Size:** M · **Depends on:** 37.1, 44.1 · **Spec:** [46.1-cli-read-only.md](46.1-cli-read-only.md)
- **Goal:** Build the `vscode`-free `dist/cli.js` bundle (`ai-swissknife`) with pure JSON stdout and read-only commands `sources`, `catalog`, `installed`, `updates`, `item`, and `plan-install`.

### 46.2 - Agent-facing documentation: AGENTS.md block + `--help --json` self-description

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** CLI describe and agent docs · **Size:** S · **Depends on:** 46.1 · **Spec:** [46.2-agent-docs.md](46.2-agent-docs.md)
- **Goal:** Add the machine-readable `describe` command generated from command definitions and document the CLI contract and examples in `AGENTS.md`.

### 46.3 - Cross-process lock for manifest/state read-modify-write

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Cross-process state lock · **Size:** S · **Depends on:** - · **Spec:** [46.3-state-lock.md](46.3-state-lock.md)
- **Goal:** Implement `withStateLock` in `src/domain/stateLock.ts` with exclusive lock files and stale-lock recovery around manifest and state read-modify-write sequences.

### 46.4 - Write commands behind `--write`: apply-install, uninstall (soft), add/remove source

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** CLI write commands · **Size:** M · **Depends on:** 46.1, 46.3, 46.5, 47.1, 42.1 · **Spec:** [46.4-cli-writes.md](46.4-cli-writes.md)
- **Goal:** Add plan-first CLI write commands behind `--write` (`apply-install`, `uninstall`, `source add/remove`, `update`, and `trash list/restore/empty`).

### 46.5 - `redistribute <path|item>` v1 (installed from a local folder; plan-first, `--write`)

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Local-folder redistribute command · **Size:** M · **Depends on:** 46.1, 46.3, 47.1 · **Spec:** [46.5-redistribute.md](46.5-redistribute.md)
- **Goal:** Add `planRedistribute`/`applyRedistribute` and the CLI `redistribute` command to push edits from a registered `local-folder` source to all installed copies (plan-only without `--write`).
