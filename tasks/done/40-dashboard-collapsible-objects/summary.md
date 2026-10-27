# 40 — Dashboard Installed: una riga comprimibile per oggetto, una riga figlia per posizione — Riepilogo

> **Closed on:** 2026-10-27 (riordino del registro; verificatore ai-coding-tools-c1)  
> **Initiative:** 40 — Dashboard Installed: una riga comprimibile per oggetto, una riga figlia per posizione  
> **Status:** ✅ Completata e unita in main

Riepilogo scritto alla chiusura a partire dal piano e dalla cronologia git; le specifiche dei singoli task in questa cartella contengono i dettagli.

## Cosa è stato realizzato

- **40.1 Modello puro: costruire l'albero oggetto → posizioni a partire da gestiti + osservati** — unito in 259c313 il 2026-10-09. Creare `src/engine/installedTree.ts` che esporta `buildInstalledTree` per raggruppare gli elementi gestiti e non gestiti in un unico `InstalledObject` per `(kind, name)` con figli `Place` ordinati e `worstState`.
- **40.2 Unico renderer lato server: riga compressa (striscia di chip + stato peggiore), righe figlie per posizione, filtri/ordinamento/dettaglio adattati** — unito in b66e068 il 2026-10-09. Sostituire i costruttori duplicati della matrice e la tabella separata degli elementi non gestiti con un unico `renderInstalledTree` lato server che renderizza righe padre comprimibili per oggetto con strisce di chip di posizione e righe figlie di posizione.
- **40.3 Espandi tutto / Comprimi tutto + stato di compressione mantenuto tra gli aggiornamenti** — committato in 7b40d4f su un branch di task, unito in main in 5e85109 (2026-10-27). Aggiungere i pulsanti icona Expand all e Collapse all alla barra degli strumenti di Installed e persistere le identità dei nodi padre espansi nello stato della webview tra gli aggiornamenti dei dati.
- **40.5 Barra dei filtri: Env/Scope/Membership/Kind come gruppi di pillole raggruppati visivamente (sostituisce i `<select>`)** — unito in 4412b33 il 2026-10-09. Sostituire i menu a discesa `<select>` di Scope e Membership e la riga separata di tab Kind con quattro gruppi di pillole etichettati e raggruppati visivamente (ENV, SCOPE, MEMBERSHIP, KIND).
- **40.4 Vocabolario dello scope (Global/Workspace) + icone come modulo condiviso — eseguire prima di 40.2** — unito in bc4b935 il 2026-10-09. Creare `src/ui/scopeIcons.ts` come unica fonte di verità per le etichette e le icone Global/Workspace e sostituire le stringhe "Project" rivolte all'utente relative allo scope in tutta la UI.

## Verification

- Il lavoro di ogni task è stato unito in `main` (evidenza: i commit indicati sopra, da `git log --grep '<id>'`).
- `npm test` su `main` a 5e85109 (2026-10-27): 577 test, 576 passati, 0 falliti, 1 saltato opt-in (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errori.
