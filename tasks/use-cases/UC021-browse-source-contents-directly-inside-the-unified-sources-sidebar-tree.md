# UC021 - Browse source contents directly inside the unified Sources sidebar tree

- id: UC021
- title: Browse source contents directly inside the unified Sources sidebar tree
- actor: User
- status: draft
- priority: P2
- linked-tasks: 28, 44
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: Unified Sources catalog tree

## Description & Business Value
Merges the Sources and Available sidebar trees so expanding a SourceItem directly reveals its resolved diagnostics, folder hierarchy, and installable artifacts, with per-source loading indicators and automatic catalog refresh when adding or removing a source. Source: tasks/specs/phase-7-spec.md §3.1

## Preconditions
- At least one source is registered in global or project scope.

## Scenario / Interaction Steps
1. The user expands the Sources view in the Activity Bar, seeing Recommended (if any) followed by Global Sources and Workspace Sources.
2. Expanding a SourceItem delegates to AvailableTreeDataProvider by composite (id, scope) identity to render resolver diagnostics, compact folders, and artifacts directly without a separate Available view.
3. Adding or removing a source automatically refreshes the catalog cache.

## Automated Verification Command
```bash
node --test out/ui/ui.test.js
```

## Acceptance Criteria
- [ ] `SourcesTreeDataProvider` renders `RecommendedGroupItem` (when non-empty) ahead of the Global and Workspace `ScopeGroupItem` nodes at the root level.
- [ ] Expanding a `SourceItem` resolves its children from `AvailableTreeDataProvider`'s cache using composite `(source.id, source.scope)` identity so two sources with the same ID in different scopes stay distinct.
- [ ] While a source is resolving, its node displays an independent loading state and fires a tree change event once resolution completes.

## AI Validation Log

