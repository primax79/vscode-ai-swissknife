# 49 — Install provenance and update detection — Implementation plan

**Spec:** [`specs/install-provenance-and-update-detection.md`](../specs/install-provenance-and-update-detection.md)
**Why:** freshly installed skills show Update everywhere; root causes in spec §0 (source identity by bare id, local
folders read from the live working tree, catalog vs check commit, artifact match by name).
**Depends on:** 13 (drift), 47.1 (update engine). Touches `src/domain/types.ts`, `src/engine/{drift,update,plan,apply,pendingCounts}.ts`,
`src/sources/{gitProcess,gitMarketplace,gitCustom,localFolder}.ts`, `src/ui/{dashboard,installedView}.ts`, `src/cli/commands.ts`.

## Tasks

### 49.6 - Migration of existing state

- **Status:** `delivered` (2026-10-27) · **Short:** State migration · **Size:** M · **Depends on:** 49.2, 49.5
- **Goal:** spec §5 with backup of the old state file; `provenance-unknown` + re-link / reinstall actions; case 8 passes; verified on a copy of the real `~/.ai-swissknife/state.json`.
- **Result:** Implementata la migrazione offline delle installazioni prive di `source` al caricamento di `state.json` (`readState`/`migrateStateFile`) con backup singolo `state.json.bak-<timestamp>`, re-baselining degli hash calcolati con il vecchio codec pre-`d61fdd1`/`2f949cc` (`rebaselined: codec`, preservando invece gli hash con modifiche locali reali così che restino `modified-locally`), recupero offline del commit di installazione dalla storia git dell'artefatto (`git log` / `--follow` fino a 200 commit con cache per `(source, commit, artifact)`), adozione delle sorgenti a candidato singolo e disambiguazione multi-candidato (o `provenance: 'unknown'` con `reason: 'ambiguous-source'`), stato neutrale `provenance-unknown` in UI/CLI, comando CLI `relink <item> --source <scope>:<id>` e azioni `relinkInstallation`/`reinstallInstallation`; i casi 8–8d in `src/engine/provenance.test.ts` sono verdi e la verifica su copia isolata del `~/.ai-swissknife/state.json` reale adotta 61 installazioni su 67 (48 `adopted-with-commit`, 13 `adopted-source-only`, 30 `rebaselined: codec`, 19 modifiche locali reali, 6 `provenance-unknown`), portando gli stati post-migrazione a 19 `up-to-date`, 16 `update-available` reali, 17 `modified-and-update-available`, 1 `modified-locally`, 4 `provenance-unknown` e 10 `missing-on-disk`.

### 49.7 - Explain the state in UI and CLI

- **Status:** `open` · **Short:** Explain state · **Size:** S · **Depends on:** 49.5
- **Goal:** spec §4: tooltip/detail panel and `status --explain` show source, installed and current commit, both hashes, state and reason; owner validates by use (fresh install shows up to date; an edit in the working copy no longer flips items).

## Closed

### 49.1 - Regression tests that reproduce the false Update

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** False Update tests · **Size:** M · **Depends on:** -
- **Goal:** spec §6 cases 1-8 as tests on temp fixtures (git sources in temp repos, local-folder sources, two manifests with the same id); they fail on HEAD 41a4fb4 for the right reason (assert the failure message), marked expected-fail until the fixing task lands.
- **Result:** Added `src/engine/provenance.test.ts` covering spec §6 cases 1–8 on isolated temp git/local-folder/manifest fixtures (cases 5 and 7 pass on main; cases 1–4, 6, 8 reproduce the bugs and are marked `{ todo: 'fixed by 49.x' }`).

