# 48 — Maintainer features for the CLI — outline only

> Source: `specs/cli-wishlist-comparison.md` (wishlist of the skills-maintainer session, workspace task T012, 2026-10-08). **Outline: no task is specified in full and nothing is delegated until the owner decides the open points.** Depends on initiative 46 (CLI contract, read-only commands, writes behind `--write`, lock) and, for the update side, on 47.

| Task (outline) | Wishlist item | Size | Notes |
| --- | --- | --- | --- |
| [48.1](48.1-scan-roots.md) Multi-root scanning with ignore rules (**specified 2026-10-09**) | 5 | M | `--roots` repeatable, default ignore list, bounded depth; foundation of 48.3 and 48.5 |
| 48.2 `installed` flags: link vs copy, broken link, orphan (gone from source), installed twice | 3 | M | adapters currently skip symlinks silently; add `lstat`-based flags; new engine status for "artifact removed from source" |
| 48.3 Shadowing report: identical / stale / ahead / unique, and the `--force` guard before deleting ahead/unique | 4, 12 | L | stale vs ahead needs source history: hash the artifact at past commits of the source clone |
| 48.4 Doctor checks (Kilo-skip rules, name = folder, malformed metadata, duplicates across scopes) | 7 | M | builds on study B4 and 44.4 |
| 48.5 `replaces: [...]` on plugins, applied by update | 6 | M | **open decision**: where the field lives and who else must understand it |
| 48.6 Contribute back a local copy into a source checkout / mark intentionally local | 8 | S/M | natural for `local-folder` sources; never edit our git clone cache |
| 48.7 CLI sources: fetch all, N commits behind, pin | 10 | S | after 46.4 |
| 48.8 `redistribute <path|item>` **v1: only items installed from a local folder** (owner clarification 2026-10-08); the broader matching (`--roots`, identity-matched copies, `ahead`) is the later extension | owner request, see `specs/dev-deploy-study.md` | S for v1 (engine = 47.1 with the local-folder source), M for the extension (48.1 roots + 48.3 classification) | v1 does not wait for 48.1/48.3: it can ship right after 47.1 and 46.4 |
| (not scheduled) recorded per-assistant transforms | 9 | L | needs a design |
| (out of scope) skills-repo bump/release helper | 11 | - | belongs to the toolkit scripts / T007 |

Single-item `update <item>`, the "old commit -> new commit, files changed" report and CLI `trash list` / `restore` are small additions to **47.1/46.4/42.1** respectively and are recorded in the comparison, not here.
