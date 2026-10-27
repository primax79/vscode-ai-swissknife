# 15 — File watcher per la coerenza — Riepilogo

> **Shipped on:** 2026-08-19  
> **Initiative:** 15 — File watcher per la coerenza  
> **Status:** ✅ Completato e unito in main

---

## Cosa è stato realizzato

1. **FileSystemWatcher con debounce (15.1)**:
   - Implementato `setupFileWatchers` in `src/ui/watchers.ts` con debounce di 250ms.
   - Monitora `.claude/`, `.kilo/`, `.github/skills/`, `.github/agents/`, `.github/prompts/`, `.vscode/mcp.json` e `.ai-swissknife/`.

2. **Integrazione nel ciclo di vita dell'estensione (15.2)**:
   - Registrati i watcher in `src/extension.ts` attivando l'aggiornamento automatico delle viste ad albero `Sources` e `Installed`.
   - Rilascio pulito delle risorse alla disattivazione dell'estensione.

## Verification

- Lint (`npm run lint`): 0 errori, 0 avvisi.
- Typecheck (`npm run typecheck`): Pulito.
- Suite di test (`npm test`): 126 test superati su 126.
- Build (`npm run build`): Generato il bundle `dist/extension.js`.
