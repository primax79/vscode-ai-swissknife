# UC027 - Batch-update all outdated managed items while protecting local edits

- id: UC027
- title: Batch-update all outdated managed items while protecting local edits
- actor: User
- status: draft
- priority: P1
- linked-tasks: 47
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: Update all outdated items

## Description & Business Value
Updates all managed installations with available upstream updates in one batch (resolving each source once), skipping locally modified items by default unless the user explicitly opts in to back them up to the trash and overwrite. Source: tasks/specs/actions-study.md §2, §6

## Preconditions
- Multiple managed installations exist, some with upstream updates and some with local modifications.

## Scenario / Interaction Steps
1. The user triggers Update All globally, for one assistant environment, or for the active Dashboard filter.
2. planUpdateAll resolves each referenced source at most once and classifies items into updateable, skippedModified, and cannotUpdate.
3. A summary modal presents counts and offers updating only clean outdated items or also overwriting locally modified items (backing up their current version to _deleted/ first).

## Automated Verification Command
```bash
node --test out/engine/update.test.js out/ui/ui.test.js
```

## Acceptance Criteria
- [ ] `planUpdateAll` resolves each shared upstream source once across drift checking and update planning, and supports filtering by `scope`, `assistant`, `sourceId`, and `kind`.
- [ ] Locally modified outdated items are placed in `skippedModified` by default and are only updated when `includeModified: true` is passed, after backing up the previous local version to `_deleted/`.
- [ ] A failure on one item during `applyUpdateAll` never stops remaining items from being updated, and items with missing sources or `missing-on-disk` status are reported in `cannotUpdate`.

## AI Validation Log

