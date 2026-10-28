# UC004 - Translate and install agents and commands across Claude, Kilo, Copilot

- id: UC004
- title: Translate and install agents and commands across Claude, Kilo, Copilot
- actor: User
- status: draft
- priority: P1
- linked-tasks: 08, 09, 12
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: Install agents and commands

## Description & Business Value
Allows a developer to translate and install agent personas and slash commands across Claude Code, Kilo Code, and GitHub Copilot, mapping Claude tool arrays to Kilo permissions and enforcing Kilo's strict command frontmatter schema. Source: tasks/specs/phase-2-spec.md §2.1-2.2

## Preconditions
- A source contains an agent or command artifact.

## Scenario / Interaction Steps
1. The user selects an agent or command artifact to install onto Claude Code, Kilo Code, or GitHub Copilot.
2. For agents, the translator maps tools[] <-> permission:{[tool]:'allow'} between Claude and Kilo, or writes .github/agents/<name>.agent.md for Copilot.
3. For commands, the adapter writes .claude/commands/<name>.md, .kilo/command/<name>.md (pruning unsupported frontmatter keys to satisfy Kilo's strict parser), or .github/prompts/<name>.prompt.md.

## Automated Verification Command
```bash
node --test out/translator/agent.test.js out/translator/command.test.js out/adapters/copilot.test.js
```

## Acceptance Criteria
- [ ] Agent translation maps Claude `tools: string[]` to Kilo `permission: { [tool]: 'allow' }` and back without losing system prompt body or model settings.
- [ ] Kilo command serializer enforces Kilo's strict frontmatter schema (`description`, `agent`, `model`, `subtask`) and prunes unrecognized keys to prevent `ConfigInvalidError`.
- [ ] GitHub Copilot adapter writes skills to `.github/skills/<name>/SKILL.md`, agents to `.github/agents/<name>.agent.md`, and commands to `.github/prompts/<name>.prompt.md`.

## AI Validation Log

