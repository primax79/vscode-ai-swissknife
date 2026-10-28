# 36 — Wizard di aggiunta sorgente — Piano di implementazione

> Fonte: idea del proprietario del 2026-10-08, `_inbox/analyzed/2026-10-08-add-source-wizard.md`.
> Riscrittura UX contenuta e ben fondata di un singolo metodo; nessuna specifica separata (opzione
> inline di `tasks/AGENTS.md`), task espansi perché delegati.

**Depends on:** 29, 30 (registro dei resolver), 31 (livello di azioni della Dashboard) — tutti uniti.

## Problema (fondato sul codice)

`SourcesProvider.addSource(forceScope?)` (`src/ui/sourcesView.ts:173-280`) chiede, in
questo ordine: scope → tipo → **id** → nome visualizzato → posizione (URL o percorso) →
scelta del ref (branch/tag/default, seguita da un ulteriore input) — fino a 7 prompt, con
le domande meno informative (id, nome) per prime e quella più informativa
(posizione) per quinta. Nulla viene derivato dalla posizione.

## Flusso obiettivo (decisione del proprietario, rivista il 2026-10-08)

1. **Tipo** (QuickPick di `ALL_SOURCE_RESOLVERS`, usando `displayName`/`iconThemeId` di ciascun resolver invece degli id grezzi).
2. **Scope**: selezione multipla Global e/o Workspace (almeno uno). Saltato quando viene passato `forceScope` (pulsanti `+` della Dashboard, `recommendations.ts:271`).
3. **Posizione**: i tipi git e `remote-url` chiedono un unico URL condiviso da tutti gli scope selezionati. `local-folder` chiede **un percorso per ciascuno scope selezionato, in modo indipendente** (ciascuno validato rispetto al vincolo del proprio scope, così che un percorso globale sotto la home e un percorso di progetto dentro il workspace possano differire).
4. **Dettagli, precompilati dalla posizione**: `id` (slug del nome del repo/cartella, dalla prima posizione inserita) e `name`; una casella di input ciascuno, Invio accetta. Branch/tag non viene chiesto di default per i tipi git (si assume il branch di default); il fissaggio a un ref è raggiungibile solo tramite un passo opzionale esplicito (Q2).
5. Scrivere un `DesiredSource` per ciascuno scope selezionato, con stessi id/nome/tipo e con la posizione propria di quello scope.

## Decisioni consolidate

- Vocabolario: lo scope `project` è mostrato all'utente come **"Workspace"** (CONTEXT.md). Usare la stringa letterale finché non esiste `getScopeLabel` di 40.4, poi usare quell'helper.

- Prima il tipo, poi gli scope, poi la posizione (proprietario, rivisto). Motivo: chiedere gli scope all'inizio permette a `local-folder` di chiedere il percorso giusto per ciascuno scope, eliminando il vecchio ripiego "Entrambi solo quando un unico percorso soddisfa entrambi i vincoli".
- Le posizioni `local-folder` sono per scope; git/remote-url sono condivisi.
- `addSource(forceScope?)` mantiene la sua firma e il valore di ritorno (`Source | undefined`; quando vengono scritti più scope, restituisce il primo): tre chiamanti dipendono da questo (`extension.ts:242`, `dashboard.ts:127`, `recommendations.ts:271`).
- La logica del wizard che non richiede `vscode` (derivazione, validazione) risiede in un modulo puro così da essere testabile unitariamente senza l'extension host.

## Questioni aperte (da risolvere con il proprietario prima di delegare 36.2/36.3)

- ~~36-Q1 ("Both" + `local-folder`)~~ risolta: scope chiesti all'inizio, percorso chiesto in modo indipendente per ciascuno scope.
- ~~36-Q2~~ risolta (proprietario, 2026-10-08): il fissaggio di branch/tag è fuori dal flusso principale; si assume il branch di default; il fissaggio è un passo opzionale "Advanced: pin to branch/tag".
- ~~36-Q3~~ risolta (proprietario, 2026-10-08): stesso id già presente in uno scope scelto → modale "Replace?" per scope invece della sovrascrittura silenziosa in `src/ui/sourcesView.ts:268`; rispondere No salta solo quello scope.
- ~~36-Q4~~ risolta (proprietario, 2026-10-08, rivista): il workspace è noto prima del passo dello scope, quindi senza workspace la selezione multipla dello scope offre solo Global (Workspace non mostrato, con un suggerimento su una riga). Nessuna logica di scarto post-selezione.

## Tasks

## Chiusi

### 36.1 - Helper puro: validazione della posizione + derivazione di id/nome

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Valida posizione e deriva default · **Size:** S · **Depends on:** - · **Spec:** [36.1-derive-source-defaults.md](36.1-derive-source-defaults.md)
- **Goal:** Creare `src/sources/sourceDefaults.ts` che esporta `validateLocation` e `deriveSourceDefaults` per validare URL/percorsi e derivare `id` e `name` della sorgente senza importare `vscode`.

### 36.2 - Riscrittura di `addSource` come wizard tipo → scope → posizione → dettagli (scope singolo)

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Flusso wizard aggiunta sorgente · **Size:** M · **Depends on:** 36.1 · **Spec:** [36.2-wizard-flow.md](36.2-wizard-flow.md)
- **Goal:** Riscrivere `SourcesProvider.addSource(forceScope?)` in un flusso wizard tipo → scope → posizione → id/nome precompilati con assunzione del branch di default e fissaggio opzionale di branch/tag.

### 36.3 - Selezione multi-scope (una scrittura per scope, percorsi locali per scope) + gestione degli id duplicati

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Wizard aggiunta sorgente multi-scope · **Size:** S · **Depends on:** 36.2 · **Spec:** [36.3-scope-both.md](36.3-scope-both.md)
- **Goal:** Trasformare il passo dello scope di aggiunta sorgente in una selezione multipla (Global e/o Workspace), chiedere percorsi per scope per `local-folder` e chiedere "Replace?" in caso di ID sorgente duplicati per scope.
