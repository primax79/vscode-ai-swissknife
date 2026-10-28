# UC022 - Browse installed and unmanaged items grouped by kind in the sidebar

- id: UC022
- title: Browse installed and unmanaged items grouped by kind in the sidebar
- actor: User
- approval: proposed
- priority: P2
- linked-tasks: 28.1, 28.2
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: Installed tree kind grouping

## Description & Business Value
Adds a collapsible KindGroupItem level (Skills, Agents, Commands, MCP Servers, Hooks, Rules) inside each assistant/scope group and unmanaged group in the Installed sidebar tree, omitting empty kind groups. Source: tasks/specs/phase-7-spec.md §3.2

## Preconditions
- Items of one or more kinds are installed or discovered in an assistant and scope.

## Scenario / Interaction Steps
1. The user expands an assistant and scope group in the Installed tree view.
2. InstalledTreeDataProvider renders a KindGroupItem for each non-empty kind in stable declaration order with its kind icon and item count.
3. Expanding a KindGroupItem shows the managed or unmanaged items of that kind with their drift badges and context menu actions.

## Automated Verification Command
```bash
node --test out/ui/ui.test.js
```

## Acceptance Criteria
- [ ] `InstalledTreeDataProvider` groups children under each scope group into one `KindGroupItem` per kind present in stable `ItemKind` order (`skill`, `agent`, `command`, `mcp-server`, `hook`, `rule`).
- [ ] Absent kinds produce no empty `KindGroupItem` folders.
- [ ] `KindGroupItem` nodes carry a disambiguated `parentKey` and reuse the standard per-kind `ThemeIcon` mapping.

## AI Validation Log

