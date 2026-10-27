# 19 — Tipo hook + merge attivo delle rule — Riepilogo

> **Shipped on:** 2026-08-19  
> **Initiative:** 19 — Tipo hook + merge attivo delle rule  
> **Status:** ✅ Completato e unito in main

---

## Cosa è stato realizzato

1. **Modello CanonicalHook e adapter (19.1 e 19.2)**:
   - Definito `CanonicalHook` (`name`, `event`, `command`, `timeout`, `extraFields`) in `src/adapters/types.ts`.
   - Adapter Claude: `.claude/hooks/<name>.json`.
   - Adapter Kilo: `.kilo/hooks/<name>.json`.
   - Adapter Copilot: `.github/hooks/<name>.json`.
   - Traduzione senza perdita `translateHook` e verifica tramite `canonicalHookHash`.

2. **Merge non distruttivo delle rule con blocchi delimitati (19.3)**:
   - L'installazione / sincronizzazione di una `rule` racchiude le istruzioni fornite in marcatori delimitati:
     `<!-- ai-swissknife:managed:${sourceId} --> ... <!-- /ai-swissknife:managed -->`
   - Sostituisce sul posto se il blocco di marcatori esiste; lo accoda in modo pulito se non esiste.
   - Le linee guida utente preesistenti in `CLAUDE.md`, `AGENTS.md` e `copilot-instructions.md` non vengono mai sovrascritte né distrutte.

3. **Rilevamento e integrazione UI (19.4)**:
   - `findHookFiles` e `findRuleFiles` in `src/sources/detect.ts`.
   - Icona hook (`zap`) e icona rule (`book`) nelle viste Available, Installed e Dashboard.

## Verification

- Lint (`npm run lint`): 0 errori, 0 avvisi.
- Typecheck (`npm run typecheck`): Pulito.
- Suite di test (`npm test`): 134 test superati su 134.
- Build (`npm run build`): Generato il bundle `dist/extension.js`.
