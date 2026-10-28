# 39 — Scheda Installed della Dashboard: bug, parità delle azioni, chiarezza degli stati — Piano di implementazione

> Fonte: feedback dell'owner con screenshot, `_inbox/analyzed/2026-10-08-dashboard-installed-feedback.md`.
> Piano inline, task espansi perché delegati. Seguito dell'iniziativa 35 (correzioni pratiche).

**Depends on:** 31, 32, 34, 35 — uniti.

> **Ordine:** prima 39.1 (bug), poi 39.4 (layout del pannello di dettaglio e barra delle azioni), poi l'iniziativa 40 (ristruttura le stesse righe in un albero comprimibile), quindi 39.2/39.3, i cui pulsanti e badge vanno collocati nelle righe figlie di 40. Il passaggio 1 di 39.3 (indagine sui dati) non dipende da 40 e può essere eseguito in qualsiasi momento.

## Rilievi (verificati nel codice)

1. **`[object Object]` è un bug.** `postMessage({ command: 'inventoryData', rowsHtml: { managedRowsHtml, observedRowsHtml } })` (`src/ui/dashboard.ts:715-722`), ma l'handler client esegue `tbody.innerHTML = msg.rowsHtml` su `#unifiedTable` (`:2034`), assegnando cioè l'intero oggetto, che viene convertito in stringa. `#observedTableBody` non viene mai aggiornato da quel messaggio, quindi la tabella Unmanaged riflette solo il primo render HTML e non i refresh successivi.
2. **Divario nelle azioni, Dashboard vs barra laterale.** Barra laterale (`package.json:~366-440`): gli elementi osservati hanno Promote, Diff (quando `:different`), Sync, Edit; gli elementi installati hanno Update, Diff (quando modificati), Sync, Move, Edit, Recommend/Unrecommend, Uninstall. Dashboard: una riga non gestita ha solo `Promote` (`:696-699`) e il suo pannello di dettaglio solo Promote (`:2178-2181`); un dettaglio gestito ha Copy, Move, Edit, Update, Uninstall (`:2182-2187`) ma nessun Preview, nessun pulsante Diff (solo la `#diffSection` condizionale), nessun Sync, nessun Recommend. Gli handler per `previewInstalledArtifact` (`:297`) e `diffInstalledArtifact` (`:311`) esistono; mancano solo i pulsanti. Nessuna delle due superfici offre la rimozione di un elemento *non gestito*.
3. **Verde vs giallo.** Entrambi sono elementi *non gestiti* il cui contenuto è stato confrontato tramite hash canonico con una sorgente registrata (`src/engine/discovery.ts:225-255`): verde `badge-success` = identico alla sorgente (`:683`), giallo `badge-warning` = differisce dalla sorgente (`:687`). Appaiono simili perché il badge è una piccola pill a basso contrasto il cui unico segnale distintivo sono due parole ("identical to" / "differs from"), e il giallo viene percepito come "avviso" sebbene "differs" sia lo stato normale di un elemento locale personalizzato. L'azione di riga è la stessa `Promote` per entrambi, anche se la conseguenza cambia (identico: collega la provenienza; differisce: promuove una copia locale che risulterà modificata, `src/ui/installedView.ts:655-658`).
4. **Dati sospetti, da verificare senza fare supposizioni:** nello screenshot 41 elementi non gestiti su 45 sono "differs from gcube-ai-toolkit" pur avendo i nomi delle skill di quel toolkit (`gcube-changelog-updater`, ...). Può trattarsi di una divergenza reale oppure di un artefatto di hash/traduzione (file extra, spazi bianchi, ordine del frontmatter). Il task 39.3 lo verifica prima di toccare il testo dei badge.

