# 18 — Cross-assistant sync — Summary

> **Shipped on:** 2026-08-19  
> **Initiative:** 18 — Cross-assistant sync  
> **Status:** ✅ Done and merged into main

---

## What was built

1. **planSync Core Engine (18.1)**:
   - Implemented `planSync` in `src/engine/sync.ts` across all artifact kinds (`skill`, `agent`, `command`, `mcp-server`).
   - Reads origin item directly from disk using source adapter.
   - Translates content to target assistant using canonical translators.
   - Inspects target path, detects conflicts, and returns standard `PreparedInstall` for execution via `applyInstall`.

2. **Conflict Handling & Promotion Integration (18.2)**:
   - Conflict resolution prompt (`Overwrite`, `Cancel`).
   - Supports copying from both `ManagedInstallation` and unmanaged `ObservedArtifact`.

3. **UI Wiring (18.3)**:
   - Command `AI Swissknife: Copy to Another Assistant / Scope...` (`aiSwissknife.syncItem`).
   - Inline sync action on installed and unmanaged items in the Installed view (`$(sync)`).

## Verification

- Lint (`npm run lint`): 0 errors, 0 warnings.
- Typecheck (`npm run typecheck`): Clean.
- Test suite (`npm test`): 132 tests passing out of 132.
- Build (`npm run build`): Generated bundle `dist/extension.js`.
