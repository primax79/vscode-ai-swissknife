# UC018 - Move an installed artifact to another assistant or scope with soft-delete

- id: UC018
- title: Move an installed artifact to another assistant or scope with soft-delete
- actor: User
- status: draft
- priority: P1
- linked-tasks: 25
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: Move artifact with soft-delete

## Description & Business Value
Moves a managed skill, agent, command, or MCP server to another assistant or scope by translating and installing its current on-disk content at the target first, then soft-deleting the origin into .ai-swissknife/_deleted/ (or stripping the MCP entry). Source: tasks/specs/phase-6-spec.md §4.3

## Preconditions
- A managed skill, agent, command, or mcp-server is installed.

## Scenario / Interaction Steps
1. The user invokes Move to... on a managed installation and selects a target assistant and scope.
2. The engine translates and installs the current on-disk content at the target via planSync and applyInstall; if the install fails or is cancelled, the origin is left untouched.
3. Once the target install succeeds, the origin file/folder is moved to .ai-swissknife/_deleted/<kind>/<name>-<timestamp>/ (or removeMcpServer strips the MCP config key) and removed from origin state.json.

## Automated Verification Command
```bash
node --test out/engine/softDelete.test.js out/engine/sync.test.js
```

## Acceptance Criteria
- [ ] `Move to...` is offered only for `ManagedInstallation` items of kind `skill`, `agent`, `command`, or `mcp-server`.
- [ ] The target installation is completed and verified before the origin is removed; if target install fails or is refused, the origin remains intact.
- [ ] Origin removal soft-deletes file/directory artifacts into `.ai-swissknife/_deleted/<kind>/<name>-<timestamp>/` or invokes `removeMcpServer(id, loc)` for MCP servers, reporting `manual-recovery-required` if post-install origin removal fails.

## AI Validation Log

