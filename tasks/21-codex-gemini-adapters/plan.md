# 21 — Codex CLI & Gemini CLI adapters — Implementation plan

> **Derived from spec:** [`../specs/phase-4-spec.md`](../specs/phase-4-spec.md) §7 · [`../../SPEC.md`](../../SPEC.md) §1

Tasks (each = one commit):

1. **[21.1 — Gemini `agent` verification spike](21.1-gemini-agent-verification.md)**: **no adapter code** — confirm whether Gemini CLI has a standalone `agent` format before 21.3 writes (or explicitly skips) it.
2. **[21.2 — Codex CLI adapter](21.2-codex-adapter.md)**: TOML parse/serialize for `agent`/`mcp-server`, plain `AGENTS.md` for `rule`, same `SKILL.md` for `skill`, read-only import for the deprecated `command`.
3. **[21.3 — Gemini CLI adapter](21.3-gemini-adapter.md)**: TOML `command` with path→`:` name mapping, hierarchical `GEMINI.md` for `rule`, `mcpServers` in `settings.json`, same `SKILL.md` for `skill`, `agent` per 21.1's finding.
4. **[21.4 — Translator wiring & UI integration](21.4-codex-gemini-ui.md)**: extend every existing translator with `codex-cli`/`gemini-cli` branches and add both to the assistant pickers across the UI, then verify.

**Task 21.1 gates the `agent` portion of 21.3** (the rest of 21.3 doesn't depend on it and can proceed in parallel).
