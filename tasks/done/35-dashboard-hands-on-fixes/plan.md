# 35 — Dashboard: correzioni dai test pratici — Piano di implementazione

> Guidata direttamente dal feedback dell'utente dopo i test pratici sul `.vsix` della Fase 9
> (iniziative 31-34), secondo lo stesso pattern con cui la Fase 7 ha rivisitato la Fase 6. Nessun
> file di specifica separato — correzioni UI mirate e ben ancorate al codice, documentate qui
> direttamente secondo l'opzione "pacchettizzate inline... per iniziative piccole/medie"
> di `tasks/AGENTS.md`.

**Depends on:** 31-34 (tutte integrate).

## Feedback (testuale, tradotto)

1. L'apertura della Dashboard mostra una schermata nera finché non termina il primo recupero
   dei dati — serve invece un guscio istantaneo con tabella vuota e indicatore di caricamento.
2. Il tab Overview è vuoto (`getOverviewHtml()` è un segnaposto letterale,
   `src/ui/dashboard.ts:636-640`).
3. La tabella piatta del tab Installed è visivamente scadente.
4. Manca una vista di confronto per strumento (skill/agent/ecc.) che mostri, per
   ciascun artefatto, quali assistenti/framework lo hanno installato — per
   confrontare gli ambienti.
5. Mancano le azioni rapide di diff e anteprima (attualmente il diff è raggiungibile solo
   tramite la sezione condizionale `#diffSection` del pannello di dettaglio,
   `src/ui/dashboard.ts:939-940`; non c'è alcuna anteprima per gli elementi già
   installati).
6. Manca un'azione rapida Update nella riga stessa della tabella (esiste solo `Edit`
   per riga, `:530,1011`; Update/Uninstall sono solo nel pannello di dettaglio
   dall'Iniziativa 34.2).
7. Nessun ordinamento per colonna (tipo/nome/scope/stato) nella vista Installed.
8. (Screenshot) Le righe degli artefatti in Sources & Catalog sono disordinate/disallineate
   — layout flex con ritorno a capo libero, non una vera tabella.
9. Usare icone al posto delle etichette di testo sui pulsanti di tutta la Dashboard,
   a meno che il testo non sia effettivamente indispensabile.

**Decisione dell'utente (chiesta direttamente, non presunta):** i punti 3+4 convergono in
un'unica riprogettazione — la matrice di confronto per strumento **sostituisce** la tabella
piatta come vista principale della sezione Installed, senza essere un selettore aggiuntivo. Il clic su una
riga continua ad aprire il pannello di dettaglio esistente (origine, diff, cross-framework,
Copy/Move/Edit/Uninstall/Update) — nessuna funzionalità viene persa, ma solo
riorganizzata per il confronto tra ambienti. Chiarimento successivo:
gli stati possono differire per assistente sullo stesso artefatto, quindi ciascun
artefatto richiede una sotto-riga per assistente e non una singola cella compressa.

Task (ciascuno = un commit):

## Tasks

## Ordine dei task e dipendenze

- **35.1, 35.2, 35.4 sono indipendenti tra loro e da 35.3**
  (sezioni/metodi diversi) — avviabili in parallelo.
- **35.3 è il task più corposo** — avviarlo dopo l'integrazione di 35.1/35.2/35.4, per
  evitare che worktree concorrenti tocchino contemporaneamente il guscio condiviso e il CSS di `dashboard.ts`
  (stessa cautela sulla sovrapposizione dei file adottata in tutta la Fase 9).
- **35.5 è rigorosamente l'ultimo** — dipende dall'integrazione di tutti gli altri quattro,
  poiché passa in rassegna il set finale di pulsanti da essi prodotto.

**Nota sulla delega:** stesso pattern della Fase 9 — `kilo_implement` con
`isolation='worktree'`, `google/gemini-3.1-pro-preview-customtools`, revisione reale
del diff prima del merge, gate completo (`typecheck && lint && test && build`,
zero avvisi) prima e dopo il merge.

## Chiusi

### 35.1 - Guscio di caricamento istantaneo

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Guscio di caricamento istantaneo · **Size:** S · **Depends on:** 31, 32, 33, 34 · **Spec:** [35.1-instant-loading-shell.md](35.1-instant-loading-shell.md)
- **Goal:** Renderizzare in modo sincrono un guscio di caricamento istantaneo con gli stili del tema e uno spinner all'apertura della Dashboard, così che non mostri mai una schermata vuota durante il caricamento dei dati.

### 35.2 - Contenuto del tab Overview

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Contenuto del tab Overview · **Size:** S · **Depends on:** 31, 32, 33, 34 · **Spec:** [35.2-overview-content.md](35.2-overview-content.md)
- **Goal:** Sostituire il segnaposto del tab Overview con una vista iniziale a colpo d'occhio che mostra chip statistici di riepilogo e gli elementi che richiedono attenzione.

### 35.3 - Vista a matrice per Installed

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Vista a matrice di Installed · **Size:** L · **Depends on:** 35.1, 35.2, 35.4 · **Spec:** [35.3-installed-matrix-view.md](35.3-installed-matrix-view.md)
- **Goal:** Sostituire la tabella piatta di Installed con una matrice di confronto espandibile per artefatto dotata di sotto-righe per assistente, azioni rapide (Preview, Diff, Update) e ordinamento per colonna.

### 35.4 - Righe del catalogo come vera tabella

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Tabella a griglia del catalogo · **Size:** S · **Depends on:** 31, 32, 33, 34 · **Spec:** [35.4-catalog-as-table.md](35.4-catalog-as-table.md)
- **Goal:** Convertire le righe di artefatti e cartelle di Sources & Catalog da layout flex a ritorno a capo libero a una tabella CSS Grid a colonne fisse.

### 35.5 - Pulsanti con sola icona in tutta la Dashboard

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Pulsanti Dashboard con sola icona · **Size:** S · **Depends on:** 35.1, 35.2, 35.3, 35.4 · **Spec:** [35.5-icon-only-buttons.md](35.5-icon-only-buttons.md)
- **Goal:** Sostituire le etichette di testo con pulsanti compatti a icona Unicode e tooltip in tutte le sezioni della Dashboard dove il testo non è indispensabile.
