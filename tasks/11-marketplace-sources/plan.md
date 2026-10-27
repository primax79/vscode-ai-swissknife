# 11 — Marketplace sources resolver — Implementation plan

> **Derived from spec:** [`../specs/phase-2-spec.md`](../specs/phase-2-spec.md) · [`../../SPEC.md`](../../SPEC.md)

Tasks (each = one commit):

## Tasks

### 11.1 - Claude & Kilo marketplace manifest resolver

- **Status:** `delivered` (merged aba6a0d 2026-08-19; commit 021ddeb) · **Short:** Marketplace manifest resolver · **Size:** M · **Depends on:** 08, 09, 10 · **Spec:** [11.1-marketplace-resolver.md](11.1-marketplace-resolver.md)
- **Goal:** Implement `resolveGitMarketplace` in `src/sources/gitMarketplace.ts` supporting `.claude-plugin/marketplace.json` and `marketplace-skills.json` manifests with cache locking, ref pinning, and multi-artifact package construction.

### 11.2 - Marketplace content resolution & install engine

- **Status:** `delivered` (merged aba6a0d 2026-08-19; commit 021ddeb) · **Short:** Marketplace content resolution · **Size:** M · **Depends on:** 11.1 · **Spec:** [11.2-marketplace-content.md](11.2-marketplace-content.md)
- **Goal:** Implement `resolveArtifactContent` for `git-marketplace` sources across all artifact kinds (`skill`, `agent`, `command`, `mcp-server`) and wire into `planInstall`.

### 11.3 - Marketplace UI integration

- **Status:** `delivered` (merged aba6a0d 2026-08-19; commit 021ddeb) · **Short:** Marketplace UI integration · **Size:** S · **Depends on:** 11.2 · **Spec:** [11.3-marketplace-ui.md](11.3-marketplace-ui.md)
- **Goal:** Integrate `git-marketplace` sources in Sources, Available (with plugin/package grouping), and Installed tree views.
