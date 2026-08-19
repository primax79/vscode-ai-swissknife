# 10 — MCP-server artifact support — Summary

> **Shipped on:** 2026-08-19  
> **Initiative:** 10 — MCP-server artifact support  
> **Status:** ✅ Done and merged into main

---

## What was built

1. **CanonicalMcpServer Model & Adapters (10.1)**:
   - Defined `CanonicalMcpServer` (`id`, `type`, `command`, `args`, `url`, `env`, `headers`, `extraFields`) in `src/adapters/types.ts`.
   - Claude adapter MCP codec (`mcpConfigPath`, `readMcpServer`, `writeMcpServer`, `listMcpServers`) writing to `.mcp.json` (project) or `~/.claude/settings.json` (global).
   - Kilo adapter MCP codec writing to `.kilo/mcp.json` (project) or `~/.config/kilo/mcp.json` (global).

2. **MCP Translator & Config Merge Install Engine (10.2)**:
   - `translateMcpServer` translating stdio/sse/http MCP servers.
   - `canonicalMcpServerHash` calculating deterministic sha256 hashes.
   - `planInstall` and `applyInstall` support for `kind: 'mcp-server'` with non-destructive configuration merge, backup, rollback, and state persistence.

3. **MCP Discovery & UI Integration (10.3)**:
   - `findMcpDefinitions` in `src/sources/detect.ts` scanning for `mcp.json`, `.mcp.json`, and `mcps/*.json`.
   - Discovery of MCP packages in `localFolder` and `gitCustom` resolvers.
   - Distinct plug icon (`plug`) for MCP servers in Available and Installed tree views.
   - Single and batch installation of MCP servers end-to-end.

## Verification

- Lint (`npm run lint`): 0 errors, 0 warnings.
- Typecheck (`npm run typecheck`): Clean.
- Test suite (`npm test`): 106 tests passing out of 106.
- Build (`npm run build`): Generated bundle `dist/extension.js`.
