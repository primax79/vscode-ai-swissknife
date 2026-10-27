# 11 — Resolver delle sorgenti marketplace — Riepilogo

> **Shipped on:** 2026-08-19  
> **Initiative:** 11 — Resolver delle sorgenti marketplace  
> **Status:** ✅ Completato e unito in main

---

## Cosa è stato realizzato

1. **Resolver Git Marketplace (11.1)**:
   - Implementato `resolveGitMarketplace` in `src/sources/gitMarketplace.ts` con clone/fetch, pin dei ref e sincronizzazione della cache sotto `gitMarketplaceMutex`.
   - Parsing nativo dei cataloghi `.claude-plugin/marketplace.json` e `marketplace.json`.
   - Discovery di pacchetti plugin multi-artefatto (skill, agent, command e server MCP all'interno della cartella di ciascun plugin).

2. **Risoluzione del contenuto marketplace e integrazione nel motore (11.2)**:
   - Implementato `resolveArtifactContent` per le sorgenti `git-marketplace` su tutti i tipi di artefatto (`skill`, `agent`, `command`, `mcp-server`).
   - Collegate direttamente le sorgenti `git-marketplace` in `planInstall` e `applyInstall`.

3. **Integrazione nella UI (11.3)**:
   - Aggiunta la selezione `git-marketplace` in `AI Swissknife: Add Source`.
   - Collegato `resolveGitMarketplace` in `AvailableTreeDataProvider.refreshCatalog()`.
   - Installazione singola e in batch di pacchetti e artefatti del marketplace.

## Verification

- Lint (`npm run lint`): 0 errori, 0 avvisi.
- Typecheck (`npm run typecheck`): Pulito.
- Suite di test (`npm test`): 108 test superati su 108.
- Build (`npm run build`): Generato il bundle `dist/extension.js`.
