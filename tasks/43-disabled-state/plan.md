# 43 — Stato disabilitato per gli elementi installati — Piano di implementazione

> Fonte: `specs/disabled-state-study.md`; decisioni dell'owner del 2026-10-08: **D-Q1 a** layout A (`_disabled/<kind>/<name>` come *fratello* della directory scansionata sotto ciascuna root dell'assistente; fallback B `.ai-swissknife/_disabled/<assistant>/<kind>/<name>` per qualsiasi assistente che secondo lo spike scansioni la cartella sorella), **D-Q2 a** prima iterazione solo skill / agent / command, **D-Q3 a** gli elementi disabilitati restano visibili nella Dashboard, attenuati, con una pill di filtro "Disabled" e un'azione Enable, **D-Q4 a** la modalità parziale "solo manuale" (`disable-model-invocation`) è fuori ambito.
> Lo spike (43.1) fa da prerequisito a tutto il resto, come fecero 19.1 e 21.1. I task 43.2-43.4 sono **bozze**: verranno specificati per intero dopo il report di 43.1, perché il layout dipende dai suoi risultati.

**Depends on:** 40.1 (modello delle posizioni, per lo stato `disabled`), 40.2 (righe), 42.3 (collocazione delle azioni). Lo spike e i task del motore non dipendono dal lavoro sulla UI.

## Decisioni consolidate

- **I plugin Claude sono esclusi da questa iniziativa** (owner, 2026-10-08, iniziativa 45): dispongono di una disabilitazione nativa (`claude plugin disable`), quindi per essi non viene usata alcuna cartella `_disabled`.

- La disabilitazione e l'abilitazione sono un singolo `rename` (spostamento, mai copia); l'abilitazione riporta l'elemento esattamente al percorso originale; nulla viene sovrascritto durante l'abilitazione (collisione di nomi -> chiedere).
- Vocabolario visibile all'utente: stati "Disabled" / "Enabled"; ambito "Workspace" / "Global" (CONTEXT.md).
- Gli elementi gestiti mantengono il proprio record: lo stato riceve un flag `disabled` e il `path` aggiornato (incremento di `schemaVersion` dello stato + migrazione); gli elementi non gestiti sono autodescritti dal layout delle cartelle.
- La discovery/inventario deve scansionare le posizioni disabilitate; un percorso disabilitato non deve mai essere segnalato come `missing-on-disk`.

## Tasks

### 43.4 - UI: azione Disable/Enable (menu contestuale + barra di dettaglio), badge attenuato, pill di filtro "Disabled"

- **Status:** `open` (solo bozza, in attesa di 40.2 e 42.3) · **Short:** UI disabilita e abilita · **Size:** M · **Depends on:** 43.2, 43.3, 40.2, 42.3 · **Use cases:** UC029
- **Goal:** Aggiungere un'azione di attivazione/disattivazione `Disable`/`Enable` nel menu contestuale e nella barra di dettaglio, rendering attenuato/barrato per le righe disabilitate e una pill di filtro "Disabled".

## Bozze (da trasformare in file di task completi dopo 43.1)

- **43.2** `src/engine/disable.ts`: `planDisable/applyDisable(place)` e `applyEnable(place)`; percorso di destinazione per adapter tramite un nuovo `getDisabledPath(kind, name, scope)` sull'interfaccia dell'adapter (layout A predefinito, B dove indicato da 43.1); rename con rollback se la scrittura dello stato fallisce; dati per il prompt di collisione restituiti al chiamante; stato `disabled: true` + `path`; migrazione dei vecchi file di stato (nessun flag = abilitato).
- **43.3** scansionare `<root>/_disabled/<kind>/*` per assistente e ambito; gli elementi osservati trovati lì diventano posizioni con stato `disabled` (non gestiti) o vengono associati al proprio record (gestiti); il drift ignora i percorsi disabilitati; l'aggiornamento su un elemento gestito disabilitato aggiorna sul posto e resta disabilitato.
- **43.4** un'unica azione di attivazione/disattivazione `Disable` / `Enable` (icona `$(circle-slash)` / `$(play)`), nel menu contestuale e nella barra di dettaglio (regole di 42.3), rendering attenuato/barrato delle righe disabilitate con le icone consuete, pill "Disabled" nella barra dei filtri in stile Membership (40.5), Install-elsewhere e i conteggi trattano una posizione disabilitata come presente.

## Closed

### 43.1 - Spike: verificare per assistente che `_disabled/` come cartella sorella non venga caricata

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Spike cartella sorella disabilitata · **Size:** S · **Kind:** investigation · **Depends on:** - · **Use cases:** UC029 · **Spec:** [43.1-discovery-spike.md](43.1-discovery-spike.md)
- **Goal:** Verificare per assistente e ambito se una directory sorella `<assistant root>/_disabled/<kind>/<name>` venga ignorata dalla discovery e registrare i risultati in `notes/43.1-findings.md`.

### 43.2 - Motore: `disableItem` / `enableItem` per i tipi basati su file + flag di stato + migrazione

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Disabilita e abilita nel motore · **Size:** M · **Depends on:** 43.1 · **Use cases:** UC029 · **Spec:** [43.2-engine-disable-enable.md](43.2-engine-disable-enable.md)
- **Goal:** Aggiungere `getDisabledPath` sugli adapter e `planDisable`/`applyDisable`/`applyEnable` in `src/engine/disable.ts` con persistenza dello stato `disabled?: boolean` e gestione del drift.

### 43.3 - Inventario: scansione delle posizioni disabilitate, stato posizione `disabled`, nessun falso `missing-on-disk`

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Scansione inventario disabilitati · **Size:** M · **Depends on:** 43.2, 40.1 · **Use cases:** UC029 · **Spec:** [43.3-inventory-disabled.md](43.3-inventory-disabled.md)
- **Goal:** Scansionare le directory `_disabled/<kind>` degli adapter durante la discovery dell'inventario, supportare la disabilitazione/abilitazione degli elementi non gestiti e aggiungere `disabled` al modello degli stati di `Place`.
