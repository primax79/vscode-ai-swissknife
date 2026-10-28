# 10 — Supporto agli artefatti MCP-server — Piano di implementazione

> **Derivato dalla specifica:** [`../specs/phase-2-spec.md`](../../specs/phase-2-spec.md) · [`../../SPEC.md`](../../../SPEC.md)

Task (ciascuno = un commit):

## Tasks

## Chiusi

### 10.1 - Modello CanonicalMcpServer e adapter di configurazione MCP per Claude/Kilo

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** CanonicalMcpServer e adapter · **Size:** M · **Depends on:** 08 · **Use cases:** UC005 · **Spec:** [10.1-mcp-adapter.md](10.1-mcp-adapter.md)
- **Goal:** Definire `CanonicalMcpServer` in `src/adapters/types.ts` e implementare il merge non distruttivo e l'estrazione della configurazione MCP JSON/JSONC in `ClaudeAdapter` e `KiloAdapter`.

### 10.2 - Traduttore MCP e motore di installazione

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Traduttore MCP e motore installazione · **Size:** M · **Depends on:** 10.1 · **Use cases:** UC005 · **Spec:** [10.2-mcp-translator-engine.md](10.2-mcp-translator-engine.md)
- **Goal:** Implementare `translateMcpServer` e `canonicalMcpServerHash`, ed estendere `planInstall` e `applyInstall` per gestire `kind: 'mcp-server'` con merge non distruttivo della configurazione, backup e rollback.

### 10.3 - Discovery MCP e integrazione nella UI

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Discovery MCP e UI · **Size:** M · **Depends on:** 10.2 · **Use cases:** UC005 · **Spec:** [10.3-mcp-ui.md](10.3-mcp-ui.md)
- **Goal:** Rilevare le definizioni dei server MCP (`.mcp.json`, `mcp.json`, `mcps/`) nei resolver `localFolder` e `gitCustom`, visualizzarle con l'icona della spina e abilitare l'installazione singola e in batch.
