# 38 — Aggiornamento per singola sorgente — Piano di implementazione

> Fonte: idea del proprietario del 2026-10-08, `_inbox/analyzed/2026-10-08-per-source-refresh.md`.
> Piano inline, task espansi perché delegati. Nessuna questione aperta.

**Depends on:** 31 (livello di azioni), 33 (Dashboard Sorgenti e Catalogo) — uniti. Indipendente da 36, 37.

## Problema (fondato sul codice)

L'unico aggiornamento è globale: `AvailableProvider.refreshCatalog()` (`src/ui/availableView.ts:242`) → `doRefreshCatalog()` (`:254-356`) svuota **tutte** le cache e risolve nuovamente **ogni** sorgente in sequenza (`:302-326`). Ogni risoluzione git esegue un `git fetch --all --tags --prune` di rete (`src/sources/gitCustom.ts:97-98`), quindi aggiornare un singolo repo su cui si è appena fatto push costa il tempo di tutti, e una sorgente bloccata (es. autenticazione SSH) ritarda il resto. I pulsanti: titolo della vista nella barra laterale `aiSwissknife.refreshCatalog` (`package.json:320`), `↻` nella barra degli strumenti della Dashboard (`src/ui/dashboard.ts:975`). Le righe delle sorgenti hanno le azioni inline installSourceGroup/removeSource/openInDashboard/exportSource (`package.json:~440-460`) ma nessun aggiornamento.

## Obiettivo

Un pulsante di aggiornamento su ciascuna sorgente: azione inline nella barra laterale su `sourceItem` e un pulsante di sola icona `↻` su ogni riga sorgente della Dashboard. Risolve nuovamente **solo quella sorgente**, sostituisce sul posto il suo gruppo nel catalogo in cache e ricalcola il gruppo Recommended (che dipende dal tentativo di risoluzione di ogni sorgente, `:339-346`). Le altre sorgenti non vengono toccate né riscaricate.

## Decisioni consolidate

- Pulsante di sola icona (decisione sulla Dashboard dell'iniziativa 35.5), codicon `refresh`, tooltip "Refresh source".
- L'identità di una sorgente per l'aggiornamento è `(id, scope)`: lo stesso id può esistere in entrambi gli scope.
- Se la sorgente non esiste più nel proprio manifest, rimuovere il suo gruppo dalla cache invece di restituire un errore.
- L'aggiornamento di una singola sorgente mentre è in corso un aggiornamento completo attende quello completo (riusare l'idea di deduplicazione `refreshInFlight`); due aggiornamenti della stessa sorgente vengono deduplicati; gli aggiornamenti di sorgenti diverse possono essere eseguiti in concorrenza.

## Tasks

## Chiusi

### 38.1 - `AvailableProvider.refreshSource` (nuova risoluzione di una singola sorgente, aggiornamento sul posto della cache)

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Aggiornamento singola sorgente catalogo · **Size:** M · **Depends on:** - · **Use cases:** UC028 · **Spec:** [38.1-provider-refresh-source.md](38.1-provider-refresh-source.md)
- **Goal:** Aggiungere `AvailableTreeDataProvider.refreshSource(sourceId, scope)` per risolvere nuovamente una singola sorgente, aggiornare sul posto il suo gruppo in cache e ricalcolare le raccomandazioni senza riscaricare le altre sorgenti.

### 38.2 - Comando inline nella barra laterale + pulsante sulla riga della Dashboard collegati

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Pulsanti di aggiornamento sorgente · **Size:** S · **Depends on:** 38.1 · **Use cases:** UC028 · **Spec:** [38.2-buttons.md](38.2-buttons.md)
- **Goal:** Collegare `aiSwissknife.refreshSource` come azione inline sugli elementi sorgente della barra laterale e come pulsante di sola icona `↻` su ogni riga sorgente della Dashboard.
