# 18 — Sincronizzazione tra assistenti — Riepilogo

> **Shipped on:** 2026-08-19  
> **Initiative:** 18 — Sincronizzazione tra assistenti  
> **Status:** ✅ Completato e unito in main

---

## Cosa è stato realizzato

1. **Nucleo del motore planSync (18.1)**:
   - Implementato `planSync` in `src/engine/sync.ts` per tutti i tipi di artefatto (`skill`, `agent`, `command`, `mcp-server`).
   - Legge l'elemento di origine direttamente da disco usando l'adapter sorgente.
   - Traduce il contenuto per l'assistente di destinazione usando i traduttori canonici.
   - Ispeziona il percorso di destinazione, rileva i conflitti e restituisce uno standard `PreparedInstall` per l'esecuzione tramite `applyInstall`.

2. **Gestione dei conflitti e integrazione della promozione (18.2)**:
   - Prompt di risoluzione dei conflitti (`Overwrite`, `Cancel`).
   - Supporta la copia sia da `ManagedInstallation` sia da `ObservedArtifact` non gestiti.

3. **Collegamento UI (18.3)**:
   - Comando `AI Swissknife: Copy to Another Assistant / Scope...` (`aiSwissknife.syncItem`).
   - Azione di sincronizzazione inline sugli elementi installati e non gestiti nella vista Installed (`$(sync)`).

## Verification

- Lint (`npm run lint`): 0 errori, 0 avvisi.
- Typecheck (`npm run typecheck`): Pulito.
- Suite di test (`npm test`): 132 test superati su 132.
- Build (`npm run build`): Generato il bundle `dist/extension.js`.
