# 12 — Adapter GitHub Copilot — Riepilogo

> **Shipped on:** 2026-08-19  
> **Initiative:** 12 — Adapter GitHub Copilot  
> **Status:** ✅ Completato e unito in main

---

## Cosa è stato realizzato

1. **CopilotAdapter (12.1)**:
   - `CopilotAdapter` che implementa l'interfaccia `Adapter` per GitHub Copilot in VS Code.
   - Percorso skill: `.github/skills/<name>/SKILL.md` (progetto) o `~/.copilot/skills/<name>/SKILL.md` (globale).
   - Percorso agent: `.github/agents/<name>.agent.md` (progetto) o `~/.copilot/agents/<name>.agent.md` (globale).
   - Percorso command / prompt: `.github/prompts/<name>.prompt.md` (progetto) o `~/.copilot/prompts/<name>.prompt.md` (globale).
   - Percorso server MCP: `.vscode/mcp.json` (progetto) o `~/.copilot/mcp.json` (globale).
   - Percorso istruzioni / regole: `.github/copilot-instructions.md` (progetto) o `~/.copilot/copilot-instructions.md` (globale).

2. **Matrici di traduzione per Copilot (12.2)**:
   - `translateSkill`: senza perdita per `github-copilot`.
   - `translateAgent`: mappa tool e modello per `github-copilot`.
   - `translateCommand`: mappa il markdown del template prompt per `github-copilot`.
   - `translateMcpServer`: mappa la configurazione stdio/sse/http per `github-copilot`.

3. **Integrazione nel motore di installazione e nella UI (12.3)**:
   - GitHub Copilot (`github-copilot`) disponibile nel quick-pick di selezione dell'assistente.
   - Pianificazione e applicazione delle installazioni nei percorsi di Copilot con rollback atomico e persistenza dello stato.

## Verification

- Lint (`npm run lint`): 0 errori, 0 avvisi.
- Typecheck (`npm run typecheck`): Pulito.
- Suite di test (`npm test`): 122 test superati su 122.
- Build (`npm run build`): Generato il bundle `dist/extension.js`.
