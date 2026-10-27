# Spec — Install provenance and update detection

> **Status:** Draft v1 (2026-10-27), approved in principle by the owner ("si" to the proposal below).
> **Drives initiative:** 49 (`tasks/49-install-provenance/plan.md`).
> **Supersedes for update detection:** the comparison rules of initiative 13 (Drift & update detection) and the
> source lookup used by 47 (Update all). Initiative 13's local-drift check stays.
> **Input:** owner proposal (2026-10-27): "record the commit an installation comes from and a sha of the text actually
> installed, so we can say: I installed this skill, from this commit, and what is installed has this sha";
> `tasks/_inbox/to-analyze/2026-10-08-skills-maintainer-input.md` §1 and §7 (stale vs ahead, unbumped versions).

## 0. Why this exists

Skills installed a minute ago show **Update** in every column (Kilo/Claude, project/global). Four fixes so far
(d61fdd1, 2f949cc, 0840192, 41a4fb4) treated symptoms. A read-only study on HEAD 41a4fb4 (2026-10-27) found the
causes, ranked:

1. **Source identity is only the id.** `ManagedInstallation` stores `sourceId` without scope or location
   (`src/domain/types.ts:95-109`). On this machine the ids `ai-orchestration`, `kilo-mcp`, `gcube-ai-toolkit` exist
   twice: as local-folder sources in the global manifest (`~/.ai-swissknife/manifest.json`, pointing at the working
   copies under `~/works/ai-coding-tools/`) and as git-marketplace sources in the workspace manifest. The Dashboard,
   `pendingCounts` and `installedView` merge both lists and take the first id match, always the global local folder
   (`src/ui/dashboard.ts:604-622, 725-812`, `src/engine/pendingCounts.ts:60-90`, `src/ui/installedView.ts:480, 602`).
   Items installed from the git source are compared with the working copy (289 commits ahead): every one shows Update.
   The CLI compares global items only with global sources (`src/cli/commands.ts:397-415, 433-453`), so CLI and UI
   disagree. The git cache is keyed by id only (`src/sources/gitProcess.ts:88-92`), so same-id sources of different
   workspaces share a clone.
2. **Local-folder sources are compared with the live working tree** (`src/sources/localFolder.ts:260`) and record no
   commit: any uncommitted edit in the source folder shows as Update, and "installed from X" cannot be shown.
3. **Catalog commit vs check commit.** Install checks out the commit resolved when the catalog loaded; the check
   fetches again and resets to `origin/<default>` (`src/sources/gitMarketplace.ts:100-131, 374-387`,
   `gitCustom.ts`). A remote move in between is a real update, but it is invisible why.
4. **Artifact match by name.** `checkForUpstreamUpdate` matches `artifactId` OR (kind and name), first hit
   (`src/engine/drift.ts:334-347`; same in `planUpdate`, `src/engine/update.ts` ~159-161): two plugins with a skill of
   the same name can be compared crosswise.

What already works and stays: the install re-reads what it wrote and refuses unless its canonical hash equals the
recorded `contentHash` (`src/engine/apply.ts:1102-1107, 1179-1184`); local-drift detection compares the disk with
`contentHash` (`src/engine/drift.ts:55-215`). The canonical hash (`src/adapters/codec.ts:145-188`) ignores the
frontmatter `metadata` block and covers file paths, contents and mode bits.

## 1. Provenance record (what every installation stores)

Extend `ManagedInstallation` (backward compatible, all new fields optional when reading old state):

