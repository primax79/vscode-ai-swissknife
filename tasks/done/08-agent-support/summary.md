# 08 — Supporto agli artefatti agent — Riepilogo

> **Shipped on:** 2026-08-19  
> **Initiative:** 08 — Supporto agli artefatti agent  
> **Status:** ✅ Completato e unito in main

---

## Cosa è stato realizzato

1. **Modello CanonicalAgent e Adapter (08.1)**:
   - `CanonicalAgent` definito in `src/adapters/types.ts`.
   - Codec degli agent nell'adapter Claude (`parseClaudeAgentMarkdown`, `serializeClaudeAgentMarkdown`, `agentPath`, `readAgent`, `writeAgent`, `listAgents`).
   - Codec degli agent nell'adapter Kilo (`parseKiloAgentMarkdown`, `serializeKiloAgentMarkdown`, `agentPath`, `readAgent`, `writeAgent`, `listAgents`) con supporto sia per il percorso plurale `.kilo/agents/` sia per quello singolare `.kilo/agent/`.

2. **Traduttore degli agent e motore di installazione (08.2)**:
   - `translateAgent` che traduce tra l'array `tools` di Claude e il blocco `mode` + `permission` di Kilo.
   - Supporto in `planInstall` e `applyInstall` per `kind: 'agent'` con scambio atomico a file singolo, backup, rollback e persistenza dello stato.
   - Calcolo sha256 `canonicalAgentHash` per anteprima immutabile e verifica dell'integrità.

3. **Discovery degli agent e integrazione nella UI (08.3)**:
   - `findAgentFiles` in `src/sources/detect.ts`.
   - Discovery dei pacchetti agent nei resolver `localFolder` e `gitCustom`.
   - Icone robot distinte (`robot`) e azioni contestuali per gli agent nelle viste ad albero Available e Installed.
   - Installazione singola e in batch degli agent end-to-end.

## Verification

- Lint (`npm run lint`): 0 errori, 0 avvisi.
- Typecheck (`npm run typecheck`): Pulito.
- Suite di test (`npm test`): 85 test superati su 85.
- Build (`npm run build`): Generato il bundle `dist/extension.js`.
