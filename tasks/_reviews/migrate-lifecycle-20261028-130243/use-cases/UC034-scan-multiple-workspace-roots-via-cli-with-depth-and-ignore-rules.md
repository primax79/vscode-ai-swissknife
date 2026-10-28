# UC034 - Scan multiple workspace roots via CLI with depth and ignore rules

- id: UC034
- title: Scan multiple workspace roots via CLI with depth and ignore rules
- actor: Operator
- status: draft
- priority: P2
- linked-tasks: 48
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: CLI multi-root workspace scan

## Description & Business Value
Allows an operator or maintainer agent to run CLI read commands (installed, updates, item) across multiple root directories in one call (--roots <dir...>), discovering workspaces up to --max-depth without following symlinks and skipping ignored folders (node_modules, .git, .kilo/worktrees, _attic, old, etc.) relative to each root. Source: tasks/specs/cli-wishlist-comparison.md §Wish 5

## Preconditions
- One or more parent directories containing project workspaces exist.

## Scenario / Interaction Steps
1. The operator runs node dist/cli.js installed (or updates / item) with --roots <dir...> and optional --max-depth, --ignore, or --extra-ignore flags.
2. findWorkspaces walks each root up to maxDepth (default 4) without following symlinks, evaluating ignore rules relative to each root and recording unreadable directories in skipped.
3. Global scope is scanned once, workspace items carry a workspace path field and @<workspace> key suffixes when multiple workspaces are found, and item resolves suffixed keys.

## Automated Verification Command
```bash
node --test out/engine/scanRoots.test.js out/cli/scanRoots.test.js
```

## Acceptance Criteria
- [ ] `findWorkspaces` discovers workspaces up to `--max-depth` (default 4), never follows symlinks, and evaluates ignore rules (`node_modules`, `.kilo/worktrees`, `_attic`, `old`, etc.) relative to each root rather than the absolute path.
- [ ] Unreadable directories are reported in the `skipped` array without failing the command.
- [ ] With `--roots`, Global scope is scanned once, keys gain an `@<workspace>` suffix only when more than one workspace is found, and `item` resolves workspace-suffixed keys.

## AI Validation Log

