# 42 — Azioni sugli elementi, completamento Tier 1 — Piano di implementazione

> Fonte: `specs/actions-study.md` (decisioni dell'owner del 2026-10-08: Tier 1 sì, nessun registro delle azioni; UI del cestino, limite delle icone inline e Tier 2/3 delegati all'architetto: "mi fido di te", risultato da valutare insieme in seguito).
> Piano inline, task espansi perché delegati. Integra **39.2** (parità, Remove soft/hard, Recommend sulle righe), che copre già le azioni A1, A2, A5, A18 dello studio.

**Depends on:** 39.2 (remove), 40.2 (righe), 40.4 (vocabolario e icone degli ambiti).

## Decisioni consolidate

- Nessun registro/astrazione: i pulsanti e le voci di menu vengono aggiunti a mano (sezione 3 dello studio).
- **AS-Q3 risolta (owner, 2026-10-08): tutte e tre le superfici del cestino**: un comando QuickPick (42.1), una scheda Trash nella Dashboard (42.4) e una vista Trash nella barra laterale (42.5), tutte basate sulle stesse funzioni del motore (`listTrash` / `restoreFromTrash`). Nota sulla barra laterale: si tratta di un'unica vista `Trash` dedicata e compressa (non un nodo dentro ogni vista assistente), mostrata solo quando il cestino non è vuoto, così la barra laterale compatta resta pulita quando non c'è nulla da ripristinare.
- **AS-Q4 risolta (owner, 2026-10-08):** sempre inline **Favorite, Update, Uninstall** (abilitati/disabilitati in base allo stato, posizioni stabili); tutto il resto applicabile allo stato va nel **menu contestuale**. Le righe non gestite ricevono il proprio terzetto fisso Promote / Diff / Remove. Righe della Dashboard: stesso terzetto + un menu di overflow `...`. Le righe compatte sono solo icona; il pannello di dettaglio ha icona + etichetta.
- Le azioni Tier 2/3 (aggiorna tutto, ripara, rimuovi dalla gestione, ripristina modifiche, selezione multipla, allinea/confronta posizioni) **non** rientrano in questa iniziativa; verranno valutate con l'owner dopo il rilascio del Tier 1 (`AS-Q5`).

## Tasks

### 42.4 - Scheda Trash della Dashboard: elenco, Restore, Delete permanently, Empty trash

- **Status:** `open` · **Short:** Scheda Trash della Dashboard · **Size:** M · **Depends on:** 42.1, 40.4 · **Spec:** [42.4-dashboard-trash-tab.md](42.4-dashboard-trash-tab.md)
- **Goal:** Aggiungere una quinta scheda della Dashboard con caricamento lazy (`Trash`) che elenca gli elementi eliminati con le azioni Restore, Delete permanently ed Empty trash.

### 42.5 - Vista Trash nella barra laterale (compressa, solo se non vuota): elenco, Restore, Delete permanently, Empty trash

- **Status:** `open` · **Short:** Vista Trash barra laterale · **Size:** S · **Depends on:** 42.1 · **Spec:** [42.5-sidebar-trash-view.md](42.5-sidebar-trash-view.md)
- **Goal:** Aggiungere una vista `aiSwissknife.trash` nella barra laterale, compressa per impostazione predefinita e visibile solo quando il cestino non è vuoto, con le azioni inline Restore e Delete permanently.

### 42.2 - Helper di navigazione: mostra nel Finder, copia percorso, apri repository/commit della sorgente

- **Status:** `open` · **Short:** Comandi helper di navigazione · **Size:** S · **Depends on:** 40.2 · **Spec:** [42.2-navigation-helpers.md](42.2-navigation-helpers.md)
- **Goal:** Aggiungere i comandi `revealInOS`, `copyPath` e `openSourceRepo` accessibili dal menu contestuale della barra laterale e dal pannello di dettaglio della Dashboard.

### 42.3 - Terzetto inline fisso (Favorite/Update/Uninstall; non gestiti: Promote/Diff/Remove) + menu contestuale in base allo stato + overflow sulle righe della Dashboard

- **Status:** `open` · **Short:** Terzetto inline fisso e overflow · **Size:** M · **Depends on:** 39.2, 40.2, 42.2 · **Spec:** [42.3-surface-policy.md](42.3-surface-policy.md)
- **Goal:** Applicare un terzetto fisso di azioni inline sulle righe della barra laterale e della Dashboard (Favorite/Update/Uninstall per i gestiti; Promote/Diff/Remove per i non gestiti) collocando le restanti azioni applicabili allo stato nel menu contestuale/di overflow.

## Closed

### 42.1 - Ripristino dal cestino + Svuota cestino: motore (`listTrash`, `restoreFromTrash`, `deleteFromTrash`, `emptyTrash`) e comandi

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Ripristina e svuota cestino · **Size:** M · **Depends on:** 39.2 · **Spec:** [42.1-restore-from-trash.md](42.1-restore-from-trash.md)
- **Goal:** Aggiungere il tracciamento tramite sidecar `.origin.json` e le funzioni del motore `listTrash`, `restoreFromTrash`, `deleteFromTrash` ed `emptyTrash` insieme ai comandi `restoreFromTrash` ed `emptyTrash`.
