# UC031 - Inspect sources, catalog, installed items, updates, and plans via CLI

- id: UC031
- title: Inspect sources, catalog, installed items, updates, and plans via CLI
- actor: Operator
- approval: proposed
- priority: P1
- linked-tasks: 46.1, 46.2, 46.3, 46.4, 46.5
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: Headless CLI read commands

## Description & Business Value
Allows an operator or agent session to inspect registered sources, available catalog artifacts, managed/unmanaged installations, drift/update status, per-item detail (with optional diff),install plans, and machine-readable CLI schema descriptions as pure JSON on stdout without running VS Code. Source: tasks/specs/mcp-cli-access-study.md §2, §3

## Preconditions
- dist/cli.js is built.

## Scenario / Interaction Steps
1. The operator or agent runs node dist/cli.js <sources|catalog|installed|updates|item|plan-install|describe> with optional --workspace, --home, and --assistants flags.
2. The CLI executes against the headless domain/engine layers with zero vscode dependency and outputs exactly one JSON document on stdout (logs on stderr).
3. On invalid arguments or missing items, the CLI exits non-zero and prints a structured { error: { code, message } } JSON payload on stdout.

## Automated Verification Command
```bash
node --test out/cli/cli.test.js out/cli/describe.test.js
```

## Acceptance Criteria
- [ ] `dist/cli.js` bundles zero `vscode` imports and prints a single JSON document on stdout for `sources`, `catalog`, `installed`, `updates`, `item`, `plan-install`, and `describe`.
- [ ] Per-source resolution failures during `catalog` are reported inside the `diagnostics` array rather than failing the whole command.
- [ ] `describe` outputs machine-readable command, option, example, and output-shape metadata that stays in sync with `AGENTS.md`.

## AI Validation Log

