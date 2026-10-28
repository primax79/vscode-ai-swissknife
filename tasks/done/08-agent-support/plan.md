# 08 — Supporto agli artefatti agent — Piano di implementazione

> **Derivato dalla specifica:** [`../specs/phase-2-spec.md`](../../specs/phase-2-spec.md) · [`../../SPEC.md`](../../../SPEC.md)

Task (ciascuno = un commit):

## Tasks

## Chiusi

### 08.1 - Modello CanonicalAgent e adapter agent per Claude/Kilo

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** CanonicalAgent e adapter Claude/Kilo · **Size:** M · **Depends on:** 07 · **Use cases:** UC004 · **Spec:** [08.1-agent-adapter.md](08.1-agent-adapter.md)
- **Goal:** Definire `CanonicalAgent` in `src/adapters/types.ts` e implementare `parseAgentMarkdown`, `serializeAgentMarkdown`, `readAgent`, `writeAgent` e `listAgents` negli adapter Claude e Kilo.

### 08.2 - Traduttore degli agent e motore di installazione

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Traduttore agent e motore installazione · **Size:** M · **Depends on:** 08.1 · **Use cases:** UC004 · **Spec:** [08.2-agent-translator-engine.md](08.2-agent-translator-engine.md)
- **Goal:** Implementare `translateAgent` con mappatura tra tool e permessi ed estendere `planInstall` e `applyInstall` per gestire `kind: 'agent'`.

### 08.3 - Rilevamento degli agent e integrazione nella UI

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Rilevamento degli agent e UI · **Size:** S · **Depends on:** 08.2 · **Use cases:** UC004 · **Spec:** [08.3-agent-ui.md](08.3-agent-ui.md)
- **Goal:** Rilevare i file degli agent nei resolver `localFolder` e `gitCustom`, visualizzare gli agent nelle viste Available e Installed con icone distinte e abilitare l'installazione singola e in batch.
