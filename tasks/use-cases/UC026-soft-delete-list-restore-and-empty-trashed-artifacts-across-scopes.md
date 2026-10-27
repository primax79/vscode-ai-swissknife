# UC026 - Soft-delete, list, restore, and empty trashed artifacts across scopes

- id: UC026
- title: Soft-delete, list, restore, and empty trashed artifacts across scopes
- actor: User
- status: draft
- priority: P1
- linked-tasks: 39, 42
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: Trash list, restore, empty

## Description & Business Value
Moves uninstalled or overwritten artifacts into .ai-swissknife/_deleted/ with sidecar origin metadata and allows the user to list, restore to the original path (refusing conflicts), or permanently empty the trash per scope. Source: tasks/specs/actions-study.md §2, §5

## Preconditions
- One or more artifacts have been soft-deleted or backed up into .ai-swissknife/_deleted/.

## Scenario / Interaction Steps
1. Uninstalling or overwriting an artifact moves it to .ai-swissknife/_deleted/<kind>/<name>-<timestamp>/ with a sidecar recording its origin path, assistant, and scope.
2. The user runs Restore from Trash (or uses the CLI trash commands) to inspect trashed entries newest-first across global and workspace scopes.
3. Selecting an entry restores its files byte-identically to the original path (refusing if the path already exists), or Empty Trash permanently deletes entries for the selected scope.

## Automated Verification Command
```bash
node --test out/engine/softDelete.test.js out/ui/ui.test.js
```

## Acceptance Criteria
- [ ] `softDeletePath` writes a sidecar metadata file alongside the moved item under `.ai-swissknife/_deleted/` and handles cross-device (`EXDEV`) moves safely.
- [ ] `listTrash` returns entries with their sidecar origin (or `origin unknown` when absent), and `restoreFromTrash` restores files byte-identically while refusing to overwrite an existing target path.
- [ ] `emptyTrash` removes only the requested scope's trash entries and reports per-entry failures without aborting the remaining deletions.

## AI Validation Log

