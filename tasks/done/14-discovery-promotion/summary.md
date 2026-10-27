# 14 — Rilevamento e promozione — Riepilogo

> **Shipped on:** 2026-08-19  
> **Initiative:** 14 — Rilevamento e promozione  
> **Status:** ✅ Completato e unito in main

---

## Cosa è stato realizzato

1. **Scanner dell'inventario (14.1)**:
   - Implementato `scanInstalledInventory(scope, projectRoot?, homeRoot?)` in `src/engine/discovery.ts`.
   - Scansiona tutte le directory degli assistenti per Claude Code, Kilo Code e GitHub Copilot.
   - Confronta gli elementi su disco con le installazioni in `state.json`, segnalando gli elementi non gestiti come `ObservedArtifact`.

2. **Motore di promozione (14.2)**:
   - Implementato `promoteObservedArtifact(observed, sourceId?, homeRoot?)` in `src/engine/discovery.ts`.
   - Calcola l'hash corrente del contenuto su disco (`canonicalSkillHash`, `canonicalAgentHash`, `canonicalCommandHash`, `canonicalMcpServerHash`).
   - Aggiunge il record a `state.json` promuovendo l'elemento a `ManagedInstallation`.

3. **Integrazione UI (14.3)**:
   - Sezione "Unmanaged Items" nella vista Installed con icona occhio (`eye`).
   - Comando `AI Swissknife: Promote to Managed` (`aiSwissknife.promoteItem`) con icona scudo (`shield`).

## Verification

- Lint (`npm run lint`): 0 errori, 0 avvisi.
- Typecheck (`npm run typecheck`): Pulito.
- Suite di test (`npm test`): 125 test superati su 125.
- Build (`npm run build`): Generato il bundle `dist/extension.js`.
