# 11 — Marketplace sources resolver — Implementation plan

> **Derived from spec:** [`../specs/phase-2-spec.md`](../specs/phase-2-spec.md) · [`../../SPEC.md`](../../SPEC.md)

Tasks (each = one commit):

1. **[11.1 — Claude & Kilo marketplace manifest resolver](11.1-marketplace-resolver.md)**: implement `resolveGitMarketplace` in `src/sources/gitMarketplace.ts` supporting `.claude-plugin/marketplace.json` and `marketplace-skills.json` manifests, with cache locking, ref pinning, and package construction for multi-artifact plugins.
2. **[11.2 — Marketplace content resolution & install engine](11.2-marketplace-content.md)**: implement `resolveArtifactContent` for `git-marketplace` sources across all artifact kinds (`skill`, `agent`, `command`, `mcp-server`), and wire into `planInstall`.
3. **[11.3 — Marketplace UI integration](11.3-marketplace-ui.md)**: integrate `git-marketplace` sources in Sources, Available (with plugin/package grouping), and Installed tree views.
