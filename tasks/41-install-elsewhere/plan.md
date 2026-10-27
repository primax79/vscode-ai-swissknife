# 41 — "Install elsewhere" da una riga della Dashboard — Piano di implementazione

> Fonte: idea dell'owner del 2026-10-08, `_inbox/analyzed/2026-10-08-dashboard-installed-feedback.md` (Idea 6).
> Piano inline, task espansi perché delegati.

**Depends on:** 37.1, 37.2 (matrice assistente × ambito + flusso di installazione unificato a selezione multipla), 40.2 (righe dell'albero), 40.4 (vocabolario/icone degli ambiti).

## Esigenza (owner)

Da una riga visualizzata nella Dashboard, installarla in un altro ambiente/ambito **senza doverla cercare in Sources**: un pulsante che propone gli altri ambienti e ambiti, "come dalla sorgente".

## Problema (verificato nel codice)

- L'unico modo per elemento per collocare altrove nella Dashboard un elemento installato è `Copy to...` (`⧉`, `doSyncItem`, `src/ui/installedView.ts:557-621`), raggiungibile solo dal pannello di dettaglio **gestito** (`dashboard.ts:2182`). Copia i *file locali di quella copia* (nessuna provenienza dalla sorgente, nessuna voce nel manifest), chiede un assistente e un ambito in due QuickPick separati, elenca tutti gli assistenti abilitati incluso quello in cui si trova già e non sa quali posizioni abbiano già l'elemento. Le righe non gestite possono usarlo solo dalla barra laterale (`syncItem`).
- L'installazione "dalla sorgente" esiste solo passando dall'albero Sources / catalogo (`AvailableProvider.installArtifact`, `src/ui/availableView.ts:543`), cioè esattamente la ricerca che l'owner vuole evitare. `resolveArtifactById(sourceId, scope, artifactId)` (`:698`) mappa già un'installazione gestita al corrispondente elemento del catalogo.

## Obiettivo

Un pulsante solo icona **"Install to other environments"** (stile `+`, tooltip, regola 35.5/Q3) su ogni riga posizione e sulla riga compressa dell'oggetto:

1. Risolvere l'**origine della sorgente** dell'artefatto: gestito → `(sourceId, artifactId)` dell'installazione; non gestito → il candidato corrispondente (se ci sono più candidati, chiedere quale); nessuna origine (solo locale) → ripiegare sulla copia del contenuto della posizione cliccata (`planSync` esistente) e dichiararlo nel titolo del selettore.
2. Proporre le **posizioni mancanti**: ogni assistente abilitato × {Global, Workspace} meno le posizioni in cui questo oggetto è già presente (quelle non vengono offerte; le posizioni per cui il tipo non è supportato sono elencate disabilitate con il motivo restituito da `planInstall`). Le voci Workspace sono assenti quando nessun workspace è aperto (piano 37 Q2). Nulla è preselezionato.
3. Passare le posizioni scelte al flusso di installazione unificato di 37.2 (riepilogo finale con Preview / Install / Overwrite, rendicontazione degli esiti per target di 37.3). L'installazione da una sorgente registra la provenienza come qualsiasi installazione dal catalogo.

## Decisioni consolidate

- "Come dalla sorgente" = la **versione corrente della sorgente**, non la copia locale eventualmente modificata; la copia locale è l'origine solo quando non esiste alcuna sorgente. L'esistente `Copy to...` rimane (clona questa copia esatta) e non viene rimosso.
- Il pulsante sulla riga dell'**oggetto** (compressa) appare solo quando l'oggetto ha una sorgente registrata; gli oggetti solo locali lo ricevono sulle proprie righe posizione (origine = quella posizione).
- Il selettore delle posizioni è un QuickPick a selezione multipla di coppie `(assistant, scope)` con l'icona dell'assistente e l'icona dell'ambito (40.4); non elenca mai una posizione già esistente.
- Lo stesso pulsante appare anche per le righe non gestite (l'installazione dalla sorgente corrispondente rende inoltre gestite le nuove posizioni; l'originale non gestito viene lasciato intatto e può essere promosso separatamente).

## Questioni aperte

- ~~41-Q1~~ risolta (owner, 2026-10-08): un elemento non gestito che differisce dalla propria sorgente viene installato a partire dalla **versione della sorgente**; il titolo del selettore dichiara "from <source>"; la versione locale resta disponibile tramite `Copy to...`.

## Tasks

### 41.2 - Pulsante sulle righe + selettore delle posizioni + passaggio al flusso di 37.2

- **Status:** `open` · **Short:** Pulsante e flusso installa altrove · **Size:** M · **Depends on:** 41.1, 37.2, 40.2 · **Spec:** [41.2-dashboard-button-and-flow.md](41.2-dashboard-button-and-flow.md)
- **Goal:** Aggiungere un pulsante "Install to other environments" sulle righe della Dashboard che apre un selettore a selezione multipla delle posizioni mancanti e passa i target scelti al flusso di installazione unificato.

## Closed

### 41.1 - Modello puro: risoluzione dell'origine + posizioni mancanti per un oggetto/posizione

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Modello delle posizioni mancanti · **Size:** M · **Depends on:** 37.1 · **Spec:** [41.1-missing-places-model.md](41.1-missing-places-model.md)
- **Goal:** Creare `src/engine/missingPlaces.ts` con `resolveOrigin` e `computeMissingPlaces` per determinare l'origine da sorgente/locale e gli ambienti target candidati in cui un artefatto non è ancora installato.
