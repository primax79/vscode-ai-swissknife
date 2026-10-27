# 20 — Sorgenti Remote-URL e git-single-item — Riepilogo

> **Shipped on:** 2026-08-19  
> **Initiative:** 20 — Sorgenti Remote-URL e git-single-item  
> **Status:** ✅ Completato e unito in main

---

## Cosa è stato realizzato

1. **Resolver Git Single Item (20.1)**:
   - Implementato `resolveGitSingleItem` in `src/sources/gitSingleItem.ts`.
   - Clona/scarica repository in cui la radice stessa è l'artefatto (`SKILL.md`, `mcp.json`, `AGENT.md`, `CLAUDE.md`).
   - Normalizza in un `Package` contenente 1 `Artifact`.

2. **Resolver Remote URL (20.2)**:
   - Implementato `resolveRemoteUrl` in `src/sources/remoteUrl.ts`.
   - Scarica file singoli via HTTP(S) (o URL `file://` nei test) e li mette in cache sotto `~/.ai-swissknife/cache/remote/<sourceId>/`.

3. **Integrazione nel motore e nella UI (20.3)**:
   - Smistato in `src/engine/plan.ts` tramite la funzione unificata `resolveContentFromSource`.
   - Esposte le opzioni `git-single-item` e `remote-url` in `AI Swissknife: Add Source`.

## Verification

- Lint (`npm run lint`): 0 errori, 0 avvisi.
- Typecheck (`npm run typecheck`): Pulito.
- Suite di test (`npm test`): 136 test superati su 136.
- Build (`npm run build`): Generato il bundle `dist/extension.js`.