| field | meaning |
| --- | --- |
| `source` | `{ id, scope: 'global' \| 'workspace', type, location }`: `location` = git URL (+ subpath) or absolute folder path. Replaces lookups by bare `sourceId` (kept for old readers). |
| `artifactId` | exact artifact id (exists; becomes mandatory for matching). |
| `sourceRevision` | `{ commit, requestedRef, dirty? }` for every source that is a git repo, **including local folders** (`git rev-parse HEAD` in the folder; `dirty` from `git status --porcelain` limited to the artifact's path). Empty only for non-git sources. |
| `sourceContentHash` | canonical hash of the translated artifact at `sourceRevision` (= what install was asked to write). |
| `contentHash` | canonical hash of what is on disk after install (exists). Equal to `sourceContentHash` today; kept separate so a future per-assistant transform (recorded patch, path rewrite) does not break the comparison. |
| `installedAt` | exists. |

This is the owner's proposal: "from commit C" = `sourceRevision.commit`, "installed text has sha H" = `contentHash`.

## 2. Status computation

Three comparisons, each answering one question:

| question | compares | result |
| --- | --- | --- |
| Edited here? | hash(disk) vs `contentHash` | `modified-locally` when different |
| Source moved? | source's current commit vs `sourceRevision.commit` | fast path: same commit and not dirty -> no update, no translation needed |
| Does the move matter for this item? | `sourceContentHash` vs canonical hash of the translated artifact at the source's current commit | `update-available` when different; a commit that does not touch the item is not an update |

States shown: `up-to-date`, `update-available`, `modified-locally`, `modified-and-update-available`, plus
`source-unavailable` (source removed, unreachable, artifact gone) and `provenance-unknown` (old installation that
cannot be attributed, see §5). Every state carries its evidence for the UI tooltip and `--explain`:
"installed from `ai-orchestration` (workspace, git …) @ b10916a, source now @ c7cefa6, item changed".

With provenance, the 2026-10-08 classification of a copy also becomes available (copy vs source@installed-commit and
vs source@HEAD: identical / stale / converged / ahead); it uses `git show <commit>:<path>` in the source clone and is
in scope for the CLI report, not the badge.

## 3. Source resolution rules

1. An installation is checked against **its** source (`source.scope` + `source.id`, verified by `type`/`location`),
   never the first id match. If the recorded source no longer exists in its scope: `source-unavailable`, with a hint
   when a same-id source exists in the other scope ("re-link to …" action, explicit, never automatic).
2. The git cache key includes a hash of the location: same id, different URL, different clone.
3. Local-folder sources that are git repos are read **at their committed HEAD** (`git archive`/`git show`), not the
   working tree, by default; a per-source option `readWorkingTree: true` restores today's behaviour for people who
   want to install uncommitted work, and then `dirty` is recorded and shown.
4. Check and install use the same resolution: the check re-resolves the ref (fetch) and compares commits; the install
   resolves at install time (not the catalog-load commit), so a just-installed item is up to date by construction.
5. Artifact match by exact `artifactId`; the kind+name fallback is removed (an artifact that changed id is
   `source-unavailable` with a "same name found: …" hint).

## 4. UI and CLI

- Dashboard and sidebar use one engine function for status (no UI-side source merging); CLI uses the same function.
  A test asserts CLI and UI give the same state for the same fixture.
- Row tooltip / detail panel: source (id, scope, location), installed commit, current commit, both hashes, state and
  reason. CLI: `status --explain <item>` prints the same.
- Update and Update all (47) act only on `update-available` / `modified-and-update-available` (the latter with the
  backup of 47.1).

## 5. Migration of existing state

On first load of an old `state.json`: for each installation with only `sourceId`, look for sources with that id in
both scopes; if exactly one source's current artifact hashes to `contentHash` at some reachable commit (try the cached
clone HEAD and the source HEAD), adopt it; otherwise mark `provenance-unknown` and offer "re-link" (pick the source)
or "reinstall". Never guess silently. Write the migrated state with a backup of the old file.

## 6. Acceptance (regression tests first, they fail on HEAD 41a4fb4)

1. Install from a git source, check immediately: `up-to-date` (UI path and CLI path).
2. Same id as local-folder (global) and git (workspace), install from the git one: check uses the git one,
   `up-to-date`; editing the local folder does not change it.
3. Local-folder git source with an uncommitted edit: default `up-to-date` (committed HEAD); with `readWorkingTree`,
   `update-available` with `dirty` shown.
4. Commit in the source that does not touch the item: `up-to-date`, commits shown as different.
5. Commit that changes the item: `update-available`; after Update: `up-to-date`, new commit recorded.
6. Two plugins with a same-name skill: each installation compared with its own artifact.
7. Content changed with unchanged plugin version (2026-10-08 note §7): detected.
8. Old state file: migrated or `provenance-unknown`, never a false `update-available`.

## 7. Non-goals

Per-assistant transforms (recorded patches, path rewrites: 2026-10-08 note §5) and `replaces` (note §3) are separate
work; this spec only keeps `contentHash` and `sourceContentHash` apart so they fit later.
