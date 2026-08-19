# 10 — MCP-server artifact support — Implementation plan

> **Derived from spec:** [`../specs/phase-2-spec.md`](../specs/phase-2-spec.md) · [`../../SPEC.md`](../../SPEC.md)

Tasks (each = one commit):

1. **[10.1 — CanonicalMcpServer model and Claude/Kilo MCP config adapters](10.1-mcp-adapter.md)**: define `CanonicalMcpServer` in `src/adapters/types.ts`, implement non-destructive JSON/JSONC merge and extraction in `ClaudeAdapter` (`.mcp.json` / `~/.claude/settings.json`) and `KiloAdapter` (`.kilo/mcp.json` / `kilo.jsonc` `mcp:` block).
2. **[10.2 — MCP translator & install engine](10.2-mcp-translator-engine.md)**: implement `translateMcpServer`, `canonicalMcpServerHash`, and extend `planInstall` and `applyInstall` to handle `kind: 'mcp-server'` with config merge, backup, rollback, and state tracking.
3. **[10.3 — MCP discovery & UI integration](10.3-mcp-ui.md)**: detect MCP server definitions (`.mcp.json`, `mcp.json`, `mcps/`) in `localFolder` and `gitCustom` resolvers, display with plug icon (`plug`), and enable single/batch installation.