5. **Il pannello di dettaglio è incomprensibile** (screenshot dell'owner): l'origine di qualsiasi elemento osservato è la stringa cablata "local, no known origin" (`dashboard.ts:546`) anche quando la riga indica "differs from gcube-ai-toolkit"; Diff (`⇄`) e Promote (`⇧`) sono due pulsanti icona senza etichetta in blocchi non correlati; nessuna posizione, nessuno stato espresso a parole. Vedere 39.4.

## Decisioni consolidate

- Pulsanti solo icona con tooltip (35.5).
- Nessuna modifica alla semantica del motore per discovery/drift/promote.

## Questioni aperte (da risolvere con l'owner)

- ~~39-Q1~~ risolta (owner, 2026-10-08): gli elementi non gestiti possono essere rimossi, con **entrambe** le modalità: *soft* (sposta nel cestino `_deleted/`, recuperabile, predefinita) e *hard* (eliminazione permanente, irreversibile). Le stesse due modalità sono offerte per Uninstall degli elementi gestiti (coerenza; confermare con l'owner se non desiderato). Sia nella barra laterale sia nella Dashboard.
- ~~39-Q3~~ risolta (owner, 2026-10-08): l'uso di sole icone si applica alle righe compatte dell'albero (righe oggetto compresse, chip, pulsanti di riga); il pannello di dettaglio mantiene icona **e** breve etichetta di testo sulle sue azioni, perché è il punto in cui l'utente si chiede "cosa fa questo?".
- ~~39-Q2~~ risolta (owner, 2026-10-08): identical = verde "✓ Identical to <source>"; differs = neutro/info "Custom · differs from <source>" (non giallo) con Diff a singolo clic; il giallo rimane per gli elementi gestiti "modified locally".

## Tasks

### 39.2 - Parità delle azioni della Dashboard con la barra laterale (preview, diff, sync, recommend, edit, delete)

- **Status:** `in progress` (eliminazione/anteprima non gestiti aggiunti in 5e97e59 2026-10-15; mancano tabella di parità, Edit/Sync non gestiti, Recommend gestito nel dettaglio e modale Remove soft/hard su Uninstall gestito) · **Short:** Parità azioni della Dashboard · **Size:** M · **Depends on:** 39.1, 39.4, 40.2 · **Use cases:** UC026 · **Spec:** [39.2-action-parity.md](39.2-action-parity.md)
- **Goal:** Portare le azioni delle righe e del pannello di dettaglio della Dashboard alla piena parità con la barra laterale (Preview, Diff, Sync, Move, Edit, Update, Recommend/Unrecommend, Promote e Remove soft/hard).

### 39.3 - Verificare i dati di "differs", poi chiarire i badge identical/differs

- **Status:** `open` · **Short:** Chiarire badge identical e differs · **Size:** S · **Depends on:** 39.1, 40.2 · **Use cases:** UC026 · **Spec:** [39.3-status-clarity.md](39.3-status-clarity.md)
- **Goal:** Verificare se gli elementi non gestiti "differs from <source>" siano divergenze reali o artefatti di hash, quindi uniformare testi e stile dei badge tra barra laterale e Dashboard (`✓ Identical to <source>` vs neutro `Custom · differs from <source>`).

## Closed

### 39.1 - Correggere `[object Object]` e mantenere sincronizzata la tabella Unmanaged

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Correzione rendering righe inventoryData · **Size:** S · **Depends on:** - · **Use cases:** UC026 · **Spec:** [39.1-fix-inventory-rows.md](39.1-fix-inventory-rows.md)
- **Goal:** Correggere l'handler client `inventoryData` che assegna `msg.rowsHtml` come oggetto a `#unifiedTable` e mantenere sincronizzati i corpi di entrambe le tabelle gestita e non gestita durante i refresh.

### 39.4 - Pannello di dettaglio: origine calcolata, stato a parole, posizione, un'unica barra delle azioni con etichette

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Pannello di dettaglio comprensibile · **Size:** M · **Depends on:** 39.1 · **Use cases:** UC026 · **Spec:** [39.4-detail-panel.md](39.4-detail-panel.md)
- **Goal:** Ristrutturare il pannello di dettaglio della Dashboard con un'intestazione chiara, stato a parole, origine calcolata (inclusi i candidati di corrispondenza non gestiti), percorso su disco, elenco cross-framework e un'unica barra delle azioni con etichette.
