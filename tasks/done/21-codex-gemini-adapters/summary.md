# 21 — Adapter Codex CLI e Gemini CLI — Riepilogo

> **Shipped on:** 2026-08-19  
> **Initiative:** 21 — Adapter Codex CLI e Gemini CLI  
> **Status:** ✅ Completato e unito in main

---

## Cosa è stato realizzato

1. **CodexAdapter (21.1)**:
   - Implementato `CodexAdapter` in `src/adapters/codex.ts` per OpenAI Codex CLI.
   - Percorso skill: `.codex/skills/<name>/SKILL.md` (progetto) o `~/.codex/skills/<name>/SKILL.md` (globale).
   - Percorso agent: `.codex/agents/<name>.toml` (progetto) o `~/.codex/agents/<name>.toml` (globale).
   - Percorso command: `.codex/prompts/<name>.md` (importazione/lettura).
   - Percorso MCP Server: `.codex/config.json`.
   - Percorso rule: `AGENTS.md` (progetto) o `~/.codex/AGENTS.md` (globale).

2. **GeminiAdapter (21.2)**:
   - Implementato `GeminiAdapter` in `src/adapters/gemini.ts` per Google Gemini CLI.
   - Percorso skill: `.gemini/skills/<name>/SKILL.md`.
   - Percorso command: `.gemini/commands/<name>.toml`.
   - Percorso MCP Server: `.gemini/settings.json`.
   - Percorso rule: `GEMINI.md` (progetto) o `~/.gemini/GEMINI.md` (globale).

3. **Integrazione dei traduttori e della UI multi-assistente (21.3)**:
   - Abilitati `codex-cli` e `gemini-cli` in tutte le matrici di traduzione.
   - Esposti tutti e 5 gli assistenti (`claude-code`, `kilo-code`, `github-copilot`, `codex-cli`, `gemini-cli`) nei quick-pick di selezione dell'assistente nella vista Available, in Sync e nel Form Editor.

## Verification

- Lint (`npm run lint`): 0 errori, 0 avvisi.
- Typecheck (`npm run typecheck`): Pulito.
- Suite di test (`npm test`): 152 test superati su 152.
- Build (`npm run build`): Generato il bundle `dist/extension.js`.
