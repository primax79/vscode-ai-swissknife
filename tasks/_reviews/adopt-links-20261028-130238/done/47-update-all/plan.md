# 47 — Aggiorna tutto (Update all) — Piano di implementazione

> Fonte: richiesta del proprietario del 2026-10-08 ("I would like to be able to trigger update all"); azione A7 di `specs/actions-study.md`. Decisioni, entrambe confermate dal proprietario: **UA-Q1 (confermata dal proprietario, 2026-10-08: opzione a)** gli elementi modificati localmente vengono saltati di default; un'opzione esplicita (secondo pulsante nel riepilogo) li include salvando prima la versione dell'utente nel cestino; **UA-Q2 (confermata dal proprietario, 2026-10-08: opzione a)** il comando è disponibile per ambiente (ciascuna vista Installed della barra laterale), sulla Dashboard operando sulla selezione corrente dei filtri (pulsante della barra degli strumenti e scheda statistica cliccabile "Updates Available") e come unico comando nella palette per tutto.
> Piano inline, task espansi perché delegati.

**Depends on:** 37.1 (unito; il pattern del ciclo di applicazione), 46.4 aggiunge in seguito l'interfaccia CLI. Il posizionamento nella UI segue 42.3 una volta esistente, ma non lo attende.

## Problema (fondato sul codice)

L'aggiornamento avviene un elemento alla volta: `InstalledTreeDataProvider.doUpdateInstallation` (`src/ui/installedView.ts:471-535`) costruisce un pacchetto/artefatto segnaposto, chiama `planInstall`, mostra una modale "Update ... to latest version?", esegue `applyInstall` e poi lancia un **`checkDrift()` completo** (rilegge ogni file di stato e chiama `checkForUpstreamUpdate` per ogni installazione, eseguendo un fetch di rete per sorgente) dopo **ciascun** elemento. Farlo N volte contattando la rete costerebbe N x M operazioni di rete. La modale del singolo elemento inoltre non avvisa che un elemento modificato localmente perderà le proprie modifiche. I report di drift risiedono dentro i tree provider per assistente (mappa `driftReports`), quindi non esiste un unico punto che sappia "cosa ha un aggiornamento".

## Decisioni consolidate

- Un solo controllo di drift all'inizio (se i report mancano o sono più vecchi del controllo avviato dall'utente) e un solo aggiornamento della vista alla fine; ciascuna sorgente viene risolta **una sola volta** per esecuzione, non una per elemento.
- Applicazione sequenziale, il fallimento di un elemento non ferma mai gli altri; esito riportato per ciascun elemento (stesso pattern di `applyInstallMatrix`).
- Di default vengono aggiornati solo gli elementi `update-available`. Gli elementi `modified-locally` e `modified-and-update-available` vengono **saltati ed elencati** a meno che l'utente non scelga esplicitamente di includerli (UA-Q1); l'inclusione esplicita salva prima la versione corrente nel cestino (`_deleted/`, ripristinabile tramite l'iniziativa 42) e lo dichiara.
- Gli elementi senza sorgente, con una sorgente assente dal manifest o la cui risoluzione fallisce, e quelli `missing-on-disk` vengono elencati come "cannot update" con la relativa motivazione, mai scartati in silenzio.
- Vocabolario: "Global" / "Workspace"; righe compatte di sola icona, la finestra di dialogo di conferma usa testo esplicito.

## Tasks

## Chiusi

### 47.1 - Motore: `planUpdate` estratto dalla UI, `planUpdateAll` / `applyUpdateAll`

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Motore di update all · **Size:** M · **Depends on:** 37.1 · **Spec:** [47.1-engine-update-all.md](47.1-engine-update-all.md)
- **Goal:** Estrarre `planUpdate` in `src/engine/update.ts` e implementare `planUpdateAll` e `applyUpdateAll` con risoluzione una sola volta per sorgente e backup nel cestino per gli elementi modificati localmente.

### 47.2 - UI: comando, pulsante nella barra laterale per ambiente, pulsante nella Dashboard sulla selezione filtrata, modale di riepilogo e report dei risultati

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Attivatori UI di update all · **Size:** M · **Depends on:** 47.1 · **Spec:** [47.2-ui-update-all.md](47.2-ui-update-all.md)
- **Goal:** Aggiungere il comando `aiSwissknife.updateAll`, i pulsanti nella barra laterale per ambiente e gli attivatori nella barra degli strumenti/scheda statistica della Dashboard con una modale di riepilogo di conferma e un report dei risultati per elemento.

### 47.3 - Bloccare (hold) un elemento escludendolo da Update all (flag, contenitore nel motore, toggle e indicatore nella UI)

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Blocco elemento da update all · **Size:** S · **Depends on:** 47.1, 47.2 · **Spec:** [47.3-hold.md](47.3-hold.md)
- **Goal:** Aggiungere un flag opzionale `held` su `ManagedInstallation`, un contenitore `held` in `planUpdateAll`, e i toggle UI Hold/Release e gli indicatori a spillo così che gli elementi bloccati vengano saltati da Update all.

### 47.4 - Il controllo di drift risolve ciascuna sorgente una sola volta (prima era una per elemento: N git fetch)

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Risoluzione unica sorgenti nel drift · **Size:** S · **Depends on:** 47.1 · **Spec:** [47.4-drift-resolve-once.md](47.4-drift-resolve-once.md)
- **Goal:** Aggiungere `checkDriftForAll` in `src/engine/drift.ts` così che un controllo di drift su più installazioni risolva ciascuna sorgente una sola volta per esecuzione invece di una volta per elemento.
