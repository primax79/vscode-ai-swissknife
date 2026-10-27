# 14 — Discovery & promotion — Summary

> **Shipped on:** 2026-08-19  
> **Initiative:** 14 — Discovery & promotion  
> **Status:** ✅ Done and merged into main

---

## What was built

1. **Inventory Scanner (14.1)**:
   - Implemented `scanInstalledInventory(scope, projectRoot?, homeRoot?)` in `src/engine/discovery.ts`.
   - Scans all assistant directories across Claude Code, Kilo Code, and GitHub Copilot.
   - Compares disk items against `state.json` installations, reporting unmanaged items as `ObservedArtifact`.

2. **Promotion Engine (14.2)**:
   - Implemented `promoteObservedArtifact(observed, sourceId?, homeRoot?)` in `src/engine/discovery.ts`.
   - Computes current disk content hash (`canonicalSkillHash`, `canonicalAgentHash`, `canonicalCommandHash`, `canonicalMcpServerHash`).
   - Appends to `state.json` promoting the item to `ManagedInstallation`.

3. **UI Integration (14.3)**:
   - "Unmanaged Items" section in the Installed view with eye icon (`eye`).
   - Command `AI Swissknife: Promote to Managed` (`aiSwissknife.promoteItem`) with shield icon (`shield`).

## Verification

- Lint (`npm run lint`): 0 errors, 0 warnings.
- Typecheck (`npm run typecheck`): Clean.
- Test suite (`npm test`): 125 tests passing out of 125.
- Build (`npm run build`): Generated bundle `dist/extension.js`.
