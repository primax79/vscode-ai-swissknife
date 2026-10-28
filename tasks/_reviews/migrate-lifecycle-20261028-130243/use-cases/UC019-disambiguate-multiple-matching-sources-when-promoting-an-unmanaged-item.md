# UC019 - Disambiguate multiple matching sources when promoting an unmanaged item

- id: UC019
- title: Disambiguate multiple matching sources when promoting an unmanaged item
- actor: User
- status: draft
- priority: P1
- linked-tasks: 25
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: Disambiguate source on promote

## Description & Business Value
Collects all candidate sources across all five source types for each unmanaged item, hiding Promote when zero candidates exist, promoting directly when one candidate matches, and prompting via QuickPick when multiple sources match. Source: tasks/specs/phase-6-spec.md §4.4

## Preconditions
- An unmanaged artifact exists in an assistant directory and zero, one, or multiple registered sources contain a matching artifact.

## Scenario / Interaction Steps
1. scanInstalledInventory scans all five source types and collects every matching source/package/artifact candidate on ObservedArtifact.candidates.
2. If zero candidates match, Promote is hidden (observedArtifactItem:none) and no fake local-promotion sourceId is written.
3. If one candidate matches, Promote attributes provenance directly; if multiple candidates match (observedArtifactItem:many), the user picks the intended source in QuickPick, while bulk promoteAllIdentical skips multi-candidate items.

## Automated Verification Command
```bash
node --test out/engine/discovery.test.js
```

## Acceptance Criteria
- [ ] `scanInstalledInventory` attempts all five source types and populates `ObservedArtifact.candidates` with every matching candidate across all packages.
- [ ] `ObservedArtifactItem.contextValue` is set to `observedArtifactItem:none`, `:one`, or `:many` so `Promote` is hidden when zero candidates exist.
- [ ] Bulk `promoteAllIdentical` promotes only single-candidate items and skips items with multiple candidates for individual QuickPick disambiguation.

## AI Validation Log

