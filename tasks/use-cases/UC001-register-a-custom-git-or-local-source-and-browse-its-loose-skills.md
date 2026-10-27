# UC001 - Register a custom Git or local source and browse its loose skills

- id: UC001
- title: Register a custom Git or local source and browse its loose skills
- actor: User
- status: draft
- priority: P1
- linked-tasks: 02, 04, 07
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: Register source and browse skills

## Description & Business Value
Allows a developer to register a private/custom Git repository or local folder containing loose skills (directories with SKILL.md, no marketplace manifest required) at global or project scope and browse detected artifacts with pin support (branch, tag, or commit). Source: tasks/specs/foundations.md §Goal

## Preconditions
- A local directory or Git repository containing one or more SKILL.md directories exists.

## Scenario / Interaction Steps
1. The user adds a git-custom or local-folder source in global or project scope (optionally specifying a branch, tag, or commit pin).
2. The extension saves the desired source in manifest.json using workspace/home-relative paths for local folders.
3. The resolver clones/fetches the Git repo (serialized by per-directory mutex) or walks the local folder without requiring a marketplace manifest.
4. Detected skills (root SKILL.md or nested skill directories) and any diagnostics are returned for browsing in the catalog.

## Automated Verification Command
```bash
node --test out/sources/gitCustom.test.js out/sources/localFolder.test.js
```

## Acceptance Criteria
- [ ] Format detection handles both a single-skill repository (`SKILL.md` at root) and nested directories containing `SKILL.md` without requiring a marketplace manifest.
- [ ] `git-custom` resolver supports default branch, specific branch, tag, and commit pins, recording exact `ResolvedRevision` provenance.
- [ ] Concurrent Git operations on the same source cache directory are serialized by a per-directory mutex (`gitCustomMutex`).
- [ ] Auxiliary files alongside `SKILL.md` in a skill directory are preserved with their relative paths and file modes during content resolution.

## AI Validation Log

