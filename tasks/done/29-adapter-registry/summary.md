# 29 — Registro degli adapter e configurazione degli assistenti abilitati — Riepilogo

> **Closed on:** 2026-10-27 (riordino del registro; verificatore ai-coding-tools-c1)  
> **Initiative:** 29 — Registro degli adapter e configurazione degli assistenti abilitati  
> **Status:** ✅ Completata e integrata in main

Riepilogo scritto alla chiusura a partire dal piano e dalla cronologia git; le specifiche per singolo task in questa cartella contengono i dettagli.

## Cosa è stato realizzato

- **29.1 `Adapter` acquisisce `displayName`/`iconId`** — integrato 4d7d654 2026-09-08. Aggiungere i campi descrittivi `displayName` e `iconId` direttamente sull'interfaccia `Adapter` e sulle sue cinque implementazioni adapter.
- **29.2 `src/adapters/registry.ts`** — integrato de6c9f3 2026-09-08. Creare `src/adapters/registry.ts` come unica fonte di verità che esporta `ALL_ADAPTERS`, `getAdapter` e `getAdapterWithHomeRoot`.
- **29.3 Migrare ogni punto duplicato di selezione dell'adapter** — integrato 8cb71e5 2026-09-08. Eliminare le copie duplicate di `getAdapter()` e gli array letterali degli assistenti in tutta la codebase e sostituirli con chiamate a `src/adapters/registry.ts`.
- **29.4 Impostazione VS Code per gli assistenti abilitati** — integrato c2be2a0 2026-09-08. Aggiungere la configurazione VS Code `aiSwissknife.enabledAssistants`, `getEnabledAdapters()` e la registrazione delle viste della sidebar guidata dal registro con chiavi di contesto `when` per singola vista.
- **29.5 Comando "Configure enabled assistants"** — integrato 80a9bd8 2026-09-08. Aggiungere il comando QuickPick a selezione multipla `aiSwissknife.configureEnabledAssistants` e ristrutturare `aiSwissknife.enabledAssistants` come oggetto di booleani.

## Verification

- Il lavoro di ogni task è integrato in `main` (evidenza: i commit indicati sopra, da `git log --grep '<id>'`).
- `npm test` su `main` a 5e85109 (2026-10-27): 577 test, 576 superati, 0 falliti, 1 saltato opzionale (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errori.
