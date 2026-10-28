# Input from the skills-maintainer session (2026-10-08): answers to the CLI wishlist comparison

Context: reply to `tasks/specs/cli-wishlist-comparison.md`. Original wishlist: `/Users/Alfredo/works/ai-coding-tools/tasks/tooling/notes/swissknife-cli-wishlist-2026-10-08.md` (task T012 of the ai-coding-tools workspace). Nothing here is decided; the owner decides.

## 1. Stale vs ahead (item 4): provenance commit makes the source history unnecessary

The gap noted ("stale vs ahead needs the source history") closes if the install records the source commit it came from (provenance you already have). Classify a local copy by comparing it with the source file AT THAT COMMIT, and the source HEAD:

| local vs source@installed-commit | local vs source@HEAD | class |
| --- | --- | --- |
| equal | equal | identical (safe to delete if a global copy exists) |
| equal | different | stale (the source moved on; local was never edited) |
| different | equal | converged (someone put the edit upstream; safe to delete) |
| different | different | ahead/diverged (local was edited: upstream candidate, needs a human) |

When there is no provenance (a copy made by hand), fall back to a normalised body comparison: strip the frontmatter, normalise dash characters and trailing whitespace, then compare line sets. That fallback is what I used by hand on 32 skills; it separated "only frontmatter/format differs" from "real content differs" well. Report the two kinds separately.

## 2. Scan scope: unmanaged user-level folders count

The six stale gCube documentation skills lived as plain directories in `~/.claude/skills` (not links, not from any plugin). Claude Code loads that folder next to the plugin skills, so the old and the new skill competed for the same task. A scan that only reads plugin caches would have missed them. The user-level skill folders of each client (`~/.claude/skills`, `~/.kilo/skills`, agents folders `~/.claude/agents`, `~/.kilo/agent`) must be scanned and reported as `unmanaged` with a name match against managed items.

## 3. `replaces` (item 6): where the field lives

Suggestion: in the plugin manifest of the SOURCE (the plugin that now ships the replacement), e.g. `replaces: ["gcube-readme-updater", ...]`, because only the source knows about the rename. The CLI reads it from the source when it updates and removes the named items (skills and agents) in every scanned scope and root, after showing the plan. Not in the installed item: the old item is gone from the source, so nothing there can say it is obsolete. Real case: 6 skills + 1 agent, left behind in the user folder, three workspaces and a project repo.

## 4. Links (item 3)

You install by copy, so for ai-swissknife itself links do not exist. They still matter for the migration: Kilo's old plugin manager left ~38 symlinks in `~/.kilo/skills` pointing into git clones under `~/.kilo/marketplaces`. To retire that manager the CLI needs a one-off "adopt or replace links" action: report links (and broken ones), and convert a link into a copy with provenance, then optionally remove the clone. Without it the old links keep shadowing what the extension installs.

## 5. Recorded transforms (item 9)

Real examples of per-assistant differences to design against: a skill whose local Kilo copy had a malformed `metadata: ""` block that the global copy fixed; a script path that differs per assistant inside the same SKILL.md (`.claude/skills/...` vs `.kilo/skills/...`). A transform recorded in the source (a small declarative rewrite, e.g. path prefix substitution) is preferable to patching installed files.

## 6. Agreement with your recommendation on item 11

Keep the bump/release helper out of ai-swissknife. One related fix was made today in the toolkit (`scripts/bump_version.py` now turns `[Unreleased]` into the new version instead of renaming the last release).

## 7. Reproducible cases for acceptance tests

- Update of a plugin whose manifest version was not bumped (content changed, version equal): must be detected.
- Shadowing on `/Users/Alfredo/works/gcube/porting_liferay` (32 project skills in `.claude/skills` and `.kilo/skills`): 7 identical to the toolkit, 13 different, 12 only in the project.
- Removal of `gcube-readme-updater` and the other five from a user folder with trash and restore.

---
**Smistata il 2026-10-27 (ai-coding-tools-d8).** Contenuto già distribuito:
- §1 stale/ahead con il commit di provenienza, §7 versione non incrementata: iniziativa 49 (spec
  `install-provenance-and-update-detection.md` §2 e caso 7) e 48.3 (report di classificazione dello shadowing).
- §2 cartelle utente non gestite, §4 link da adottare: 48.2 (flag link e orfani).
- §3 `replaces`: 48.5. Rimozione con cestino: iniziativa 42 (archiviata).
- §5 trasformazioni registrate per assistente: fuori ambito della 49 (spec §7), non pianificate.
- §6: nessuna azione.
