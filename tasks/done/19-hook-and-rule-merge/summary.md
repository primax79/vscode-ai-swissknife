# 19 — Hook kind + active rule merge — Summary

> **Shipped on:** 2026-08-19  
> **Initiative:** 19 — Hook kind + active rule merge  
> **Status:** ✅ Done and merged into main

---

## What was built

1. **CanonicalHook Model & Adapters (19.1 & 19.2)**:
   - Defined `CanonicalHook` (`name`, `event`, `command`, `timeout`, `extraFields`) in `src/adapters/types.ts`.
   - Claude adapter: `.claude/hooks/<name>.json`.
   - Kilo adapter: `.kilo/hooks/<name>.json`.
   - Copilot adapter: `.github/hooks/<name>.json`.
   - `translateHook` lossless translation and `canonicalHookHash` verification.

2. **Non-Destructive Demarcated Rule Merge (19.3)**:
   - Installing / syncing a `rule` wraps contributed instructions in demarcated markers:
     `<!-- ai-swissknife:managed:${sourceId} --> ... <!-- /ai-swissknife:managed -->`
   - Replaces in-place if marker block exists; appends cleanly if it does not.
   - Pre-existing user guidelines in `CLAUDE.md`, `AGENTS.md`, and `copilot-instructions.md` are never overwritten or destroyed.

3. **Discovery & UI Integration (19.4)**:
   - `findHookFiles` and `findRuleFiles` in `src/sources/detect.ts`.
   - Hook icon (`zap`) and rule icon (`book`) in Available, Installed, and Dashboard views.

## Verification

- Lint (`npm run lint`): 0 errors, 0 warnings.
- Typecheck (`npm run typecheck`): Clean.
- Test suite (`npm test`): 134 tests passing out of 134.
- Build (`npm run build`): Generated bundle `dist/extension.js`.
