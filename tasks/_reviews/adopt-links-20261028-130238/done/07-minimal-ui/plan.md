# 07 — UI minimale (3 viste) — Piano di implementazione

> **Derivato dalla specifica:** [../specs/foundations.md](../../specs/foundations.md)

Task (ciascuno = un commit; passare un file alla volta a un agente delegato):

## Tasks

## Decisioni condivise

Decisioni condivise per questa iniziativa che ogni task deve rispettare:

- Tre semplici viste basate su `vscode.TreeDataProvider` (SPEC.md §4 "Tree
  view in Activity Bar"), **non** webview — la Fase 1 esclude esplicitamente le
  webview di dashboard/form-editor (non-obiettivi di `specs/foundations.md`).
- Tutte e tre le viste risiedono sotto un unico nuovo contenitore dell'Activity
  Bar (come in `references/agent-hub/package.json` la voce `viewsContainers.activitybar`,
  ma con `id: "ai-swissknife"`) —
  aggiungere questo contenitore una sola volta, nel task 07.1, senza duplicarlo
  tra i task.
- `projectRoot` per qualsiasi operazione con `scope: 'project'` viene risolto a
  livello della UI — questo è l'unico punto in cui tale risoluzione è consentita
  (ogni livello inferiore lo riceve come parametro esplicito, secondo il vincolo
  puro-Node di `CONTEXT.md` già stabilito per lo store del registro). **Rivisto
  (seconda revisione Codex, rilievo I5)**: non usare per impostazione
  predefinita `workspaceFolders[0]` — in un workspace multi-root, chiedere
  all'utente di scegliere quale cartella usare; con zero cartelle,
  disabilitare/nascondere le azioni con scope di progetto. Vedere `07.1` per il
  selettore che le altre viste di questa iniziativa devono riutilizzare anziché
  duplicare.
- **Rivisto (rilievo I4)**: "refresh" corrisponde a due azioni diverse con nomi
  diversi — in `07.1` `reloadRegistry` (rilettura del file manifest dal disco,
  nessuna rete) e in `07.2` `refreshCatalog` (risoluzione/fetch effettivo delle
  sorgenti, attività reale di rete/git). Non confonderle sotto un unico comando
  o nome "Refresh".
- Le foglie del catalogo Available conservano Source + Package + Artifact e
  trasportano le diagnostiche del resolver nell'albero. Ogni anteprima o
  selettore della policy di conflitto chiuso/annullato interrompe l'operazione;
  solo la scelta esplicita di Install può chiamare apply, una sola volta.
- La rimozione di una sorgente controlla sia le installazioni locali alla
  macchina sia le `desiredInstallations` del manifest. La rimozione confermata
  rimuove anche le voci desiderate dipendenti, ma non disinstalla mai i file né
  elimina i record dello stato locale.
- Questa iniziativa dipende dalla 06 (motore di installazione, rivisto — vedere
  il relativo `plan.md`) per l'azione di installazione della vista Available, ma
  la vista Sources (07.1) dipende solo dalla 02 (registro, consolidato da 02.3)
  e può essere realizzata e testata prima che la 06 sia completata, se delegata
  separatamente.

## Chiusi

### 07.1 - Contenitore Activity Bar + vista Sources

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Activity Bar e vista Sources · **Size:** M · **Depends on:** 02.3 · **Spec:** [07.1-sources-view.md](07.1-sources-view.md)
- **Goal:** Aggiungere il contenitore dell'Activity Bar `ai-swissknife`, il selettore riutilizzabile della cartella per workspace multi-root e il `SourcesTreeDataProvider` basato sul registro con i comandi di aggiunta/rimozione/ricaricamento.

### 07.2 - Vista Available (navigazione + comando di installazione)

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Vista Available e comando install · **Size:** M · **Depends on:** 04.3, 06.1, 06.2, 07.1 · **Spec:** [07.2-available-view.md](07.2-available-view.md)
- **Goal:** Implementare `AvailableTreeDataProvider` mostrando i pacchetti risolti, gli artefatti e le diagnostiche con anteprima e installazione controllata rispetto ai conflitti.

### 07.3 - Vista Installed (basata sul registro)

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Vista Installed basata sul registro · **Size:** S · **Depends on:** 02.3, 07.1, 07.2 · **Spec:** [07.3-installed-view.md](07.3-installed-view.md)
- **Goal:** Implementare `InstalledTreeDataProvider` elencando i record `ManagedInstallation` da `state.json` raggruppati per assistente e scope.
