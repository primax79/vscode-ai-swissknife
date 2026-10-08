# Study: a command for agents to redistribute a skill they have just edited

Status: **for owner evaluation**, nothing decided or scheduled. Trigger (owner, 2026-10-08): "I need a command available to agents to **redistribute skills when they modify them**". **Correction the same day:** my first reading (a hot-deploy / watch loop with dev markers for the developer) was wrong and is withdrawn; there is no watch mode and no dev-install marker in this study. The need: an agent edits a skill in its source folder and must be able to push that change to every installed copy with one non-interactive command.

## 1. What exists

- A `local-folder` source resolves a folder into packages/artifacts (`src/sources/localFolder.ts`); installing copies the translated files into each assistant's directories (adapters), records a managed installation and tracks drift (`modified-locally` against the installed baseline).
- The flows ask for a registered source first, then assistant(s) and scope, then conflict confirmations (the 37 flow will do multi-assistant x scope in one go; the 46 CLI will expose plan/apply).
- Claude Code itself can load a plugin straight from a directory for a session: `claude --plugin-dir <path>` (verified in `claude --help`), and `claude plugin marketplace add <local dir>` works with a directory (verified in the 45.1 spike).

## 2. What exists and what is missing for that need

- Installed copies are plain copies (adapters write the translated files into each assistant's directories); a managed installation remembers `sourceId` / artifact id and the content hash it was installed with; `local-folder` sources read the working tree (uncommitted edits included).
- Updating from the owner's point of view is initiative 47 (Update all) and the CLI of 46 (`update --all`), but those are designed around **registered sources** and a **pull** model (the installed copy checks its source). The agent's need is a **push** model with the folder as the source of truth, and it must work for copies it did not install through ai-swissknife (hand-made copies and links, see the wishlist in `specs/cli-wishlist-comparison.md`, items 1, 4, 5).
- Gaps: (1) no command that starts from "this folder changed" and finds every installed copy of its artifacts; (2) updates ask confirmations / need a registered source; (3) copies in several workspaces and in both assistants are not found in one call (multi-root scan, 48.1); (4) no per-copy report of what changed (old -> new, files changed).

## 3. Proposal: `redistribute`

> **Scope clarification (owner, 2026-10-08: "se installata da folder locale"):** version 1 applies **only to items that were installed from a local folder** (a `local-folder` source). Copies from any other origin, hand-made copies, links and name-matched look-alikes are **not touched** in v1. This removes the identity-matching and `stale`/`ahead` classification problems from the first version: the link between the folder and its installed copies is the recorded source, which we already store. Steps 2 and 5 below are the v1 behaviour; the broader matching (`--roots`, `ahead`, `unmatched`) is a later extension that belongs to initiative 48.

`ai-swissknife redistribute <path> [--item <name>...] [--assistants a,b] [--scope global|project|both] [--roots <dir>...] [--install-missing] [--write]` (46 contract: stdout JSON, non-interactive, **plan only without `--write`**, non-zero exit on failure).

1. **Read** the artifacts in `<path>` (skill dir, agent/command files, optionally a plugin folder), translated per assistant, as the installer does. In v1 the folder must already be the registered `local-folder` source of the installs (that is how the copies are found); `<path>` can be given instead of a source id and is resolved to it.
2. **Find the installed copies** (v1): the managed installations whose recorded `sourceId` is a `local-folder` source whose path is `<path>` (or contains it), in every scope and assistant (the Global state and the workspace given by `--workspace`). Each is classified by comparing the installed content hash with the folder's current one: `identical` (nothing to do), `stale` (the folder changed: overwrite), `modified-locally` (the installed copy was edited after install: listed, needs `--force`, and its previous version goes to the trash). Later extension (48): `--roots` and identity-matched copies with `ahead` / `unmatched`.
3. **Plan, then apply** with `--write`: per target `old hash -> new hash`, files added/changed/removed, and where the previous version was saved (the trash, restorable). Copies in places the assistant or scope has no copy of are listed as `missing`; they are installed only with `--install-missing`.
4. Output is one JSON document with `{ item, assistant, scope, path, classification, action, changedFiles, backupPath }` per target, so an agent can show or verify it.
5. Names that no longer exist in the folder (a renamed or removed skill) are reported as `orphan`, never deleted by this command (that is `replaces` / remove, wishlist items 2 and 6).

It is the same engine as Update all (47.1 `planUpdate`/`applyUpdateAll` with the folder as source) plus the multi-root scan and shadowing classification of initiative 48; no separate machinery.

## 4. Risks

- Overwriting a copy somebody changed independently: the `ahead` rule, the trash backup and plan-only default.
- Overwriting by name a copy that is not the same artifact: matching by identity must be shown in the plan; `unmatched` is never touched.
- An agent running it unattended: `--write` is explicit, `hook` / `mcp-server` kinds are refused without the second flag (46 rules).

## 5. Questions for the owner

Now task 46.5 (initiative 46). Originally asked in the chat message that accompanied this file: **DD-Q1** (retired, replaced by the correction above), **DD-Q2** the `modified-locally` rule: **decided** (same as UA-Q1 a: skip and list unless `--force`, previous version to the trash); **DD-Q3** also installing where a copy is missing: **decided by the architect (delegated)**: no by default, only with `--install-missing`; **DD-Q4** the command name and place: **decided by the architect (delegated)**: `redistribute` in the 46 family, v1 right after 47.1 and 46.4, before 48.
