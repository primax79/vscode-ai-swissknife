# 21 — Adapter Codex CLI e Gemini CLI — Piano di implementazione

> **Derived from spec:** [`../specs/phase-4-spec.md`](../../specs/phase-4-spec.md) §7 · [`../../SPEC.md`](../../../SPEC.md) §1

Task (ciascuno = un commit):

## Tasks

## Vincoli di sequenza

**Il task 21.1 blocca la parte `agent` di 21.3** (il resto di 21.3 non dipende da esso e può procedere in parallelo).

## Closed

### 21.1 - Spike di verifica di `agent` per Gemini

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Verifica agent Gemini · **Size:** S · **Kind:** investigation · **Depends on:** 08 · **Use cases:** UC014 · **Spec:** [21.1-gemini-agent-verification.md](21.1-gemini-agent-verification.md)
- **Goal:** Verificare se Gemini CLI supporti un formato `agent` standalone al di fuori dei bundle di estensione prima di implementare `GeminiAdapter`.

### 21.2 - Adapter Codex CLI

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Adapter Codex CLI · **Size:** M · **Depends on:** 03, 05, 08, 09, 10, 12 · **Use cases:** UC014 · **Spec:** [21.2-codex-adapter.md](21.2-codex-adapter.md)
- **Goal:** Implementare `CodexAdapter` in `src/adapters/codex.ts` con supporto a `skill` (`SKILL.md`), `agent` (`.codex/agents/*.toml`), `command` (`.codex/prompts/*.md`), `mcp-server` (`.codex/config.json`) e `rule` (`AGENTS.md`).

### 21.3 - Adapter Gemini CLI

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Adapter Gemini CLI · **Size:** M · **Depends on:** 21.1, 03, 05, 08, 09, 10, 12 · **Use cases:** UC014 · **Spec:** [21.3-gemini-adapter.md](21.3-gemini-adapter.md)
- **Goal:** Implementare `GeminiAdapter` in `src/adapters/gemini.ts` con supporto a `skill` (`SKILL.md`), `command` TOML (`.gemini/commands/*.toml`), `mcp-server` (`settings.json`) e `rule` (`GEMINI.md`).

### 21.4 - Collegamento dei traduttori e integrazione UI

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Integrazione UI Codex e Gemini · **Size:** M · **Depends on:** 21.2, 21.3 · **Use cases:** UC014 · **Spec:** [21.4-codex-gemini-ui.md](21.4-codex-gemini-ui.md)
- **Goal:** Estendere tutti i traduttori per tipo con i rami di destinazione `codex-cli` e `gemini-cli` ed esporre tutti e cinque gli assistenti nei selettori UI, nella sincronizzazione, nel rilevamento e nel drift.
