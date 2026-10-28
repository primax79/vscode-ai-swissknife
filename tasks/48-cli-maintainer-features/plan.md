# 48 — Funzionalità per i manutentori nella CLI — solo bozza

> Fonte: `specs/cli-wishlist-comparison.md` (wishlist della sessione del manutentore delle skill, task di workspace T012, 2026-10-08). **Bozza: nessun task è specificato per intero e nulla viene delegato finché l'owner non decide i punti aperti.** Dipende dall'iniziativa 46 (contratto della CLI, comandi di sola lettura, scritture protette da `--write`, lock) e, per il lato aggiornamenti, da 47.

## Tasks

### 48.2 - Flag di `installed`: link vs copia, link interrotto, orfano (rimosso dalla sorgente), installato due volte

- **Status:** `delivered` (2026-10-28) · **Short:** Flag link e orfani installed · **Size:** M · **Depends on:** 46.1 · **Use cases:** UC034
- **Goal:** Aggiungere flag basati su `lstat` all'output di `installed` per distinguere symlink vs copia, link interrotti, installazioni duplicate tra ambiti e artefatti orfani rimossi dalla rispettiva sorgente a monte.
- **Result:** Aggiunti all'output di `installed` e alla UI i flag in sola lettura (`link` con `linkTarget`, `copy`, `broken-link`, `orphan` per artefatti rimossi dalla sorgente tramite `evaluateProvenanceCandidates`, e `duplicate` con `duplicateOf` per duplicati tra ambiti per lo stesso assistente), il filtro CLI `installed --flags <flag,...>`, i badge/tooltip nell'albero Installed di VS Code, il supporto symlink negli adapter e test completi in `src/cli/installedFlags.test.ts`.

### 48.3 - Report di shadowing: identical / stale / ahead / unique, e protezione `--force` prima di eliminare copie ahead/unique

- **Status:** `open` (solo bozza) · **Short:** Report classificazione di shadowing · **Size:** L · **Depends on:** 48.1, 48.2 · **Use cases:** UC034
- **Goal:** Classificare le copie attraverso le root come `identical`, `stale`, `ahead` o `unique` calcolando l'hash degli artefatti rispetto ai commit passati del clone della sorgente, e richiedere `--force` prima di eliminare copie `ahead` o `unique`.

### 48.4 - Controlli doctor (regole di esclusione di Kilo, nome = cartella, metadati malformati, duplicati tra ambiti)

- **Status:** `open` (solo bozza) · **Short:** Controlli doctor della CLI · **Size:** M · **Depends on:** 44.4, 46.1 · **Use cases:** UC034
- **Goal:** Aggiungere un comando doctor nella CLI che verifichi le regole di esclusione della discovery di Kilo, la mancata corrispondenza tra nome della skill e cartella, i metadati del frontmatter malformati e gli elementi duplicati tra ambiti.

### 48.5 - `replaces: [...]` sui plugin, applicato durante l'aggiornamento

- **Status:** `open` (solo bozza; decisione aperta su dove risieda `replaces` e chi altro debba interpretarlo) · **Short:** Sostituzione plugin in aggiornamento · **Size:** M · **Depends on:** 47.1, 48.1 · **Use cases:** UC034
- **Goal:** Supportare una dichiarazione `replaces: [...]` su plugin/artefatti in modo che l'aggiornamento ritiri automaticamente i nomi degli artefatti sostituiti.

### 48.6 - Contribuire a ritroso una copia locale in un checkout della sorgente / marcare come intenzionalmente locale

- **Status:** `open` (solo bozza) · **Short:** Contribuire copia locale a sorgente · **Size:** M · **Depends on:** 46.4 · **Use cases:** UC034
- **Goal:** Consentire di riportare un artefatto modificato o solo locale in un checkout di sorgente `local-folder` (mai nella nostra cache dei cloni git) oppure di marcarlo come intenzionalmente locale.

### 48.7 - Sorgenti CLI: fetch di tutte, N commit indietro, pin

- **Status:** `open` (specificato in 48.7-revision-gap.md, commit 8efb5a1; metà engine `src/engine/revisionGap.ts` + test assorbita in 49.5) · **Short:** Divario revisione e sources fetch · **Size:** S · **Depends on:** 46.1, 46.4, 44.1, 47.4 · **Use cases:** UC034 · **Spec:** [48.7-revision-gap.md](48.7-revision-gap.md)
- **Goal:** Arricchire `updates` con `installedRevision`, `latestRevision`, `commitsBehind` e `behindDays` tramite `src/engine/revisionGap.ts` (già assorbita e testata in 49.5), e aggiungere un comando CLI `sources fetch`.

### 48.8 - Estensione di `redistribute <path|item>` con corrispondenza ampliata (`--roots`, copie associate per identità, `ahead`)

