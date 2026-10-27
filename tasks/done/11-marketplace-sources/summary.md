# 11 — Marketplace sources resolver — Summary

> **Shipped on:** 2026-08-19  
> **Initiative:** 11 — Marketplace sources resolver  
> **Status:** ✅ Done and merged into main

---

## What was built

1. **Git Marketplace Resolver (11.1)**:
   - Implemented `resolveGitMarketplace` in `src/sources/gitMarketplace.ts` with clone/fetch, ref pinning, and cache synchronization under `gitMarketplaceMutex`.
   - Native parsing of `.claude-plugin/marketplace.json` and `marketplace.json` catalogs.
   - Discovery of multi-artifact plugin packages (skills, agents, commands, and MCP servers inside each plugin folder).

2. **Marketplace Content Resolution & Engine Integration (11.2)**:
   - Implemented `resolveArtifactContent` for `git-marketplace` sources across all artifact kinds (`skill`, `agent`, `command`, `mcp-server`).
   - Wired `git-marketplace` sources directly into `planInstall` and `applyInstall`.

3. **UI Integration (11.3)**:
   - Added `git-marketplace` selection in `AI Swissknife: Add Source`.
   - Wired `resolveGitMarketplace` in `AvailableTreeDataProvider.refreshCatalog()`.
   - Batch and single installation of marketplace packages and artifacts.

## Verification

- Lint (`npm run lint`): 0 errors, 0 warnings.
- Typecheck (`npm run typecheck`): Clean.
- Test suite (`npm test`): 108 tests passing out of 108.
- Build (`npm run build`): Generated bundle `dist/extension.js`.
