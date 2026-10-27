# 13 — Drift & update detection — Summary

> **Shipped on:** 2026-08-19  
> **Initiative:** 13 — Drift & update detection  
> **Status:** ✅ Done and merged into main

---

## What was built

1. **Local Drift Analyzer (13.1)**:
   - Implemented `analyzeLocalDrift(installation, homeRoot?)` in `src/engine/drift.ts`.
   - Computes current disk hash across skills, agents, commands, and MCP servers.
   - Categorizes disk state into `up-to-date`, `modified-locally`, and `missing-on-disk`.

2. **Upstream Update Checker (13.2)**:
   - Implemented `checkForUpstreamUpdate(installation, source, homeRoot?)` in `src/engine/drift.ts`.
   - Resolves latest artifact content and translated hash from source repositories.
   - Detects `update-available` and `modified-and-update-available` states.

3. **UI Integration & Update Workflow (13.3)**:
   - Status indicators in **Installed** view:
     - `up-to-date`: checkmark
     - `modified-locally`: modified icon (`diff-modified`)
     - `update-available`: update badge (`cloud-download`)
     - `modified-and-update-available`: warning badge (`warning`)
     - `missing-on-disk`: error badge (`error`)
   - Commands:
     - `AI Swissknife: Check Drift & Updates` (`aiSwissknife.checkDrift`)
     - `AI Swissknife: Update to Latest Version` (`aiSwissknife.updateItem`)

## Verification

- Lint (`npm run lint`): 0 errors, 0 warnings.
- Typecheck (`npm run typecheck`): Clean.
- Test suite (`npm test`): 124 tests passing out of 124.
- Build (`npm run build`): Generated bundle `dist/extension.js`.
