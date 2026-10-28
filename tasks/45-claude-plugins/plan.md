# 45 — Plugin di Claude Code, gestione nativa — Piano di implementazione

> Fonte: `specs/claude-plugins-study.md`; decisioni dell'owner del 2026-10-08: **CP-Q1 = C** (gestione nativa: installa, aggiorna, abilita/disabilita, disinstalla) e **CP-Q2** (tutto tramite la CLI `claude plugin`, mai modificando direttamente i file JSON di Claude). Ipotesi di lavoro, **non ancora confermate dall'owner**: **CP-Q3** i plugin appaiono dentro l'albero Installed dell'ambiente Claude (genitore = plugin, figli = i suoi componenti, costo in token sul genitore); **CP-Q4 (confermata dall'owner, 2026-10-08, dopo una spiegazione dei tre ambiti)** gli ambiti `user` / `project` (condiviso con il team tramite il repository) / `local` (privato dell'owner) di Claude corrispondono a Global / Workspace / "Workspace (private)" (badge distinto); **CP-Q5** l'installazione dalle nostre Sources verso Claude usa come impostazione predefinita un plugin nativo, mentre gli altri assistenti mantengono artefatti sciolti. (CP-Q4 è stata confermata in precedenza dall'owner.)
> **Priorità abbassata a P3 dall'owner (2026-10-08): "quando il resto è pronto"**. Lo spike 45.1 è stato avviato ed è in pausa; i suoi risultati parziali (isolamento tramite `CLAUDE_CONFIG_DIR`, posizione del binario, forme di marketplace add/list) si trovano in `notes/45.1-findings.md`.
> Piano inline, task espansi perché delegati. Lo spike 45.1 fa da prerequisito al resto.

**Depends on:** 40.1, 40.2, 40.4 (albero, righe, vocabolario degli ambiti) per i task UI; 42.3 per la collocazione delle azioni. 45.1 e 45.2 non dipendono da nulla.

## Fatti (verificati, dettagli nello studio)

`claude plugin list --json` restituisce `{id, version, scope: user|project|local, enabled, installPath, projectPath?, projectEnabled?, installedAt, lastUpdated}`; `claude plugin details <id>` restituisce l'inventario dei componenti (skills/agents/hooks/MCP/LSP) e il costo stimato in token sempre attivi; la CLI dispone inoltre di `install | uninstall | enable | disable | update | marketplace add|remove|update|list | list --available`; `install --accept-command <sha256>` protegge i marketplace che dichiarano un comando di installazione.

## Decisioni consolidate

- Meccanismo = solo CLI. Un singolo modulo wrapper (`ClaudeCli`) è l'unico codice che avvia `claude`; nient'altro legge o scrive `~/.claude/plugins/*` o le chiavi `enabledPlugins`.
- Sicurezza: non passare mai `-y` / `--accept-command` per conto dell'utente; un'installazione da sorgente comando mostra il comando dichiarato e il relativo sha256 in una modale e procede solo su conferma esplicita. Non eseguire mai `claude plugin eval`.
- La disabilitazione per i plugin è `claude plugin disable` (nativa); la cartella `_disabled` dell'iniziativa 43 non si applica.
- La disinstallazione di un plugin è il comando `uninstall` della CLI (non il nostro cestino: Claude possiede i file nella propria cache); il messaggio di conferma lo dichiara.
- Il wrapper prevede timeout, un errore chiaro "claude CLI not found" con il PATH cercato, e tollera campi JSON sconosciuti; qualsiasi output sconosciuto o fallito viene segnalato, mai interpretato a tentativi.
- Vocabolario (CONTEXT.md): "Workspace", mai "Project"; l'ambito `project` di Claude viene mostrato come Workspace.

## Tasks

### 45.1 - Spike: verificare il comportamento della CLI su cui si basa il progetto

- **Status:** `paused` (risultati parziali in notes/45.1-findings.md; in pausa dal 2026-10-08 per decisione di priorità P3 dell'owner) · **Short:** Spike CLI plugin di Claude · **Size:** S · **Kind:** investigation · **Depends on:** - · **Use cases:** UC030 · **Spec:** [45.1-cli-spike.md](45.1-cli-spike.md)
- **Goal:** Verificare l'individuazione del binario della CLI `claude plugin`, gli schemi di output JSON, la semantica degli ambiti, i flag non interattivi e il controllo di versione in una directory di configurazione isolata.

### 45.3 - Posizioni dei plugin nell'albero Installed e nella Dashboard (sola lettura), costo in token, rilevamento dei duplicati

- **Status:** `open` · **Short:** Posizioni dei plugin nella UI · **Size:** M · **Depends on:** 45.2, 40.1, 40.2, 40.4 · **Use cases:** UC030 · **Spec:** [45.3-plugin-places-in-tree.md](45.3-plugin-places-in-tree.md)
- **Goal:** Renderizzare le installazioni dei plugin Claude come posizioni di sola lettura nell'albero Installed e nella Dashboard con i componenti figli, i badge del costo in token sempre attivi e il rilevamento dei duplicati rispetto agli artefatti sciolti.

### 45.4 - Azioni: abilita/disabilita, aggiorna, disinstalla

- **Status:** `open` · **Short:** Azioni sui plugin di Claude · **Size:** M · **Depends on:** 45.3, 42.3 · **Use cases:** UC030 · **Spec:** [45.4-plugin-actions.md](45.4-plugin-actions.md)
- **Goal:** Implementare `enablePlugin`, `disablePlugin`, `updatePlugin` e `uninstallPlugin` in `ClaudeCli` e collegarli alle righe dei plugin nella barra laterale e nella Dashboard.

### 45.5 - Installazione dai marketplace, sincronizzazione dei marketplace dalle nostre Sources, scelta della modalità di installazione

- **Status:** `open` · **Short:** Installazione plugin e marketplace · **Size:** M · **Depends on:** 45.4 · **Use cases:** UC030 · **Spec:** [45.5-install-and-marketplaces.md](45.5-install-and-marketplaces.md)
- **Goal:** Supportare l'installazione nativa dei plugin Claude dai marketplace (con conferma dello sha256 per le sorgenti comando), la registrazione/aggiornamento dei marketplace Claude a partire da Sources e la scelta della modalità di installazione tra plugin nativo e artefatti sciolti.

## Closed

### 45.2 - Wrapper `ClaudeCli` + modello di lettura (list, details, marketplaces)

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Wrapper ClaudeCli e modello lettura · **Size:** M · **Depends on:** 45.1 · **Use cases:** UC030 · **Spec:** [45.2-claude-cli-wrapper.md](45.2-claude-cli-wrapper.md)
- **Goal:** Implementare `src/engine/claudeCli.ts` con risoluzione del binario e funzioni di lettura tipizzate (`listPlugins`, `listAvailablePlugins`, `pluginDetails`, `listMarketplaces`).
