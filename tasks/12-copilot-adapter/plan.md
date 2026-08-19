# 12 — GitHub Copilot adapter — Implementation plan

> **Derived from spec:** [`../specs/phase-2-spec.md`](../specs/phase-2-spec.md) · [`../../SPEC.md`](../../SPEC.md)

Tasks (each = one commit):

1. **[12.1 — CopilotAdapter implementation](12.1-copilot-adapter.md)**: implement `CopilotAdapter` in `src/adapters/copilot.ts` (`.github/skills/`, `.github/agents/*.agent.md`, `.github/prompts/*.prompt.md`, `.vscode/mcp.json`, `.github/copilot-instructions.md`) and unit tests in `src/adapters/copilot.test.ts`.
2. **[12.2 — Copilot translation matrices](12.2-copilot-translators.md)**: update `translateSkill`, `translateAgent`, `translateCommand`, `translateMcpServer` to support `github-copilot` as a supported target.
3. **[12.3 — Engine & UI integration](12.3-copilot-ui.md)**: expose GitHub Copilot in `AI Swissknife` assistant picker and install engine across all artifact kinds.
