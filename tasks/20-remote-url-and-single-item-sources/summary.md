# 20 — Remote-URL & git-single-item sources — Summary

> **Shipped on:** 2026-08-19  
> **Initiative:** 20 — Remote-URL & git-single-item sources  
> **Status:** ✅ Done and merged into main

---

## What was built

1. **Git Single Item Resolver (20.1)**:
   - Implemented `resolveGitSingleItem` in `src/sources/gitSingleItem.ts`.
   - Clones/fetches repos where the root itself is the artifact (`SKILL.md`, `mcp.json`, `AGENT.md`, `CLAUDE.md`).
   - Normalizes into `Package` containing 1 `Artifact`.

2. **Remote URL Resolver (20.2)**:
   - Implemented `resolveRemoteUrl` in `src/sources/remoteUrl.ts`.
   - Fetches standalone files over HTTP(S) (or `file://` URLs in testing) and caches under `~/.ai-swissknife/cache/remote/<sourceId>/`.

3. **Engine & UI Integration (20.3)**:
   - Dispatched in `src/engine/plan.ts` via unified `resolveContentFromSource`.
   - Exposed `git-single-item` and `remote-url` options in `AI Swissknife: Add Source`.

## Verification

- Lint (`npm run lint`): 0 errors, 0 warnings.
- Typecheck (`npm run typecheck`): Clean.
- Test suite (`npm test`): 136 tests passing out of 136.
- Build (`npm run build`): Generated bundle `dist/extension.js`.