### 49.2 - Source identity in the provenance record and in every lookup

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Source identity · **Size:** L · **Depends on:** 49.1
- **Goal:** spec §1 `source {id, scope, type, location}` written at install; one engine status function used by Dashboard, sidebar, pendingCounts and CLI (no UI-side merging, no first-id match); git cache keyed by id + location hash; spec §6 cases 1, 2 pass; CLI/UI parity test.
- **Result:** Aggiunto `source: { id, scope, type, location }` a `ManagedInstallation` (scritto da `planInstall`/`applyInstall` e `promoteObservedArtifact`), introdotta `resolveInstallationSource` usata in `checkDriftForAll`, `DashboardPanel`, `InstalledTreeDataProvider`, `computePendingCounts`, `planUpdateAll` e CLI (`runUpdates`, `runUpdate`, `runItem`), e aggiornata la chiave della cache git in `<sanitized id>-<short hash of location>` con riuso dei clone legacy se l'URL `origin` corrisponde; i test 1a e 2 in `src/engine/provenance.test.ts` (inclusa la parità CLI/Dashboard) sono verdi.

### 49.3 - Exact artifact match

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Exact artifact match · **Size:** S · **Depends on:** 49.2
- **Goal:** spec §3.5 in `checkForUpstreamUpdate` and `planUpdate`; name fallback removed, replaced by `source-unavailable` with a same-name hint; case 6 passes.
- **Result:** Introdotto `matchInstallationArtifact` in `src/engine/drift.ts` (usato da `checkForUpstreamUpdate` e `planUpdate`) che confronta gli artefatti esclusivamente per `artifactId` esatto o conversione deterministica della forma dell'id (stesso `sourceId`, plugin, kind e nome), rimuovendo il fallback `kind && name` e restituendo `source-unavailable` con `reason` `"artifact <id> no longer in source"` e `hint` `"same name found: <its id>"`; ristretto `resolveArtifactContent` in `src/sources/gitMarketplace.ts` al percorso registrato dell'artefatto e alla cartella del proprio plugin; il caso 6 in `src/engine/provenance.test.ts` è verde.

### 49.4 - Commit provenance for local-folder sources; committed HEAD by default

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Local-folder provenance · **Size:** M · **Depends on:** 49.2
- **Goal:** spec §1 `sourceRevision {commit, dirty}` for git local folders; read at committed HEAD unless `readWorkingTree: true`; case 3 passes.
- **Result:** Le sorgenti `local-folder` in un repository git registrano `commit` (`HEAD`) e `dirty` (limitato al path dell'artefatto tramite `git status --porcelain -- <path>`) su `pkg.version` e `installation.sourceRevision`, leggono di default il contenuto dal commit `HEAD` (`git ls-tree`/`git cat-file` con mode preservati per le skill e `git show HEAD:<relpath>` per i file singoli), supportano l'opzione `readWorkingTree?: boolean` sul manifest per leggere il working tree riportando `dirty` nel `DriftReport`, e restituiscono `source-unavailable` con l'hint richiesto per gli artefatti untracked; il caso 3 in `src/engine/provenance.test.ts` è verde.

### 49.5 - Status from commits, then content; sourceContentHash

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Commit-based status · **Size:** M · **Depends on:** 49.2, 49.4
- **Goal:** spec §2: fast path on unchanged commit, translated-content comparison only when the commit moved; `sourceContentHash` recorded; install resolves at install time (spec §3.4); cases 4, 5, 7 pass.
- **Result:** Registrato `sourceContentHash` su `ManagedInstallation` al momento dell'installazione (`planInstall`/`applyInstall` e `promoteObservedArtifact`), implementata la risoluzione del ref della sorgente git al momento dell'installazione in `planInstall`, aggiunto il fast path basato sui commit in `checkForUpstreamUpdate` / `checkDriftForAll` (con `installedCommit`, `currentCommit`, `commitsBehind` su `DriftReport` e nell'output CLI di `updates`/`update`), e integrata `src/engine/revisionGap.ts` (adattata per `local-folder` git e chiave cache 49.2) con la relativa suite di test `src/engine/revisionGap.test.ts`; i casi 1b, 4, 4b, 5 e 7 in `src/engine/provenance.test.ts` sono verdi.
