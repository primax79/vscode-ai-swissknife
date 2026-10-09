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
- **Read-only, except `redistribute --write`.** Every command except `redistribute` changes no manifest, state file or assistant configuration, and `redistribute` changes nothing unless you pass `--write` (without it, it prints the plan). One honest caveat: resolving a git source may create or refresh its clone under `~/.ai-swissknife/cache`, which is a cache and not user state.
- Nothing prompts. Scopes appear as `global` / `project` in the JSON (shown to humans as Global / Workspace).
- Global options: `--workspace <path>` (the Workspace scope root, default the current directory), `--home <path>` (the Global scope root, default your home), `--assistants a,b` (default all, e.g. `claude-code,kilo-code`).
- **Several workspaces in one call (read commands `installed`, `updates`, `item`)**: `--roots <dir...>` scans one or more root folders for workspaces (directories that contain `.claude/`, `.kilo/`, `.kilocode/`, `.vscode/ai-swissknife/` or `.ai-swissknife/`), up to `--max-depth <n>` levels (default 4), never following symlinks and skipping `node_modules`, `.git`, `worktrees`, `.kilo/worktrees`, caches, build output, `_attic`, `_deprecated`, `old`, `very_old` and similar (`--ignore <names...>` replaces that list, `--extra-ignore <names...>` adds to it). The Global scope is scanned once. With `--roots`, each item carries `workspace`, keys get an `@<workspace folder name>` suffix when more than one workspace is found, and the JSON gains `workspaces` and `skipped` (directories that could not be read). `--workspace` is ignored when `--roots` is used. Example: `$SWK_CLI installed --roots ~/works --max-depth 3`.
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
| `redistribute` | After you edit a skill/agent/command in a folder that is registered as a `local-folder` source, push the change to every installed copy that came from that folder (all assistants and scopes). **Plan only unless `--write`.** |
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

### Redistributing an edited skill (`redistribute`)

```bash
# 1. See what would change (nothing is written):
$SWK_CLI redistribute /path/to/my-skills-folder
# 2. Apply it:
$SWK_CLI redistribute /path/to/my-skills-folder --write
```

Rules (v1 handles **only items installed from a local folder**): each installed copy is classified `identical` (nothing to do), `stale` (the folder changed: it is updated), `modified-locally` (someone edited the installed copy: **skipped** unless `--force`, and then its previous version is saved to the trash first), `missing-on-disk`, or `orphan` (the artifact no longer exists in the folder: reported, **never deleted**). Copies from other origins, hand-made copies and links are not touched. Nothing is installed where there is no copy unless you pass `--install-missing` (with `--assistants` and `--scope`). `hook` and `mcp-server` items are refused unless `--allow-code-kinds` is also given. The output lists, per copy, `classification`, `action`, `oldHash` / `newHash`, `changedFiles` and `backupPath`.

Item keys look like `claude-code:global:skill:conflict-resolver` and come from `installed`.
