# 40 — Dashboard Installed: una riga comprimibile per oggetto, una riga figlia per posizione — Piano di implementazione

> Fonte: idea del proprietario del 2026-10-08, `_inbox/analyzed/2026-10-08-collapsible-installed-rows.md`; decisioni del proprietario sulla vista compressa e sull'unificazione prese lo stesso giorno (sotto).
> Piano inline, task espansi perché delegati. Ristruttura l'area toccata da 39: **eseguire prima 39.1, poi 40, infine 39.2/39.3** (i relativi pulsanti e badge vanno nelle nuove righe).

**Depends on:** 35 (vista a matrice), 39.1 (correzione del messaggio di inventario).

## Problema (fondato sul codice)

- Gli elementi gestiti sono raggruppati per `(object, scope)` (`groupByIdentityAndScope`, `src/engine/crossFrameworkLookup.ts:70`): la stessa skill installata globalmente e nel progetto produce due nodi padre. Le righe padre si aprono/chiudono con `toggleFolder` (`src/ui/dashboard.ts:1736`), partono compresse e mostrano solo le icone degli assistenti con un badge "checking…"; non c'è un espandi tutto / comprimi tutto.
- Gli elementi non gestiti vivono in una tabella piatta separata (`#observedTable`, `:1197-1215`) senza alcun raggruppamento.
- L'HTML della matrice degli elementi gestiti viene costruito **due volte**: nel percorso veloce di `update()` (`:618-672`) e in `getHtml()` (`:1267-1330`). Il bug `[object Object]` (39.1) è un sintomo di tale duplicazione.

## Obiettivo (decisioni del proprietario)

- **Un unico albero.** Una riga padre per oggetto `(kind, name)`; le righe figlie sono le *posizioni* in cui è effettivamente presente: una per `(assistant, scope)`, ciascuna con il proprio stato — gestito aggiornato / aggiornamento disponibile / modificato localmente / mancante su disco, oppure non gestito identico / differente / solo locale. La tabella separata Unmanaged scompare; il filtro Membership esistente (All / Managed / Unmanaged) filtra le righe figlie.
- **Riga compressa** = pillola del tipo, nome, una **striscia compatta di chip di posizione** (**solo l'icona** dell'assistente, **mai il nome** — stesse icone delle pillole del filtro env e della matrice attuale, `getAssistantIconPath` in `src/ui/assistantIcons.ts` — più l'**icona dello scope** (globo = Global, cartella = Workspace, da 40.4) posizionata subito accanto all'icona dell'assistente, con la coppia colorata in base allo stato di quella posizione; il nome dell'assistente e la parola dello scope compaiono solo nel tooltip) e **un badge con lo stato peggiore**, più il conteggio delle posizioni nel tooltip. I nodi padre partono compressi.
- **Icone dello scope.** Global e Workspace ottengono le proprie icone (unica fonte di verità, `scopeIcons.ts`), mostrate sempre **accoppiate con l'icona dell'ambiente** ovunque venga identificata una posizione (chip compressi, righe figlie, filtri env/scope). L'etichetta rivolta all'utente per lo scope `project` è "Workspace" (decisione in CONTEXT.md, non "Project" o "Local").
- **Barra dei filtri.** Scope e Membership diventano gruppi di pillole come Env (niente `<select>`), ed Env, Scope, Membership, Kind vengono mostrati come quattro gruppi etichettati e separati visivamente (feedback del proprietario con screenshot, 2026-10-08).
- Pulsanti **Expand all / Collapse all** nella barra degli strumenti di Installed (sola icona, 35.5), e lo stato di espansione/compressione di ciascun nodo padre sopravvive agli aggiornamenti dei dati.

## Decisioni consolidate

- I filtri si applicano alle righe figlie (a livello di posizione): un nodo padre è visibile se e solo se almeno una delle sue righe figlie supera il filtro; le righe figlie che non corrispondono vengono nascoste mentre le altre restano visibili. Il filtro testuale confronta il nome del nodo padre.
- Gli attributi `data-*` a livello di nodo padre (kind, name, stato peggiore, insieme di assistants/scopes/memberships) sono derivati dalle righe figlie così che l'ordinamento e le statistiche dell'intestazione continuino a funzionare; le statistiche contano le **posizioni**, non gli oggetti (così come oggi contano le installazioni/osservazioni).
- Un unico renderer lato server sia per l'HTML iniziale sia per l'aggiornamento `inventoryData`; il client non costruisce mai l'HTML delle righe.
- Nessuna modifica alla semantica del motore di discovery/drift/promote.

## Questioni aperte

Nessuna.

## Tasks

## Chiusi

### 40.1 - Modello puro: costruire l'albero oggetto → posizioni a partire da gestiti + osservati

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Modello ad albero oggetto-posizioni · **Size:** M · **Depends on:** - · **Use cases:** UC028 · **Spec:** [40.1-installed-tree-model.md](40.1-installed-tree-model.md)
- **Goal:** Creare `src/engine/installedTree.ts` che esporta `buildInstalledTree` per raggruppare gli elementi gestiti e non gestiti in un unico `InstalledObject` per `(kind, name)` con figli `Place` ordinati e `worstState`.

### 40.2 - Unico renderer lato server: riga compressa (striscia di chip + stato peggiore), righe figlie per posizione, filtri/ordinamento/dettaglio adattati

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Renderer unico albero installati · **Size:** L · **Depends on:** 40.1, 40.4, 39.1 · **Use cases:** UC028 · **Spec:** [40.2-single-renderer.md](40.2-single-renderer.md)
- **Goal:** Sostituire i costruttori duplicati della matrice e la tabella separata degli elementi non gestiti con un unico `renderInstalledTree` lato server che renderizza righe padre comprimibili per oggetto con strisce di chip di posizione e righe figlie di posizione.

### 40.3 - Espandi tutto / Comprimi tutto + stato di compressione mantenuto tra gli aggiornamenti

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Espandi e comprimi tutto · **Size:** S · **Depends on:** 40.2 · **Use cases:** UC028 · **Spec:** [40.3-expand-collapse-all.md](40.3-expand-collapse-all.md)
- **Goal:** Aggiungere i pulsanti icona Expand all e Collapse all alla barra degli strumenti di Installed e persistere le identità dei nodi padre espansi nello stato della webview tra gli aggiornamenti dei dati.

### 40.4 - Vocabolario dello scope (Global/Workspace) + icone come modulo condiviso — eseguire prima di 40.2

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Vocabolario e icone scope condivisi · **Size:** S · **Depends on:** - · **Use cases:** UC028 · **Spec:** [40.4-scope-icons.md](40.4-scope-icons.md)
- **Goal:** Creare `src/ui/scopeIcons.ts` come unica fonte di verità per le etichette e le icone Global/Workspace e sostituire le stringhe "Project" rivolte all'utente relative allo scope in tutta la UI.

### 40.5 - Barra dei filtri: Env/Scope/Membership/Kind come gruppi di pillole raggruppati visivamente (sostituisce i `<select>`)

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Pillole barra filtri raggruppate · **Size:** S · **Depends on:** 40.2, 40.4 · **Use cases:** UC028 · **Spec:** [40.5-filter-bar.md](40.5-filter-bar.md)
- **Goal:** Sostituire i menu a discesa `<select>` di Scope e Membership e la riga separata di tab Kind con quattro gruppi di pillole etichettati e raggruppati visivamente (ENV, SCOPE, MEMBERSHIP, KIND).
