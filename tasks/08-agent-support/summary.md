# 08 — Agent artifact support — Summary

> **Shipped on:** 2026-08-19  
> **Initiative:** 08 — Agent artifact support  
> **Status:** ✅ Done and merged into main

---

## What was built

1. **CanonicalAgent Model & Adapters (08.1)**:
   - `CanonicalAgent` defined in `src/adapters/types.ts`.
   - Claude adapter agent codec (`parseClaudeAgentMarkdown`, `serializeClaudeAgentMarkdown`, `agentPath`, `readAgent`, `writeAgent`, `listAgents`).
   - Kilo adapter agent codec (`parseKiloAgentMarkdown`, `serializeKiloAgentMarkdown`, `agentPath`, `readAgent`, `writeAgent`, `listAgents`) supporting both plural `.kilo/agents/` and singular `.kilo/agent/` locations.

2. **Agent Translator & Install Engine (08.2)**:
   - `translateAgent` translating between Claude `tools` array and Kilo `mode` + `permission` block.
   - `planInstall` and `applyInstall` support for `kind: 'agent'` with single-file atomic swap, backup, rollback, and state persistence.
   - `canonicalAgentHash` sha256 calculation for immutable preview and integrity verification.

3. **Agent Discovery & UI Integration (08.3)**:
   - `findAgentFiles` in `src/sources/detect.ts`.
   - Discovery of agent packages in `localFolder` and `gitCustom` resolvers.
   - Distinct robot icons (`robot`) and context actions for agents in Available and Installed tree views.
   - Batch and single installation of agents end-to-end.

## Verification

- Lint (`npm run lint`): 0 errors, 0 warnings.
- Typecheck (`npm run typecheck`): Clean.
- Test suite (`npm test`): 85 tests passing out of 85.
- Build (`npm run build`): Generated bundle `dist/extension.js`.
