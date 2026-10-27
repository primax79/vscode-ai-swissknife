# 09 — Command artifact support — Implementation plan

> **Derived from spec:** [`../specs/phase-2-spec.md`](../../specs/phase-2-spec.md) · [`../../SPEC.md`](../../../SPEC.md)

Tasks (each = one commit):

## Tasks

## Closed

### 09.1 - CanonicalCommand model and Claude/Kilo command adapters

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** CanonicalCommand and adapters · **Size:** M · **Depends on:** 08 · **Spec:** [09.1-command-adapter.md](09.1-command-adapter.md)
- **Goal:** Define `CanonicalCommand` in `src/adapters/types.ts` and implement command codecs and `commandPath`/`readCommand`/`writeCommand`/`listCommands` in `ClaudeAdapter` and `KiloAdapter`.

### 09.2 - Command translator & install engine

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Command translator and install engine · **Size:** M · **Depends on:** 09.1 · **Spec:** [09.2-command-translator-engine.md](09.2-command-translator-engine.md)
- **Goal:** Implement `translateCommand` and `canonicalCommandHash`, and extend `planInstall` and `applyInstall` to handle `kind: 'command'`.

### 09.3 - Command discovery & UI integration

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Command discovery and UI · **Size:** S · **Depends on:** 09.2 · **Spec:** [09.3-command-ui.md](09.3-command-ui.md)
- **Goal:** Detect command markdown files in `localFolder` and `gitCustom` resolvers, display them in Available and Installed views with a terminal icon, and enable single and batch installation.
