# 15 — File watchers for consistency — Summary

> **Shipped on:** 2026-08-19  
> **Initiative:** 15 — File watchers for consistency  
> **Status:** ✅ Done and merged into main

---

## What was built

1. **Debounced FileSystemWatchers (15.1)**:
   - Implemented `setupFileWatchers` in `src/ui/watchers.ts` with 250ms debouncing.
   - Watches `.claude/`, `.kilo/`, `.github/skills/`, `.github/agents/`, `.github/prompts/`, `.vscode/mcp.json`, and `.ai-swissknife/`.

2. **Extension Lifecycle Integration (15.2)**:
   - Registered watchers in `src/extension.ts` triggering automatic refresh of `Sources` and `Installed` tree views.
   - Clean disposal on extension deactivation.

## Verification

- Lint (`npm run lint`): 0 errors, 0 warnings.
- Typecheck (`npm run typecheck`): Clean.
- Test suite (`npm test`): 126 tests passing out of 126.
- Build (`npm run build`): Generated bundle `dist/extension.js`.
