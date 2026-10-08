# Study: a "disabled" state for installed items

Status: **for owner evaluation**, nothing decided or scheduled. Origin: owner idea (2026-10-08): disable an item without uninstalling, e.g. by moving it into a `_disabled/` subfolder containing `skills/`, `agents/`, etc.
Grounded in: `src/adapters/{claude,kilo}.ts` (path layout), the real Kilo discovery code `kilocode-dev/packages/opencode/src/{skill/index.ts,config/agent.ts,config/command.ts}`, `references/claude/claude-code/CHANGELOG.md`, `src/engine/softDelete.ts`. Claude Code's own discovery rules for nested folders were **not** verifiable from the references, so they are listed as a spike.

## 1. Goal and non-goals

Goal: take an item out of an assistant's active set and bring it back later, losslessly, without uninstalling (no loss of provenance, no re-download), per place (assistant × scope).
Non-goals: partial disabling (e.g. "manual invocation only", which Claude already has as the `disable-model-invocation` frontmatter flag: a different feature), per-session toggles, disabling at the assistant's own UI level.

## 2. Facts that constrain the design

1. **Kilo scans recursively.** Skills: `{skill,skills}/**/SKILL.md`; agents: `{agent,agents}/**/*.md`; commands: `{command,commands}/**/*.md` (`skill/index.ts:30-32`, `config/agent.ts:31`, `config/command.ts:32`). A `_disabled/` folder **inside** `.kilo/skills/` would still be discovered. The folder must be *outside* the scanned subtree: the patterns are rooted at the config dir, so `.kilo/_disabled/skills/<name>/` does **not** match `skills/**`. (One exception: user-configured extra skill paths use `**/SKILL.md`; a disabled folder placed under such a path would be found. Not our layout.)
2. **Claude Code**: our adapter reads exactly `~/.claude/skills/<name>/SKILL.md` and `.claude/{agents,commands}/<file>.md` one level deep (`claude.ts:364-500`). Whether Claude Code itself descends into subfolders of `skills/` is unverified; a sibling `.claude/_disabled/` avoids the question as long as Claude does not scan arbitrary children of `.claude/`.
3. **Not everything is a file.** `mcp-server` and `hook` entries live inside JSON config files, and `rule` is a merged block of a markdown file (CLAUDE.md / AGENTS.md); there is nothing to move. Claude has a native flag for MCP (`disabledMcpServers` / `enabledMcpServers` in `.claude.json`, per its changelog); the other assistants are unverified.
4. The extension already has the trash pattern `_deleted/<kind>/<name>-<timestamp>/` under the `.ai-swissknife` root (`softDelete.ts`) and a state file (`state.json`, with `schemaVersion`) tracking managed installations with their `path`.

## 3. Options for file-based kinds (skill, agent, command)

