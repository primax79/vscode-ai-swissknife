# 22 — Installazioni consigliate a livello di progetto — Piano di implementazione

> **Derived from spec:** [`../specs/project-recommendations.md`](../../specs/project-recommendations.md)
> **Revisionato il 2026-09-07** dopo che una revisione indipendente di Codex ha rilevato una dipendenza
> circolare tra l'ordinamento originale di 22.3/22.4 e un design non sicuro di
> risoluzione automatica all'apertura — vedere la nota "Reviewed by" della specifica e i richiami
> nei singoli task.

Task (ciascuno = un commit):

## Tasks

## Ordine dei task e vincoli di sequenza

- **22.2 blocca 22.3 e 22.4** — entrambi chiamano la stessa funzione di
  risoluzione, quindi questa deve essere implementata e testata per prima.
- **22.3 blocca 22.4** — l'azione `Review` di 22.4 e la sua azione `Install All`
  riutilizzano rispettivamente il filtro Recommended e l'esecutore di installazione di 22.3; la
  bozza originale aveva questo ordine invertito (la "Review" di 22.4 richiedeva un filtro che
  un 22.3 ordinato successivamente non aveva ancora costruito) ed è stata corretta.
- **22.1 è indipendente da 22.2-22.4** (scrive/decora solamente
  `desiredInstallations`; la risoluzione lo legge) e **22.5 è indipendente da
  tutti e quattro** (centralizzato in `writeManifest`, non in un gestore UI) — entrambi
  potrebbero essere rilasciati in parallelo agli altri, ma sono elencati in ordine di lettura
  per un singolo agente che lavora sull'iniziativa in modo sequenziale.

## Closed

### 22.1 - Comandi recommend/unrecommend + decorazione dell'albero

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Comandi recommend e unrecommend · **Size:** S · **Depends on:** 02, 07 · **Spec:** [22.1-recommend-commands.md](22.1-recommend-commands.md)
- **Goal:** Aggiungere azioni del menu contestuale sugli elementi Available e Installed per scrivere o rimuovere voci `DesiredInstallation` nel manifesto del progetto con una decorazione Recommended e l'aggiornamento di entrambe le viste.

### 22.2 - Motore di risoluzione delle raccomandazioni

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Motore risoluzione raccomandazioni · **Size:** M · **Depends on:** 02, 06 · **Spec:** [22.2-resolution-engine.md](22.2-resolution-engine.md)
- **Goal:** Implementare la funzione pura `resolveRecommendations` in `src/engine/recommendations.ts` classificando `desiredInstallations` rispetto a `state.json` e ai tentativi di risoluzione delle sorgenti in `satisfied`, `pending` e `broken`.

### 22.3 - Comando "Install Recommended" + filtro "Recommended" nella vista Available

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Install Recommended e gruppo albero · **Size:** M · **Depends on:** 22.2 · **Spec:** [22.3-install-recommended.md](22.3-install-recommended.md)
- **Goal:** Aggiungere il comando `aiSwissknife.installRecommended` e il raggruppamento `Recommended` in `AvailableTreeDataProvider` usando l'installazione sull'assistente/scope di destinazione specifico di ciascuna voce.

### 22.4 - Rilevamento all'apertura del workspace + notifica

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Prompt raccomandazioni all'apertura · **Size:** S · **Depends on:** 22.2, 22.3 · **Spec:** [22.4-open-prompt.md](22.4-open-prompt.md)
- **Goal:** Collegare all'attivazione un controllo esclusivamente locale delle raccomandazioni non soddisfatte che offra `Install All`, `Review` e `Don't ask again for this workspace`.

### 22.5 - Igiene Git per il manifesto condiviso

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Igiene gitignore per state.json · **Size:** XS · **Depends on:** 02 · **Spec:** [22.5-gitignore-hygiene.md](22.5-gitignore-hygiene.md)
- **Goal:** Garantire che `writeManifest` a livello di progetto accodi in modo non distruttivo il percorso `state.json` del progetto a un `.gitignore` esistente.
