# 10 — MCP-server artifact support — Implementation plan

> **Derived from spec:** [`../specs/phase-2-spec.md`](../specs/phase-2-spec.md) · [`../../SPEC.md`](../../SPEC.md)

Tasks (each = one commit):

## Tasks

## Closed

### 10.1 - CanonicalMcpServer model and Claude/Kilo MCP config adapters

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** CanonicalMcpServer and adapters · **Size:** M · **Depends on:** 08 · **Spec:** [10.1-mcp-adapter.md](10.1-mcp-adapter.md)
- **Goal:** Define `CanonicalMcpServer` in `src/adapters/types.ts` and implement non-destructive JSON/JSONC MCP config merge and extraction in `ClaudeAdapter` and `KiloAdapter`.

### 10.2 - MCP translator & install engine

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** MCP translator and install engine · **Size:** M · **Depends on:** 10.1 · **Spec:** [10.2-mcp-translator-engine.md](10.2-mcp-translator-engine.md)
- **Goal:** Implement `translateMcpServer` and `canonicalMcpServerHash`, and extend `planInstall` and `applyInstall` to handle `kind: 'mcp-server'` with non-destructive config merge, backup, and rollback.

### 10.3 - MCP discovery & UI integration

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** MCP discovery and UI · **Size:** M · **Depends on:** 10.2 · **Spec:** [10.3-mcp-ui.md](10.3-mcp-ui.md)
- **Goal:** Detect MCP server definitions (`.mcp.json`, `mcp.json`, `mcps/`) in `localFolder` and `gitCustom` resolvers, display them with a plug icon, and enable single/batch installation.
