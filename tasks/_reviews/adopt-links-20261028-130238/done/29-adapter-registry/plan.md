# 29 — Registro degli adapter e configurazione degli assistenti abilitati — Piano di implementazione

> **Derivato dalla specifica:** [`../specs/adapter-and-source-registries.md`](../../specs/adapter-and-source-registries.md)

## Tasks

## Ordine dei task e dipendenze

- **29.1 blocca 29.2** (il modulo del registro importa l'interfaccia/le classi arricchite; non è strettamente necessario affinché `getAdapter`/`getAdapterWithHomeRoot` superino il controllo dei tipi senza i nuovi campi, ma lo scopo stesso di 29.2 perde senso senza di essi, quindi eseguire prima 29.1).
- **29.2 blocca 29.3** (non c'è nulla *verso cui* migrare i punti di chiamata finché il registro non esiste).
- **29.3 blocca 29.4** (29.4 itera su `ALL_ADAPTERS` in `extension.ts` dentro `activate()` — operazione più pulita una volta che gli array letterali duplicati di quel file sono già stati rimossi con 29.3, così le due modifiche allo stesso file non entrano in conflitto).
- **29.4 blocca 29.5** (il comando scrive nell'impostazione dichiarata da 29.4).
- Indipendente dall'iniziativa 30 (registro dei risolutori di sorgenti) — nessun codice condiviso, possono essere eseguite in qualsiasi ordine o in parallelo.

**Nota sulla delega:** ciascun task sottostante è dimensionato per un singolo passaggio di consegne tramite `kilo_implement`
(pacchettizzazione espansa, secondo `tasks/AGENTS.md`). Indirizzare l'agente al
singolo file del task + questa specifica + `tasks/CONTEXT.md` — non all'intero albero `tasks/`.

## Chiusi

### 29.1 - `Adapter` acquisisce `displayName`/`iconId`

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Campi nome e icona Adapter · **Size:** S · **Depends on:** 03, 12, 21 · **Spec:** [29.1-adapter-interface-fields.md](29.1-adapter-interface-fields.md)
- **Goal:** Aggiungere i campi descrittivi `displayName` e `iconId` direttamente sull'interfaccia `Adapter` e sulle sue cinque implementazioni adapter.

### 29.2 - `src/adapters/registry.ts`

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Modulo registro degli adapter · **Size:** S · **Depends on:** 29.1 · **Spec:** [29.2-adapter-registry-module.md](29.2-adapter-registry-module.md)
- **Goal:** Creare `src/adapters/registry.ts` come unica fonte di verità che esporta `ALL_ADAPTERS`, `getAdapter` e `getAdapterWithHomeRoot`.

### 29.3 - Migrare ogni punto duplicato di selezione dell'adapter

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Migrazione chiamate agli adapter · **Size:** M · **Depends on:** 29.2 · **Spec:** [29.3-migrate-call-sites.md](29.3-migrate-call-sites.md)
- **Goal:** Eliminare le copie duplicate di `getAdapter()` e gli array letterali degli assistenti in tutta la codebase e sostituirli con chiamate a `src/adapters/registry.ts`.

### 29.4 - Impostazione VS Code per gli assistenti abilitati

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Impostazione assistenti abilitati · **Size:** M · **Depends on:** 29.3 · **Spec:** [29.4-enabled-assistants-setting.md](29.4-enabled-assistants-setting.md)
- **Goal:** Aggiungere la configurazione VS Code `aiSwissknife.enabledAssistants`, `getEnabledAdapters()` e la registrazione delle viste della sidebar guidata dal registro con chiavi di contesto `when` per singola vista.

### 29.5 - Comando "Configure enabled assistants"

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Comando di configurazione assistenti · **Size:** S · **Depends on:** 29.4 · **Spec:** [29.5-configure-command.md](29.5-configure-command.md)
- **Goal:** Aggiungere il comando QuickPick a selezione multipla `aiSwissknife.configureEnabledAssistants` e ristrutturare `aiSwissknife.enabledAssistants` come oggetto di booleani.