| Option | Layout | Pros | Cons |
| --- | --- | --- | --- |
| **A. Sibling of the scanned dir, per assistant root** (owner's idea, refined) | `<assistant root>/_disabled/<kind>/<name>` e.g. `.kilo/_disabled/skills/foo/`, `~/.claude/_disabled/agents/bar.md` | Matches the idea; human-visible and obvious in the file tree; enable = move back; works without extension state | Must be verified per assistant that nothing scans it (Kilo: safe by pattern rooting; Claude/Codex/Gemini/Copilot: spike); creates a new folder inside tool-owned dirs |
| B. Under `.ai-swissknife`, like the trash | `<.ai-swissknife>/_disabled/<assistant>/<kind>/<name>` | Zero chance of any assistant discovering it; same pattern as `_deleted` | Hidden from the user's view of the assistant dir; global vs project root split; the project one lives in the repo (needs the gitignore rule `gitignore.ts` already manages) |
| C. Subfolder **inside** the kind dir (`skills/_disabled/foo`) | | simplest | **Rejected**: Kilo's `**` globs still discover it (fact 1). |
| D. Rename in place (`SKILL.md` → `SKILL.md.disabled`, `foo.md` → `foo.md.disabled`) | | atomic, no new folders | Skills: Kilo/Claude look for `SKILL.md`, so a rename works for skills; for agents/commands the `*.md` glob would no longer match `*.md.disabled`. Fragile for multi-file skills (references/ still present), and pollutes drift hashing |

**Recommendation: A for files**, with B as the fallback for any assistant the spike shows to scan the sibling. Both are "move, not copy", so enabling is `rename` back to the recorded original path.

## 4. Options for non-file kinds (mcp-server, hook, rule)

- **Stash-and-restore**: remove the entry from the config file and keep its exact JSON/block in the extension's own record (`state.json` `disabled` section or a file under `_disabled/<kind>/<name>.json`), re-insert on enable. Works for every assistant, reuses the adapters' existing write paths (including rollback).
- **Native flag** where one exists (Claude MCP `disabledMcpServers`): preferred because the user can also see/toggle it in the tool; unverified for the others.
Recommendation: stash-and-restore as the universal mechanism; native flag as an optimization per adapter later. Out of the first iteration if it threatens scope: ship files first (skills/agents/commands are what the owner named).

## 5. State, discovery and UI consequences

- **State model**: a place gets a lifecycle flag `disabled`. For managed installations, set `disabled: true` and update `path` to the `_disabled` location (state `schemaVersion` bump + migration). For **unmanaged** items nothing tracks them, so the layout itself must be self-describing: `_disabled/<kind>/<name>` under an assistant root encodes assistant, scope (which root) and kind.
- **Inventory/discovery** must also scan the `_disabled` locations and report those items as state `disabled` (new state in the place model of initiative 40.1, and a badge, e.g. muted/strikethrough, with the same icons).
- **Interactions to define**: Update on a disabled managed item (proposal: update in place and stay disabled), drift (`missing-on-disk` must not fire for a disabled path), "install elsewhere" (a disabled place counts as present), Uninstall/Delete work on disabled items (trash `_deleted` as usual), Copy/Move of a disabled item (proposal: result is enabled in the target unless the user chooses otherwise), name collisions on enable (a same-name active item exists: prompt, never overwrite silently).
- **Actions**: `Disable` / `Enable` as one toggle action (see `specs/actions-study.md`; no registry, buttons added by hand), available on place rows (icon) and in the detail bar, plus a bulk "disable all in this environment" once bulk selection exists.
- **Atomicity**: disable/enable are a single `rename` (same filesystem: always true, both under the same root); on failure nothing changes; state is written after the move with rollback of the move if the state write fails (the install engine already has this pattern in `applyInstall`).

## 6. Risks

- An assistant that scans a broader tree than documented would keep loading "disabled" items: mitigated by the spike and the B fallback, and by a test per adapter.
- Tools that watch their config dirs may react to the moves (e.g. Kilo's file watchers): not harmful, but should be checked.
- Users who browse `.claude`/`.kilo` by hand will see `_disabled`: acceptable, arguably desirable.

## 7. Suggested path (for evaluation)

1. **Spike first** (research task, no product code): for each of Claude Code, Kilo, Codex CLI, Gemini CLI, Copilot, verify that an item placed at `<assistant root>/_disabled/<kind>/<name>` is **not** loaded, and note any native disable mechanism; verify Kilo's watchers; record results in a findings file. Gates everything else (same pattern as spikes 19.1 / 21.1).
2. File-based kinds: layout A (or B per spike), state flag + migration, inventory scan, `Disable/Enable` action, badge.
3. Non-file kinds via stash-and-restore, one adapter at a time.
4. Bulk disable per environment, after bulk selection.

## 8. Questions for the owner

**D-Q1.** ~~Layout A~~ **answered a (2026-10-08)**: layout A, B as fallback. Layout A (sibling `_disabled` per assistant root, your idea) with B as fallback if the spike finds a problem: OK?
**D-Q2.** ~~First iteration~~ **answered a**: first iteration only skills/agents/commands. First iteration limited to skills/agents/commands, with mcp/hook/rule deferred: OK?
**D-Q3.** ~~Do you want~~ **answered a**: shown, muted, with a Disabled filter pill. Do you want a disabled item to keep showing in the Dashboard tree (muted, with Enable) or be hidden behind a filter? (Proposal: shown, muted; a Membership-style pill "Disabled" in the filter bar.)
**D-Q4.** ~~Should~~ **answered a**: partial/manual-only mode is out of scope. Should "disable" ever be partial (the Claude `disable-model-invocation` "manual only" mode)? Proposal: separate idea, out of this study.

All four answered; work captured in initiative 43.
