# Iniziativa 28 — Unificazione della navigazione nella sidebar

Guidata da [`specs/phase-7-spec.md`](../../specs/phase-7-spec.md). Implementata
direttamente (non delegata a Kilo) — entrambi i task consistono in una
composizione/ristrutturazione meccanica di codice interamente riletto durante la stesura della specifica, e
l'overhead di revisione costerebbe più di quanto potrebbe intercettare. Verificata con il gate
completo (`typecheck && lint && test && build`) più revisione manuale del diff, con la stessa
soglia di qualità di ogni task delegato in questo progetto.

Due task indipendenti, ciascuno in un singolo commit:

## Tasks

## Chiusi

### 28.1 - Unire Sources + Available in un unico albero

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Unione di Sources e Available · **Size:** M · **Depends on:** 16, 22
- **Goal:** Unificare `SourcesTreeDataProvider` e `AvailableTreeDataProvider` in un singolo albero nella sidebar in modo che l'espansione di una sorgente mostri direttamente il contenuto del suo catalogo senza accoppiamento selezione-filtro.

**Ambito:**
- `src/ui/sourcesView.ts`: `SourcesTreeDataProvider` riceve un
  `AvailableTreeDataProvider` iniettato; l'unione `SourceTreeItem` si espande fino a includere
  i tipi di nodo `Available` (meno `AvailableSourceGroupItem` e il
  rimosso `AvailablePlaceholderItem`); `getChildren`/`getTreeItem` gestiscono
  direttamente `ScopeGroupItem`/`SourceItem` e delegano tutto il resto;
  `addSource`/`removeSource` invalidano anche la cache del catalogo del provider
  iniettato.
- `src/ui/availableView.ts`: aggiungere gli accessor `getCachedSourceGroups()`/
  `getCachedRecommendedGroup()`; `installSourceGroup` accetta un
  `SourceItem` (import solo di tipo da `sourcesView.ts`, nessun ciclo a runtime)
  invece di `AvailableSourceGroupItem`; eliminare `filterSource`/
  `setFilterSource`/`AvailablePlaceholderItem`.
- `src/extension.ts`: costruire `availableProvider` prima di
  `sourcesProvider` e iniettarlo; rimuovere per `aiSwissknife.available` la chiamata `registerTreeDataProvider`
  e il collegamento `sourcesTreeView.
  onDidChangeSelection`; aggiornare il tipo del parametro nella registrazione del comando
  `installSourceGroup`.
- `package.json`: rimuovere la vista `aiSwissknife.available`; reindirizzare ogni
  menu con `view == aiSwissknife.available` nella clausola `when` verso
  `view == aiSwissknife.sources`; per `installSourceGroup` il `when` diventa
  `viewItem == sourceItem`.
- `src/ui/ui.test.ts`: aggiornare i punti di chiamata per la costruzione dei provider; aggiungere
  copertura per l'albero unificato (i figli di un `SourceItem` risolvono nella sua
  diagnostica+gerarchia; la radice include un `RecommendedGroupItem` quando
  presente).

**Verifica:**
- `npm run typecheck && npm run lint && npm test && npm run build` tutti
  verdi.
- La lettura manuale dei metodi finali `getChildren`/`getTreeItem` in
  `sourcesView.ts` conferma che ogni sottotipo di `AvailableTreeItem` della vecchia
  radice `Available` è ancora raggiungibile (diagnostica, cartelle, artefatti,
  consigliati/non risolti) senza alcun ramo perso.
- `grep -n "aiSwissknife.available"` su `package.json`/`src/` non restituisce
  nulla (completamente rimosso, nessun riferimento pendente).

### 28.2 - Raggruppamento per tipo in Installed

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Raggruppamento per tipo in Installed · **Size:** S · **Depends on:** -
- **Goal:** Aggiungere un livello intermedio di raggruppamento per tipo (`KindGroupItem`) sotto ciascun gruppo assistente/scope in `InstalledTreeDataProvider`.

**Ambito:**
- `src/ui/installedView.ts`: nuova classe `KindGroupItem`; i figli di `InstalledGroupItem`
  e `UnmanagedGroupItem` passano attraverso un livello intermedio di
  raggruppamento per tipo (ordine dei tipi stabile, vengono renderizzati solo i gruppi non vuoti); le icone dei tipi
  riutilizzano la mappatura per elemento esistente.
- `src/ui/ui.test.ts`: aggiornare/estendere la suite di `InstalledTreeDataProvider`
  per il nuovo livello intermedio.

**Verifica:**
- `npm run typecheck && npm run lint && npm test && npm run build` tutti
  verdi.
- Controllo manuale: un insieme di installazioni che copre 3+ tipi sotto un singolo
  assistente/scope renderizza un `KindGroupItem` per ciascun tipo presente, nessuno per
  i tipi assenti, e i contextValue/comandi propri di ciascun elemento restano invariati
  rispetto a prima (il raggruppamento è puramente strutturale).
