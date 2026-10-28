# 09 — Supporto agli artefatti command — Piano di implementazione

> **Derivato dalla specifica:** [`../specs/phase-2-spec.md`](../../specs/phase-2-spec.md) · [`../../SPEC.md`](../../../SPEC.md)

Task (ciascuno = un commit):

## Tasks

## Chiusi

### 09.1 - Modello CanonicalCommand e adapter command per Claude/Kilo

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** CanonicalCommand e adapter · **Size:** M · **Depends on:** 08 · **Use cases:** UC004 · **Spec:** [09.1-command-adapter.md](09.1-command-adapter.md)
- **Goal:** Definire `CanonicalCommand` in `src/adapters/types.ts` e implementare i codec dei command e `commandPath`/`readCommand`/`writeCommand`/`listCommands` in `ClaudeAdapter` e `KiloAdapter`.

### 09.2 - Traduttore dei command e motore di installazione

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Traduttore command e install engine · **Size:** M · **Depends on:** 09.1 · **Use cases:** UC004 · **Spec:** [09.2-command-translator-engine.md](09.2-command-translator-engine.md)
- **Goal:** Implementare `translateCommand` e `canonicalCommandHash`, ed estendere `planInstall` e `applyInstall` per gestire `kind: 'command'`.

### 09.3 - Discovery dei command e integrazione nella UI

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Discovery dei command e UI · **Size:** S · **Depends on:** 09.2 · **Use cases:** UC004 · **Spec:** [09.3-command-ui.md](09.3-command-ui.md)
- **Goal:** Rilevare i file markdown dei command nei resolver `localFolder` e `gitCustom`, visualizzarli nelle viste Available e Installed con l'icona del terminale e abilitare l'installazione singola e in batch.
