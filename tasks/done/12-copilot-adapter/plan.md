# 12 — GitHub Copilot adapter — Implementation plan

> **Derived from spec:** [`../specs/phase-2-spec.md`](../../specs/phase-2-spec.md) · [`../../SPEC.md`](../../../SPEC.md)

Tasks (each = one commit):

## Tasks

## Closed

### 12.1 - CopilotAdapter implementation

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** CopilotAdapter implementation · **Size:** M · **Depends on:** 08, 09, 10 · **Spec:** [12.1-copilot-adapter.md](12.1-copilot-adapter.md)
- **Goal:** Implement `CopilotAdapter` in `src/adapters/copilot.ts` supporting `.github/skills/`, `.github/agents/*.agent.md`, `.github/prompts/*.prompt.md`, `.vscode/mcp.json`, and `.github/copilot-instructions.md`.

### 12.2 - Copilot translation matrices

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Copilot translation matrices · **Size:** S · **Depends on:** 12.1 · **Spec:** [12.2-copilot-translators.md](12.2-copilot-translators.md)
- **Goal:** Update `translateSkill`, `translateAgent`, `translateCommand`, and `translateMcpServer` to support `github-copilot` as a supported target.

### 12.3 - Engine & UI integration

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Copilot engine and UI integration · **Size:** S · **Depends on:** 12.2 · **Spec:** [12.3-copilot-ui.md](12.3-copilot-ui.md)
- **Goal:** Expose GitHub Copilot in the assistant picker and install engine across all artifact kinds.
