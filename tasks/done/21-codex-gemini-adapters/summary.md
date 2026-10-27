# 21 — Codex CLI & Gemini CLI adapters — Summary

> **Shipped on:** 2026-08-19  
> **Initiative:** 21 — Codex CLI & Gemini CLI adapters  
> **Status:** ✅ Done and merged into main

---

## What was built

1. **CodexAdapter (21.1)**:
   - Implemented `CodexAdapter` in `src/adapters/codex.ts` for OpenAI Codex CLI.
   - Skill path: `.codex/skills/<name>/SKILL.md` (project) or `~/.codex/skills/<name>/SKILL.md` (global).
   - Agent path: `.codex/agents/<name>.toml` (project) or `~/.codex/agents/<name>.toml` (global).
   - Command path: `.codex/prompts/<name>.md` (import/read).
   - MCP Server path: `.codex/config.json`.
   - Rule path: `AGENTS.md` (project) or `~/.codex/AGENTS.md` (global).

2. **GeminiAdapter (21.2)**:
   - Implemented `GeminiAdapter` in `src/adapters/gemini.ts` for Google Gemini CLI.
   - Skill path: `.gemini/skills/<name>/SKILL.md`.
   - Command path: `.gemini/commands/<name>.toml`.
   - MCP Server path: `.gemini/settings.json`.
   - Rule path: `GEMINI.md` (project) or `~/.gemini/GEMINI.md` (global).

3. **Translator & Multi-Assistant UI Integration (21.3)**:
   - Enabled `codex-cli` and `gemini-cli` across all translation matrices.
   - Exposed all 5 assistants (`claude-code`, `kilo-code`, `github-copilot`, `codex-cli`, `gemini-cli`) in assistant selection quick-picks in Available view, Sync, and Form Editor.

## Verification

- Lint (`npm run lint`): 0 errors, 0 warnings.
- Typecheck (`npm run typecheck`): Clean.
- Test suite (`npm test`): 152 tests passing out of 152.
- Build (`npm run build`): Generated bundle `dist/extension.js`.
