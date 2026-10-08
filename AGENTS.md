# AI Swissknife for agents: command-line interface

AI Swissknife ships a read-only command-line interface so that agents and scripts can inspect what is installed where, what has updates and what an installation would do, without VS Code running. Everything is **English, JSON on stdout**.

## Locate the CLI

```bash
# Inside the installed VS Code extension (macOS / Linux, bash or zsh):
export SWK_CLI='node ~/.vscode/extensions/alfredooliviero.ai-swissknife-*/dist/cli.js'
# From a checkout of this repository after `npm run build`:
export SWK_CLI='node dist/cli.js'
$SWK_CLI <command> [options]
```

## Key rules

- **stdout is exactly one JSON document.** Parse stdout only; **stderr is logs**, ignore it.
- On failure the exit code is non-zero and stdout holds `{ "error": { "code": "...", "message": "..." } }`. Codes: `INVALID_ARGUMENT`, `NOT_FOUND`, `SOURCE_RESOLUTION_FAILED`, `INTERNAL`.
- **Read-only.** No command changes any manifest, state file or assistant configuration. One honest caveat: resolving a git source may create or refresh its clone under `~/.ai-swissknife/cache`, which is a cache and not user state. Write commands do not exist yet.
- Nothing prompts. Scopes appear as `global` / `project` in the JSON (shown to humans as Global / Workspace).
- Global options: `--workspace <path>` (the Workspace scope root, default the current directory), `--home <path>` (the Global scope root, default your home), `--assistants a,b` (default all, e.g. `claude-code,kilo-code`).
- `$SWK_CLI describe` prints a machine-readable description of every command, option and output shape (generated from the same definitions as the commands themselves).

## Commands

| Command | What it returns |
| --- | --- |
| `sources` | Registered sources of both scopes |
| `catalog` | Artifacts available from the sources (per-source failures are reported inside `diagnostics`, not as a global failure) |
| `installed` | Managed and observed (unmanaged) items with assistant, scope, path and match against a source |
| `updates` | Drift per managed item: `up-to-date`, `update-available`, `modified-locally`, `modified-and-update-available`, `missing-on-disk` |
| `item` | Details of one item by key: origin, other places it is installed in, whether a diff exists (`--diff` includes a size-capped unified diff) |
| `plan-install` | What installing an artifact would do per assistant and scope (new / conflict / unsupported). **Never applies anything.** |
| `describe` | The machine-readable description of all commands |

## Examples

```bash
# 1. What is installed where (Claude Code, global scope)?
$SWK_CLI installed --assistants claude-code --scope global

# 2. What has an update?
$SWK_CLI updates

# 3. What would installing an artifact do in two assistants and both scopes?
$SWK_CLI plan-install --source team-skills --artifact gitignore --assistants claude-code,kilo-code --scopes global,project
```

Item keys look like `claude-code:global:skill:conflict-resolver` and come from `installed`.
