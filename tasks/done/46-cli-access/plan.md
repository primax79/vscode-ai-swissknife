# 46 — Accesso CLI a ai-swissknife — Piano di implementazione

> Fonte: `specs/mcp-cli-access-study.md`; decisione del proprietario del 2026-10-08: **"limitiamoci a cli"** (solo CLI, nessun server MCP per ora). Deciso dall'architetto (delegato dal proprietario, 2026-10-08): **MC-Q2** sola lettura di default, scritture protette da `--write`, tipi `hook`/`mcp-server` rifiutati a meno che un secondo flag non li consenta, ogni scrittura segue il flusso plan -> apply; **MC-Q3** binario parallelo a bassa priorità (prima le letture); **MC-Q4** distribuito dentro il vsix come voce `bin` più un blocco in AGENTS.md.
> Piano inline, task espansi perché delegati.

**Depends on:** 37.1 (unito: `planInstallMatrix` / `applyInstallMatrix`), 44.1 (unito: risoluzione delle sorgenti irrobustita). I task in sola lettura non toccano alcun file in `src/ui/`, quindi non entrano in conflitto con il lavoro sulla Dashboard e sull'albero.

## Contratto (si applica a ogni task della CLI)

- Binario `ai-swissknife` (`bin` del pacchetto), compilato in `dist/cli.js` dalla configurazione esbuild esistente, distribuito nel vsix, eseguibile con `node dist/cli.js`.
- **stdout è puro JSON** (un documento per invocazione), **stderr contiene i log**; codice di uscita 0 in caso di successo, diverso da zero in caso di errore, e i fallimenti stampano anche `{ "error": { "code": "...", "message": "..." } }` su stdout (stessa convenzione della CLI del debugger DAP del workspace, così gli agenti la conoscono già).
- Nessun import di `vscode` in alcun punto del bundle della CLI (un controllo in fase di build fallisce se `vscode` finisce in `dist/cli.js`).
- Radici: `--workspace <path>` (default: la directory corrente; usato per lo scope Workspace), `--home <path>` (default `os.homedir()`; usato dai test), `--assistants a,b` (default: tutti, poiché fuori dall'estensione non esiste alcuna impostazione di VS Code).
- Vocabolario: gli scope sono `global` / `project` nel JSON (valori di dominio) e documentati come Global / Workspace nel testo di `--help`.
- Nulla nella CLI mostra prompt interattivi; tutto ciò che richiederebbe una conferma è una coppia plan/apply.
- Non legge né scrive mai al di fuori delle radici note (`~/.ai-swissknife`, la directory del manifest del workspace, le directory di configurazione degli assistenti tramite gli adapter).

## Tasks

## Chiusi

### 46.1 - Scheletro della CLI + comandi in sola lettura (sources, catalog, installed, updates, item, plan-install)

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Scheletro CLI e comandi lettura · **Size:** M · **Depends on:** 37.1, 44.1 · **Use cases:** UC031, UC032, UC033 · **Spec:** [46.1-cli-read-only.md](46.1-cli-read-only.md)
- **Goal:** Compilare il bundle privo di `vscode` `dist/cli.js` (`ai-swissknife`) con stdout in puro JSON e i comandi in sola lettura `sources`, `catalog`, `installed`, `updates`, `item` e `plan-install`.

### 46.2 - Documentazione rivolta agli agenti: blocco AGENTS.md + auto-descrizione `--help --json`

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Describe CLI e doc agenti · **Size:** S · **Depends on:** 46.1 · **Use cases:** UC031, UC032, UC033 · **Spec:** [46.2-agent-docs.md](46.2-agent-docs.md)
- **Goal:** Aggiungere il comando `describe` leggibile dalle macchine generato dalle definizioni dei comandi e documentare il contratto della CLI e gli esempi in `AGENTS.md`.

### 46.3 - Lock inter-processo per lettura-modifica-scrittura di manifest/stato

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Lock di stato inter-processo · **Size:** S · **Depends on:** - · **Use cases:** UC031, UC032, UC033 · **Spec:** [46.3-state-lock.md](46.3-state-lock.md)
- **Goal:** Implementare `withStateLock` in `src/domain/stateLock.ts` con file di lock esclusivi e recupero dei lock obsoleti attorno alle sequenze di lettura-modifica-scrittura di manifest e stato.

### 46.4 - Comandi di scrittura protetti da `--write`: apply-install, uninstall (soft), aggiunta/rimozione sorgente

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Comandi di scrittura della CLI · **Size:** M · **Depends on:** 46.1, 46.3, 46.5, 47.1, 42.1 · **Use cases:** UC031, UC032, UC033 · **Spec:** [46.4-cli-writes.md](46.4-cli-writes.md)
- **Goal:** Aggiungere i comandi di scrittura della CLI con pianificazione preventiva protetti da `--write` (`apply-install`, `uninstall`, `source add/remove`, `update` e `trash list/restore/empty`).

### 46.5 - `redistribute <path|item>` v1 (installato da una cartella locale; pianificazione preventiva, `--write`)

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Comando redistribute da cartella locale · **Size:** M · **Depends on:** 46.1, 46.3, 47.1 · **Use cases:** UC031, UC032, UC033 · **Spec:** [46.5-redistribute.md](46.5-redistribute.md)
- **Goal:** Aggiungere `planRedistribute`/`applyRedistribute` e il comando CLI `redistribute` per propagare le modifiche da una sorgente `local-folder` registrata a tutte le copie installate (solo pianificazione senza `--write`).
