# 12 — Adapter GitHub Copilot — Piano di implementazione

> **Derivato dalla specifica:** [`../specs/phase-2-spec.md`](../../specs/phase-2-spec.md) · [`../../SPEC.md`](../../../SPEC.md)

Task (ciascuno = un commit):

## Tasks

## Chiusi

### 12.1 - Implementazione di CopilotAdapter

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Implementazione di CopilotAdapter · **Size:** M · **Depends on:** 08, 09, 10 · **Spec:** [12.1-copilot-adapter.md](12.1-copilot-adapter.md)
- **Goal:** Implementare `CopilotAdapter` in `src/adapters/copilot.ts` supportando `.github/skills/`, `.github/agents/*.agent.md`, `.github/prompts/*.prompt.md`, `.vscode/mcp.json` e `.github/copilot-instructions.md`.

### 12.2 - Matrici di traduzione per Copilot

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Matrici di traduzione per Copilot · **Size:** S · **Depends on:** 12.1 · **Spec:** [12.2-copilot-translators.md](12.2-copilot-translators.md)
- **Goal:** Aggiornare `translateSkill`, `translateAgent`, `translateCommand` e `translateMcpServer` per supportare `github-copilot` come destinazione supportata.

### 12.3 - Integrazione nel motore e nella UI

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Integrazione motore e UI Copilot · **Size:** S · **Depends on:** 12.2 · **Spec:** [12.3-copilot-ui.md](12.3-copilot-ui.md)
- **Goal:** Esporre GitHub Copilot nel selettore degli assistenti e nel motore di installazione per tutti i tipi di artefatto.
