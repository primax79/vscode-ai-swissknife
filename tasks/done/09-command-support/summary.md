# 09 — Command artifact support — Summary

> **Shipped on:** 2026-08-19  
> **Initiative:** 09 — Command artifact support  
> **Status:** ✅ Done and merged into main

---

## What was built

1. **CanonicalCommand Model & Codecs (09.1)**:
   - Defined `CanonicalCommand` (`name`, `description`, `agent`, `model`, `subtask`, `body`, `extraFields`) in `src/adapters/types.ts`.
   - Claude adapter command codec (`parseClaudeCommandMarkdown`, `serializeClaudeCommandMarkdown`, `commandPath`, `readCommand`, `writeCommand`, `listCommands`).
   - Kilo adapter command codec (`parseKiloCommandMarkdown`, `serializeKiloCommandMarkdown`, `commandPath`, `readCommand`, `writeCommand`, `listCommands`) strictly enforcing Kilo's E77 schema without emitting invalid keys in frontmatter.

2. **Command Translator & Install Engine (09.2)**:
   - `translateCommand` translating between Claude and Kilo commands losslessly.
   - `canonicalCommandHash` calculating deterministic sha256 hashes.
   - `planInstall` and `applyInstall` support for `kind: 'command'` with atomic swap, backup, rollback, and state persistence.

3. **Command Discovery & UI Integration (09.3)**:
   - `findCommandFiles` in `src/sources/detect.ts`.
   - Discovery of command packages in `localFolder` and `gitCustom` resolvers.
   - Distinct terminal icon (`terminal`) for commands in Available and Installed tree views.
   - Single and batch installation of commands end-to-end.

## Verification

- Lint (`npm run lint`): 0 errors, 0 warnings.
- Typecheck (`npm run typecheck`): Clean.
- Test suite (`npm test`): 96 tests passing out of 96.
- Build (`npm run build`): Generated bundle `dist/extension.js`.
