# 09 — Supporto agli artefatti command — Riepilogo

> **Shipped on:** 2026-08-19  
> **Initiative:** 09 — Supporto agli artefatti command  
> **Status:** ✅ Completato e unito in main

---

## Cosa è stato realizzato

1. **Modello CanonicalCommand e Codec (09.1)**:
   - Definito `CanonicalCommand` (`name`, `description`, `agent`, `model`, `subtask`, `body`, `extraFields`) in `src/adapters/types.ts`.
   - Codec dei command nell'adapter Claude (`parseClaudeCommandMarkdown`, `serializeClaudeCommandMarkdown`, `commandPath`, `readCommand`, `writeCommand`, `listCommands`).
   - Codec dei command nell'adapter Kilo (`parseKiloCommandMarkdown`, `serializeKiloCommandMarkdown`, `commandPath`, `readCommand`, `writeCommand`, `listCommands`) applicando rigorosamente lo schema E77 di Kilo senza emettere chiavi non valide nel frontmatter.

2. **Traduttore dei command e motore di installazione (09.2)**:
   - `translateCommand` che traduce senza perdita i command tra Claude e Kilo.
   - `canonicalCommandHash` che calcola hash sha256 deterministici.
   - Supporto in `planInstall` e `applyInstall` per `kind: 'command'` con scambio atomico, backup, rollback e persistenza dello stato.

3. **Discovery dei command e integrazione nella UI (09.3)**:
   - `findCommandFiles` in `src/sources/detect.ts`.
   - Discovery dei pacchetti command nei resolver `localFolder` e `gitCustom`.
   - Icona terminale distinta (`terminal`) per i command nelle viste ad albero Available e Installed.
   - Installazione singola e in batch dei command end-to-end.

## Verification

- Lint (`npm run lint`): 0 errori, 0 avvisi.
- Typecheck (`npm run typecheck`): Pulito.
- Suite di test (`npm test`): 96 test superati su 96.
- Build (`npm run build`): Generato il bundle `dist/extension.js`.
