# UC005 - Merge and remove MCP server entries in JSON/JSONC assistant configs

- id: UC005
- title: Merge and remove MCP server entries in JSON/JSONC assistant configs
- actor: User
- approval: proposed
- priority: P1
- linked-tasks: 10.1, 10.2, 10.3, 12.1, 12.2, 12.3, 44.1, 44.2, 44.3, 44.4, 44.5, 44.6
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: Manage MCP server configs

## Description & Business Value
Allows a developer to install or remove an MCP server definition by merging it into the target assistant's JSON/JSONC configuration file (.mcp.json, kilo.jsonc, .vscode/mcp.json) while preserving existing servers, comments, and formatting. Source: tasks/specs/phase-2-spec.md §2.3

## Preconditions
- A source exposes an mcp-server artifact (stdio, http, or sse).

## Scenario / Interaction Steps
1. The user plans an MCP server installation for a target assistant and scope.
2. planInstall inspects the existing config file (.mcp.json, kilo.jsonc, or .vscode/mcp.json) and detects whether the server ID already exists.
3. applyInstall atomically merges the server entry into the JSON/JSONC config while preserving comments, trailing commas, indentation, and sibling servers, and records the installation in state.json.

## Automated Verification Command
```bash
node --test out/translator/mcp.test.js out/adapters/claude.test.js out/adapters/kilo.test.js
```

## Acceptance Criteria
- [ ] `writeMcpServer` merges the new server entry into `.mcp.json` / `~/.claude/settings.json` (Claude), `kilo.jsonc` (Kilo), or `.vscode/mcp.json` (Copilot) while preserving existing servers.
- [ ] Minimal JSONC editing on `kilo.jsonc` preserves comments, trailing commas, and indentation style byte-for-byte outside the modified entry.
- [ ] `removeMcpServer` removes only the targeted server key and is a safe no-op if the server key is absent.

## AI Validation Log

