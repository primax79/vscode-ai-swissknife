# 48 — Maintainer features for the CLI — outline only

> Source: `specs/cli-wishlist-comparison.md` (wishlist of the skills-maintainer session, workspace task T012, 2026-10-08). **Outline: no task is specified in full and nothing is delegated until the owner decides the open points.** Depends on initiative 46 (CLI contract, read-only commands, writes behind `--write`, lock) and, for the update side, on 47.

## Tasks

### 48.1 - Multi-root scanning with ignore rules

- **Status:** `delivered` (merged e7c51e1 2026-10-09) · **Short:** Multi-root workspace scanning · **Size:** M · **Depends on:** 46.1 · **Spec:** [48.1-scan-roots.md](48.1-scan-roots.md)
- **Goal:** Add `findWorkspaces` and `scanInventoryAcrossRoots` in `src/engine/scanRoots.ts` plus `--roots`, `--max-depth`, `--ignore`, and `--extra-ignore` CLI options for scanning multiple workspaces in one call.

### 48.1b - Evaluate workspace-scan ignore rules relative to each root

- **Status:** `delivered` (merged ca0f1cd 2026-10-09) · **Short:** Relative workspace ignore rules · **Size:** XS · **Kind:** fix · **Depends on:** 48.1
- **Goal:** Evaluate `findWorkspaces` ignore rules (such as `.kilo/worktrees`) against paths relative to each scanned root rather than the absolute path so roots inside a worktree still scan properly.

### 48.2 - `installed` flags: link vs copy, broken link, orphan (gone from source), installed twice

- **Status:** `open` (outline only) · **Short:** Installed link and orphan flags · **Size:** M · **Depends on:** 46.1
- **Goal:** Add `lstat`-based flags to `installed` output for symlink vs. copy, broken links, duplicate installations across scopes, and orphan artifacts removed from their upstream source.

### 48.3 - Shadowing report: identical / stale / ahead / unique, and the `--force` guard before deleting ahead/unique

- **Status:** `open` (outline only) · **Short:** Shadowing classification report · **Size:** L · **Depends on:** 48.1, 48.2
- **Goal:** Classify copies across roots as `identical`, `stale`, `ahead`, or `unique` by hashing artifacts against past commits of the source clone, and require `--force` before deleting `ahead` or `unique` copies.

### 48.4 - Doctor checks (Kilo-skip rules, name = folder, malformed metadata, duplicates across scopes)

- **Status:** `open` (outline only) · **Short:** CLI doctor checks · **Size:** M · **Depends on:** 44.4, 46.1
- **Goal:** Add a CLI doctor command checking Kilo discovery skip rules, skill name vs. folder mismatch, malformed frontmatter metadata, and duplicate items across scopes.

### 48.5 - `replaces: [...]` on plugins, applied by update

- **Status:** `open` (outline only; open decision on where `replaces` lives and who else must understand it) · **Short:** Plugin replaces on update · **Size:** M · **Depends on:** 47.1, 48.1
- **Goal:** Support a `replaces: [...]` declaration on plugins/artifacts so updating automatically retires superseded artifact names.

### 48.6 - Contribute back a local copy into a source checkout / mark intentionally local

- **Status:** `open` (outline only) · **Short:** Contribute back local copy · **Size:** M · **Depends on:** 46.4
- **Goal:** Allow contributing a modified or local-only artifact back into a `local-folder` source checkout (never our git clone cache) or marking it as intentionally local.

### 48.7 - CLI sources: fetch all, N commits behind, pin

- **Status:** `open` (specified in 48.7-revision-gap.md, commit 8efb5a1) · **Short:** Revision gap and sources fetch · **Size:** S · **Depends on:** 46.1, 46.4, 44.1, 47.4 · **Spec:** [48.7-revision-gap.md](48.7-revision-gap.md)
- **Goal:** Enrich `updates` with `installedRevision`, `latestRevision`, `commitsBehind`, and `behindDays` via `src/engine/revisionGap.ts`, and add a `sources fetch` CLI command.

### 48.8 - `redistribute <path|item>` broader matching extension (`--roots`, identity-matched copies, `ahead`)

- **Status:** `open` (v1 local-folder shipped as 46.5 in 99a127c; broader extension outline only) · **Short:** Broaden redistribute across roots · **Size:** M · **Depends on:** 46.5, 48.1, 48.3
- **Goal:** Extend `redistribute` beyond v1's single-workspace `local-folder` copies to support `--roots` multi-workspace scanning, identity-matched copies, and `ahead` classification guards.

## Outlines and notes

| Task (outline) | Wishlist item | Size | Notes |
| --- | --- | --- | --- |
| [48.1](48.1-scan-roots.md) Multi-root scanning with ignore rules (**specified 2026-10-09**) | 5 | M | `--roots` repeatable, default ignore list, bounded depth; foundation of 48.3 and 48.5 |
| 48.2 `installed` flags: link vs copy, broken link, orphan (gone from source), installed twice | 3 | M | adapters currently skip symlinks silently; add `lstat`-based flags; new engine status for "artifact removed from source" |
| 48.3 Shadowing report: identical / stale / ahead / unique, and the `--force` guard before deleting ahead/unique | 4, 12 | L | stale vs ahead needs source history: hash the artifact at past commits of the source clone |
| 48.4 Doctor checks (Kilo-skip rules, name = folder, malformed metadata, duplicates across scopes) | 7 | M | builds on study B4 and 44.4 |
| 48.5 `replaces: [...]` on plugins, applied by update | 6 | M | **open decision**: where the field lives and who else must understand it |
| 48.6 Contribute back a local copy into a source checkout / mark intentionally local | 8 | S/M | natural for `local-folder` sources; never edit our git clone cache |
| [48.7](48.7-revision-gap.md) CLI sources: fetch all, N commits behind, pin | 10 | S | after 46.4 |
| 48.8 `redistribute <path|item>` **v1: only items installed from a local folder** (owner clarification 2026-10-08); the broader matching (`--roots`, identity-matched copies, `ahead`) is the later extension | owner request, see `specs/dev-deploy-study.md` | S for v1 (engine = 47.1 with the local-folder source), M for the extension (48.1 roots + 48.3 classification) | v1 does not wait for 48.1/48.3: it can ship right after 47.1 and 46.4 |
| (not scheduled) recorded per-assistant transforms | 9 | L | needs a design |
| (out of scope) skills-repo bump/release helper | 11 | - | belongs to the toolkit scripts / T007 |

Single-item `update <item>`, the "old commit -> new commit, files changed" report and CLI `trash list` / `restore` are small additions to **47.1/46.4/42.1** respectively and are recorded in the comparison, not here.

## Follow-ups found while verifying (2026-10-09)

- **48.1b (done 2026-10-09, merged)** — the ignore rules of `findWorkspaces` (notably the `.kilo/worktrees` segment pair) are applied to the **absolute** path, so a root that itself lives under such a path finds nothing (reproduced when the fixture sat inside a Kilo worktree). They should be evaluated on the path **relative to each root**. Small fix + test.
