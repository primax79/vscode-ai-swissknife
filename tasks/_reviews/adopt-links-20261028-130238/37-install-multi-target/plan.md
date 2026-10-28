# 37 — Installazione su più assistenti e ambiti — Piano di implementazione

> Fonte: idea dell'owner del 2026-10-08, `_inbox/analyzed/2026-10-08-install-multi-scope-multi-assistant.md`.
> Piano inline (nessuna specifica separata), task espansi perché delegati.

**Depends on:** 29 (registro degli adapter / `getEnabledAdapters`), 31 (action layer) — uniti. Indipendente da 36.

## Problema (verificato nel codice)

`AvailableProvider.installArtifact` (`src/ui/availableView.ts:543-665`) e `installBatch` (`:780-908`) sono due copie quasi identiche dello stesso flusso. Ciascuno chiede **un** assistente (QuickPick a selezione singola, `:551`/`:789`) e **un** ambito (`['project','global']`, `:566`/`:804`), pianifica una volta con `planInstall`, poi chiede una conferma modale il cui testo si ramifica su `plan.conflict` ("Overwrite" vs "Install") e applica una volta con `applyInstall`. `installFolder`, `installSourceGroup`, `doInstall*` (Dashboard) confluiscono tutti in questi due. Per installare un componente in Claude + Kilo, global + project, l'utente deve ripetere l'intero flusso fino a 4 volte.

## Flusso obiettivo (decisione dell'owner)

1. **Assistenti**: QuickPick a selezione multipla (`canPickMany`) su `getEnabledAdapters()`.
2. **Ambito**: Workspace / Global / **Both**.
3. **Passaggio finale**: un unico riepilogo del prodotto cartesiano (assistente × ambito): quali target sono nuovi, quali esistono già (conflitto), quali non sono supportati (con il motivo restituito da `planInstall`), quindi le azioni **Preview**, **Install**, **Overwrite**.

## Decisioni consolidate

- Vocabolario: l'ambito `project` è mostrato all'utente come **"Workspace"** (CONTEXT.md). Usare il letterale finché non esiste l'helper `getScopeLabel` di 40.4, poi usare quell'helper.

- Il prodotto cartesiano viene pianificato con l'esistente `planInstall` (una chiamata per target) e applicato con l'esistente `applyInstall` (una chiamata per target, che esegue già il rollback per singolo target). Nessuna modifica alla semantica del motore.
- I flussi per singolo elemento e batch sono unificati dietro un'unica funzione che accetta `items[]` (singolo = batch di un elemento), eliminando la duplicazione anziché estendere entrambe le copie.
- I nomi e le firme dei metodi pubblici (`installArtifact`, `installFolder`, `installSourceGroup`, `doInstall*`, `installBatch`) restano invariati; cambiano solo le loro implementazioni interne.

## Questioni aperte (da risolvere con l'owner prima di avviare 37.2)

- ~~37-Q1~~ risolta (owner, 2026-10-08): la modale finale offre `Preview` / `Install` (solo nuovi target, quelli esistenti vengono saltati) / `Overwrite` (sostituisce anche quelli esistenti); senza conflitti viene mostrato solo `Install` (più `Preview`).
- ~~37-Q2~~ risolta (owner, 2026-10-08): il fatto che un workspace sia aperto è noto prima del passaggio di scelta dell'ambito, quindi senza workspace il passaggio dell'ambito offre solo Global (Workspace e Both non vengono mostrati, con un suggerimento su una riga "open a folder to enable workspace scope"). Nessuna logica di fallback o di salto dopo la scelta.
- ~~37-Q3~~ risolta (owner, 2026-10-08): nessuna preselezione e nessuno stato "ultimo usato" persistito; la selezione multipla parte senza elementi selezionati.

## Tasks

### 37.2 - Flusso di installazione unificato a selezione multipla in `availableView.ts`

- **Status:** `open` · **Short:** Flusso installazione multi-selezione · **Size:** M · **Depends on:** 37.1 · **Spec:** [37.2-multi-select-flow.md](37.2-multi-select-flow.md)
- **Goal:** Unificare `installArtifact` e `installBatch` in `src/ui/availableView.ts` dietro un singolo flusso con selezione multipla degli assistenti, selezione dell'ambito Workspace/Global/Both e una modale di riepilogo con Preview/Install/Overwrite.

### 37.3 - Rendicontazione degli esiti per target e gestione dei fallimenti parziali

- **Status:** `open` · **Short:** Report esiti installazione target · **Size:** S · **Depends on:** 37.2 · **Spec:** [37.3-result-reporting.md](37.3-result-reporting.md)
- **Goal:** Sostituire le notifiche di installazione per singolo flusso con un'unica notifica di riepilogo (`applied / skipped / unsupported / failed`), un canale di output "Show details" in caso di errore e un unico refresh finale.

## Closed

### 37.1 - Helper del motore: pianificare la matrice assistente × ambito e riepilogarla

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Helper matrice di installazione · **Size:** M · **Depends on:** - · **Spec:** [37.1-target-matrix.md](37.1-target-matrix.md)
- **Goal:** Creare `src/engine/installMatrix.ts` con `planInstallMatrix` e `applyInstallMatrix` per pianificare e applicare sequenzialmente le installazioni sul prodotto cartesiano assistente × ambito.
