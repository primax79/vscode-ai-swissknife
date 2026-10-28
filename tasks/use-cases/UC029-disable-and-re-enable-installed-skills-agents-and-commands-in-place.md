# UC029 - Disable and re-enable installed skills, agents, and commands in place

- id: UC029
- title: Disable and re-enable installed skills, agents, and commands in place
- actor: User
- approval: proposed
- priority: P2
- linked-tasks: 43.1, 43.2, 43.3, 43.4
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: Disable and enable items

## Description & Business Value
Allows temporarily taking an installed skill, agent, or command out of an assistant's active set by atomically moving it into a sibling _disabled/<kind>/<name> folder and re-enabling it losslessly later without losing provenance or triggering false missing-on-disk drift. Source: tasks/specs/disabled-state-study.md §3, §5

## Preconditions
- A managed or unmanaged skill, agent, or command is installed in an assistant that supports disable (Kilo Code or Claude Code).

## Scenario / Interaction Steps
1. Executing disable moves the skill directory or agent/command file to <assistant root>/_disabled/<kind>/<name> outside the assistant's scanned subtree and sets disabled: true in state.json (with rollback if state write fails).
2. Inventory discovery scans _disabled/ folders, marks disabled items with disabled: true without duplicating managed entries, and drift checks do not report disabled items as missing-on-disk.
3. Executing enable moves the item back to its original active path byte-identically, refusing with conflict if a same-name active item already exists.

## Automated Verification Command
```bash
node --test out/engine/disable.test.js out/engine/discovery.test.js
```

## Acceptance Criteria
- [ ] Disabling and re-enabling a managed or unmanaged `skill`, `agent`, or `command` restores byte-identical files and rolls back the filesystem move if the `state.json` write fails.
- [ ] Enabling or disabling when the destination path already exists returns a conflict without overwriting anything, and non-file kinds (`mcp-server`, `hook`, `rule`) return `unsupported`.
- [ ] Disabled items are discovered once with `disabled: true`, never trigger `missing-on-disk` drift, and refuse `planUpdate` / `promoteObservedArtifact` with a clear "Enable it first" reason.

## AI Validation Log

