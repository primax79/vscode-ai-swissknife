# UC030 - Query Claude Code installed plugins, details, and marketplaces via CLI

- id: UC030
- title: Query Claude Code installed plugins, details, and marketplaces via CLI
- actor: User
- status: draft
- priority: P3
- linked-tasks: 45
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: Claude CLI plugin read model

## Description & Business Value
Inspects Claude Code's natively installed plugins, available plugins, registered marketplaces, component inventories, and projected always-on token cost through a guarded ClaudeCli wrapper (with binary resolution, semver gate, and timeout handling) without directly editing Claude's internal JSON files. Source: tasks/specs/claude-plugins-study.md §1, §4

## Preconditions
- Claude Code CLI binary is on PATH (or fallback locations) and meets the minimum version requirement.

## Scenario / Interaction Steps
1. ClaudeCli resolves the claude executable across PATH and fallback locations and validates its version against the minimum semver gate.
2. Calling listPlugins, listAvailablePlugins, and listMarketplaces executes the claude plugin CLI commands with timeout protection and parses the JSON responses into typed read models (supporting user, project, and local scopes).
3. Calling pluginDetails parses the plugin's component inventory (skills, agents, commands, hooks, MCP, LSP) and projected always-on token cost.

## Automated Verification Command
```bash
node --test out/engine/claudeCli.test.js
```

## Acceptance Criteria
- [ ] `resolveClaudeBinary` searches `PATH` and fallback directories, throwing `ClaudeCliNotFound` with all searched locations when absent, and enforces a minimum semver gate (`ClaudeCliVersionError`).
- [ ] `listPlugins`, `listAvailablePlugins`, and `listMarketplaces` parse CLI JSON output accurately and throw `ClaudeCliParseError` (with `rawOutput`) on malformed output or `ClaudeCliTimeoutError` on timeout.
- [ ] `pluginDetails` extracts the component inventory (`skills`, `agents`, `commands`, `hooks`, `mcp`, `lsp`) and projected always-on token cost from `claude plugin details <id>`.

## AI Validation Log