- **Status:** `open` (v1 per cartella locale rilasciata come 46.5 in 99a127c; solo bozza per l'estensione ampliata) · **Short:** Estendere redistribute su più root · **Size:** M · **Depends on:** 46.5, 48.1, 48.3 · **Use cases:** UC034
- **Goal:** Estendere `redistribute` oltre le copie `local-folder` a singolo workspace della v1 per supportare la scansione multi-workspace con `--roots`, le copie associate per identità e le protezioni per la classificazione `ahead`.

## Bozze e note

| Task (bozza) | Punto wishlist | Dimensione | Note |
| --- | --- | --- | --- |
| [48.1](48.1-scan-roots.md) Scansione multi-root con regole di esclusione (**specificato il 2026-10-09**) | 5 | M | `--roots` ripetibile, lista di esclusione predefinita, profondità limitata; base per 48.3 e 48.5 |
| 48.2 Flag di `installed`: link vs copia, link interrotto, orfano (rimosso dalla sorgente), installato due volte | 3 | M | gli adapter attualmente saltano i symlink in modo silenzioso; aggiungere flag basati su `lstat`; nuovo stato del motore per "artefatto rimosso dalla sorgente" |
| 48.3 Report di shadowing: identical / stale / ahead / unique, e protezione `--force` prima di eliminare copie ahead/unique | 4, 12 | L | distinguere stale vs ahead richiede la cronologia della sorgente: calcolare l'hash dell'artefatto ai commit passati del clone della sorgente |
| 48.4 Controlli doctor (regole di esclusione di Kilo, nome = cartella, metadati malformati, duplicati tra ambiti) | 7 | M | si basa sullo studio B4 e su 44.4 |
| 48.5 `replaces: [...]` sui plugin, applicato durante l'aggiornamento | 6 | M | **decisione aperta**: dove risiede il campo e chi altro deve interpretarlo |
| 48.6 Contribuire a ritroso una copia locale in un checkout della sorgente / marcare come intenzionalmente locale | 8 | S/M | naturale per le sorgenti `local-folder`; non modificare mai la nostra cache dei cloni git |
| [48.7](48.7-revision-gap.md) Sorgenti CLI: fetch di tutte, N commit indietro, pin | 10 | S | dopo 46.4 |
| 48.8 `redistribute <path|item>` **v1: solo elementi installati da una cartella locale** (chiarimento dell'owner del 2026-10-08); la corrispondenza ampliata (`--roots`, copie associate per identità, `ahead`) costituisce l'estensione successiva | richiesta dell'owner, vedere `specs/dev-deploy-study.md` | S per v1 (motore = 47.1 con la sorgente local-folder), M per l'estensione (root di 48.1 + classificazione di 48.3) | la v1 non attende 48.1/48.3: può essere rilasciata subito dopo 47.1 e 46.4 |
| (non pianificato) trasformazioni registrate per singolo assistente | 9 | L | richiede una progettazione |
| (fuori ambito) helper di bump/rilascio per il repository delle skill | 11 | - | appartiene agli script del toolkit / T007 |

L'aggiornamento di un singolo elemento `update <item>`, il report "vecchio commit -> nuovo commit, file modificati" e i comandi CLI `trash list` / `restore` sono piccole aggiunte rispettivamente a **47.1/46.4/42.1** e sono registrati nel documento di confronto, non qui.

## Seguiti emersi durante la verifica (2026-10-09)

- **48.1b (completato il 2026-10-09, unito)** — le regole di esclusione di `findWorkspaces` (in particolare la coppia di segmenti `.kilo/worktrees`) vengono applicate al percorso **assoluto**, per cui una root che risiede essa stessa sotto un percorso simile non trova nulla (riprodotto quando la fixture si trovava dentro un worktree di Kilo). Devono essere valutate sul percorso **relativo a ciascuna root**. Piccola correzione + test.

## Closed

### 48.1 - Scansione multi-root con regole di esclusione

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Scansione workspace multi-root · **Size:** M · **Depends on:** 46.1 · **Use cases:** UC034 · **Spec:** [48.1-scan-roots.md](48.1-scan-roots.md)
- **Goal:** Aggiungere `findWorkspaces` e `scanInventoryAcrossRoots` in `src/engine/scanRoots.ts` più le opzioni CLI `--roots`, `--max-depth`, `--ignore` ed `--extra-ignore` per scansionare più workspace in una sola chiamata.

### 48.1b - Valutare le regole di esclusione della scansione dei workspace relativamente a ciascuna root

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Regole esclusione workspace relative · **Size:** XS · **Kind:** fix · **Depends on:** 48.1 · **Use cases:** UC034
- **Goal:** Valutare le regole di esclusione di `findWorkspaces` (come `.kilo/worktrees`) sui percorsi relativi a ciascuna root scansionata anziché sul percorso assoluto, in modo che anche le root situate dentro un worktree vengano scansionate correttamente.
