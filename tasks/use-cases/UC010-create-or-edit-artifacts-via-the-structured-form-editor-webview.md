# UC010 - Create or edit artifacts via the structured Form Editor webview

- id: UC010
- title: Create or edit artifacts via the structured Form Editor webview
- actor: User
- approval: proposed
- priority: P2
- linked-tasks: 17.1, 17.2, 17.3
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: Structured Form Editor

## Description & Business Value
Allows a developer to create a new artifact or edit an installed skill, agent, command, MCP server, or rule through a structured Form Editor webview without hand-writing YAML/TOML frontmatter, preserving unrecognized extraFields and updating state.json hashes. Source: tasks/specs/phase-4-spec.md §3

## Preconditions
- The AI Swissknife extension is active in VS Code.

## Scenario / Interaction Steps
1. The user launches the Form Editor to create a new artifact or edit an existing installed artifact.
2. The webview renders per-kind structured inputs (e.g. mode, tools, permissions, model for agents; stdio/http/sse fields for MCP servers) and a read-only raw panel for extraFields.
3. Saving serializes the artifact directly via the target adapter's codec and updates the contentHash in state.json so drift detection stays accurate.

## Automated Verification Command
```bash
node --test out/ui/ui.test.js
```

## Acceptance Criteria
- [ ] `FormEditorPanel` renders kind-specific form controls for `skill`, `agent`, `command`, `mcp-server`, and `rule` without going through `planInstall`.
- [ ] Unrecognized frontmatter fields (`extraFields`) are displayed in a read-only panel and preserved unchanged on save.
- [ ] Saving updates `state.json` with the new canonical content hash so the edited item is not falsely flagged as locally drifted.

## AI Validation Log

