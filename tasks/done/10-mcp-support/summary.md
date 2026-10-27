# 10 — Supporto agli artefatti MCP-server — Riepilogo

> **Shipped on:** 2026-08-19  
> **Initiative:** 10 — Supporto agli artefatti MCP-server  
> **Status:** ✅ Completato e unito in main

---

## Cosa è stato realizzato

1. **Modello CanonicalMcpServer e Adapter (10.1)**:
   - Definito `CanonicalMcpServer` (`id`, `type`, `command`, `args`, `url`, `env`, `headers`, `extraFields`) in `src/adapters/types.ts`.
   - Codec MCP nell'adapter Claude (`mcpConfigPath`, `readMcpServer`, `writeMcpServer`, `listMcpServers`) con scrittura in `.mcp.json` (progetto) o `~/.claude/settings.json` (globale).
   - Codec MCP nell'adapter Kilo con scrittura in `.kilo/mcp.json` (progetto) o `~/.config/kilo/mcp.json` (globale).

2. **Traduttore MCP e motore di installazione con merge della configurazione (10.2)**:
   - `translateMcpServer` che traduce server MCP stdio/sse/http.
   - `canonicalMcpServerHash` che calcola hash sha256 deterministici.
   - Supporto in `planInstall` e `applyInstall` per `kind: 'mcp-server'` con merge non distruttivo della configurazione, backup, rollback e persistenza dello stato.

3. **Discovery MCP e integrazione nella UI (10.3)**:
   - `findMcpDefinitions` in `src/sources/detect.ts` che scansiona `mcp.json`, `.mcp.json` e `mcps/*.json`.
   - Discovery dei pacchetti MCP nei resolver `localFolder` e `gitCustom`.
   - Icona a spina distinta (`plug`) per i server MCP nelle viste ad albero Available e Installed.
   - Installazione singola e in batch dei server MCP end-to-end.

## Verification

- Lint (`npm run lint`): 0 errori, 0 avvisi.
- Typecheck (`npm run typecheck`): Pulito.
- Suite di test (`npm test`): 106 test superati su 106.
- Build (`npm run build`): Generato il bundle `dist/extension.js`.
