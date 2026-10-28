# 06 — Motore di installazione (pipeline) — Piano di implementazione

> **Derivato dalla specifica:** [../specs/foundations.md](../../specs/foundations.md)

**Rivisto il 2026-08-18** (seconda revisione Codex, `../_inbox/analyzed/
codex-analysis-2.md` rilievo B4, e B1/B2/B3 dalle iniziative da cui questa
dipende): entrambi i task sottostanti sono stati riscritti prima che esistesse
alcun codice per essi, in modo da dipendere dai contratti consolidati di
02.3/03.4/04.3/05.2 anziché da quelli originali incompleti. Nessuna cronologia
da preservare — considerare `06.1-plan-and-preview.md`/`06.2-apply-and-verify.md`
come l'unica versione mai esistita ai fini della delega.

Task (ciascuno = un commit; passare un file alla volta a un agente delegato):

## Tasks

## Decisioni condivise

Decisioni condivise per questa iniziativa che ogni task deve rispettare:

- La pipeline è `resolve → plan → preview → apply → verify` (SPEC.md
  §2.4) — `resolve` corrisponde ai resolver dell'iniziativa 04 (`Package[]`/
  `Artifact[]`) più `resolveArtifactContent` di 02.3 (metadati →
  contenuto reale); questa iniziativa parte da una coppia `Package`+`Artifact`
  già risolta e recupera direttamente il contenuto tramite tale funzione.
- `plan` deve essere una funzione pura priva di effetti collaterali — solo
  controlli in sola lettura di esistenza/hash, mai una scrittura. Questo è ciò
  che rende possibile `preview` prima che `apply` modifichi alcunché.
- `apply` è una **transazione su directory con staging** (staging → verifica
  staging → scambio atomico → verifica finale → persistenza dello stato →
  pulizia del backup), non una chiamata diretta al metodo di scrittura
  dell'adapter — vedere `06.2` per la sequenza esatta e la gestione dei
  fallimenti. Una verifica fallita non deve mai tradursi in una
  `ManagedInstallation` registrata.
- `apply` scrive nel **file di stato** (`writeState` di 02.3), mai nel
  manifest — le installazioni sono locali alla macchina.
- `PreparedInstall` è discriminato: i piani non supportati non contengono
  payload fittizi. I piani supportati trasportano `TranslationResult.value` più
  un unico hash canonico condiviso. L'applicazione verifica tale hash e
  l'intero snapshot dell'albero di destinazione prima di apportare modifiche,
  preserva i permessi dei file durante lo staging e segnala la necessità di
  ripristino manuale ogniqualvolta il ripristino non possa essere dimostrato.
- Solo `artifact.kind === 'skill'` è effettivamente supportato end-to-end in
  questa Fase (rule è rimandato, `tasks/CONTEXT.md`) — `plan`/`apply` devono
  dichiararlo esplicitamente (`supported: false` / `{status: 'refused'}`) per
  qualsiasi altro tipo, senza eseguire silenziosamente un no-op o sollevare
  eccezioni.
- Questa iniziativa dipende da 03 (adapter, consolidati da 03.4), 04 (resolver,
  consolidati da 04.3), 05 (traduttore, consolidato da 05.2) e 02.3 (artefatto
  risolto + separazione stato/manifest) — è la prima iniziativa che li collega
  tutti insieme, motivo per cui la seconda revisione l'ha segnalata come il
  punto in cui contratti incompleti a monte diventano costosi da scoprire.

## Chiusi

### 06.1 - Pianificazione + anteprima (rivisto)

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Piano e anteprima di installazione · **Size:** M · **Depends on:** 02.3, 03.4, 04.3, 05.2 · **Spec:** [06.1-plan-and-preview.md](06.1-plan-and-preview.md)
- **Goal:** Risolvere il contenuto reale della skill, tradurlo per l'assistente di destinazione, calcolare un'anteprima di conflitti/file rispetto a una directory di destinazione validata e restituire un `PreparedInstall` discriminato.

### 06.2 - Applicazione transazionale + verifica (rivisto)

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Applicazione transazionale e verifica · **Size:** M · **Depends on:** 06.1 · **Spec:** [06.2-apply-and-verify.md](06.2-apply-and-verify.md)
- **Goal:** Applicare un `PreparedInstall` tramite uno scambio di directory con staging con rivalidazione dello snapshot dell'albero di destinazione, verifica post-scambio, esiti di ripristino rollback e persistenza in `state.json`.
