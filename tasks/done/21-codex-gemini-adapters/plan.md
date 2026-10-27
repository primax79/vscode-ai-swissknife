# 21 — Codex CLI & Gemini CLI adapters — Implementation plan

> **Derived from spec:** [`../specs/phase-4-spec.md`](../../specs/phase-4-spec.md) §7 · [`../../SPEC.md`](../../../SPEC.md) §1

Tasks (each = one commit):

## Tasks

## Gating

**Task 21.1 gates the `agent` portion of 21.3** (the rest of 21.3 doesn't depend on it and can proceed in parallel).

## Closed

### 21.1 - Gemini `agent` verification spike

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Gemini agent verification spike · **Size:** S · **Kind:** investigation · **Depends on:** 08 · **Spec:** [21.1-gemini-agent-verification.md](21.1-gemini-agent-verification.md)
- **Goal:** Verify whether Gemini CLI supports a standalone `agent` format outside extension bundles before implementing `GeminiAdapter`.

### 21.2 - Codex CLI adapter

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Codex CLI adapter · **Size:** M · **Depends on:** 03, 05, 08, 09, 10, 12 · **Spec:** [21.2-codex-adapter.md](21.2-codex-adapter.md)
- **Goal:** Implement `CodexAdapter` in `src/adapters/codex.ts` supporting `skill` (`SKILL.md`), `agent` (`.codex/agents/*.toml`), `command` (`.codex/prompts/*.md`), `mcp-server` (`.codex/config.json`), and `rule` (`AGENTS.md`).

### 21.3 - Gemini CLI adapter

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Gemini CLI adapter · **Size:** M · **Depends on:** 21.1, 03, 05, 08, 09, 10, 12 · **Spec:** [21.3-gemini-adapter.md](21.3-gemini-adapter.md)
- **Goal:** Implement `GeminiAdapter` in `src/adapters/gemini.ts` supporting `skill` (`SKILL.md`), TOML `command` (`.gemini/commands/*.toml`), `mcp-server` (`settings.json`), and `rule` (`GEMINI.md`).

### 21.4 - Translator wiring & UI integration

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Codex and Gemini UI integration · **Size:** M · **Depends on:** 21.2, 21.3 · **Spec:** [21.4-codex-gemini-ui.md](21.4-codex-gemini-ui.md)
- **Goal:** Extend all per-kind translators with `codex-cli` and `gemini-cli` target branches and expose all five assistants across UI pickers, sync, discovery, and drift.
