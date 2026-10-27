# 11 — Resolver delle sorgenti marketplace — Piano di implementazione

> **Derivato dalla specifica:** [`../specs/phase-2-spec.md`](../../specs/phase-2-spec.md) · [`../../SPEC.md`](../../../SPEC.md)

Task (ciascuno = un commit):

## Tasks

## Chiusi

### 11.1 - Resolver dei manifest marketplace per Claude e Kilo

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Resolver dei manifest marketplace · **Size:** M · **Depends on:** 08, 09, 10 · **Spec:** [11.1-marketplace-resolver.md](11.1-marketplace-resolver.md)
- **Goal:** Implementare `resolveGitMarketplace` in `src/sources/gitMarketplace.ts` supportando i manifest `.claude-plugin/marketplace.json` e `marketplace-skills.json` con lock della cache, pin dei ref e costruzione di pacchetti multi-artefatto.

### 11.2 - Risoluzione del contenuto marketplace e motore di installazione

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Risoluzione del contenuto marketplace · **Size:** M · **Depends on:** 11.1 · **Spec:** [11.2-marketplace-content.md](11.2-marketplace-content.md)
- **Goal:** Implementare `resolveArtifactContent` per le sorgenti `git-marketplace` su tutti i tipi di artefatto (`skill`, `agent`, `command`, `mcp-server`) e collegarlo in `planInstall`.

### 11.3 - Integrazione nella UI del marketplace

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Integrazione nella UI del marketplace · **Size:** S · **Depends on:** 11.2 · **Spec:** [11.3-marketplace-ui.md](11.3-marketplace-ui.md)
- **Goal:** Integrare le sorgenti `git-marketplace` nelle viste ad albero Sources, Available (con raggruppamento per plugin/pacchetto) e Installed.
