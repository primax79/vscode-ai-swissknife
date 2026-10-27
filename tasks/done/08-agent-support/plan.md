# 08 — Agent artifact support — Implementation plan

> **Derived from spec:** [`../specs/phase-2-spec.md`](../../specs/phase-2-spec.md) · [`../../SPEC.md`](../../../SPEC.md)

Tasks (each = one commit):

## Tasks

## Closed

### 08.1 - CanonicalAgent model and Claude/Kilo agent adapters

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** CanonicalAgent and Claude/Kilo adapters · **Size:** M · **Depends on:** 07 · **Spec:** [08.1-agent-adapter.md](08.1-agent-adapter.md)
- **Goal:** Define `CanonicalAgent` in `src/adapters/types.ts` and implement `parseAgentMarkdown`, `serializeAgentMarkdown`, `readAgent`, `writeAgent`, and `listAgents` in Claude and Kilo adapters.

### 08.2 - Agent translator & install engine

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Agent translator and install engine · **Size:** M · **Depends on:** 08.1 · **Spec:** [08.2-agent-translator-engine.md](08.2-agent-translator-engine.md)
- **Goal:** Implement `translateAgent` with tool-permission mapping and extend `planInstall` and `applyInstall` to handle `kind: 'agent'`.

### 08.3 - Agent detection & UI integration

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Agent detection and UI · **Size:** S · **Depends on:** 08.2 · **Spec:** [08.3-agent-ui.md](08.3-agent-ui.md)
- **Goal:** Detect agent files in `localFolder` and `gitCustom` resolvers, display agents in Available and Installed views with distinct icons, and enable single/batch installation.
