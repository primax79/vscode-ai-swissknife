# UC014 - Install and manage artifacts for Codex CLI and Gemini CLI

- id: UC014
- title: Install and manage artifacts for Codex CLI and Gemini CLI
- actor: User
- status: draft
- priority: P1
- linked-tasks: 21
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: Codex and Gemini CLI adapters

## Description & Business Value
Extends cross-assistant packaging to OpenAI Codex CLI (.codex/skills, .codex/agents/*.toml, .codex/config.json, AGENTS.md) and Google Gemini CLI (.gemini/skills, .gemini/commands/*.toml, .gemini/settings.json, GEMINI.md) with explicit translation diagnostics. Source: tasks/specs/phase-4-spec.md §7

## Preconditions
- A source contains a skill, agent, command, MCP server, or rule artifact.

## Scenario / Interaction Steps
1. The user selects Codex CLI or Gemini CLI as the target assistant for installation or discovery.
2. CodexAdapter reads/writes skills, TOML agents, JSON MCP servers, and AGENTS.md rules while keeping deprecated Codex prompts read-only for discovery.
3. GeminiAdapter reads/writes skills, TOML commands, settings.json MCP servers, and GEMINI.md rules, emitting explicit diagnostics when a conversion is lossy or unsupported.

## Automated Verification Command
```bash
node --test out/adapters/codex.test.js out/adapters/gemini.test.js
```

## Acceptance Criteria
- [ ] `CodexAdapter` round-trips skills (`.codex/skills/`), TOML agents (`.codex/agents/*.toml`), MCP servers (`.codex/config.json`), and rules (`AGENTS.md`), while refusing `command` as an install target.
- [ ] `GeminiAdapter` round-trips skills (`.gemini/skills/`), TOML commands (`.gemini/commands/*.toml`), MCP servers (`.gemini/settings.json`), and rules (`GEMINI.md`).
- [ ] Lossy or unsupported cross-assistant conversions emit explicit `adapted-with-warning` or `unsupported` diagnostics rather than dropping fields silently.

## AI Validation Log

