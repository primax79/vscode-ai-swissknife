# 49 — Install provenance and update detection — Implementation plan

**Spec:** [`specs/install-provenance-and-update-detection.md`](../specs/install-provenance-and-update-detection.md)
**Why:** freshly installed skills show Update everywhere; root causes in spec §0 (source identity by bare id, local
folders read from the live working tree, catalog vs check commit, artifact match by name).
**Depends on:** 13 (drift), 47.1 (update engine). Touches `src/domain/types.ts`, `src/engine/{drift,update,plan,apply,pendingCounts}.ts`,
`src/sources/{gitProcess,gitMarketplace,gitCustom,localFolder}.ts`, `src/ui/{dashboard,installedView}.ts`, `src/cli/commands.ts`.

## Tasks

### 49.3 - Exact artifact match

- **Status:** `open` · **Short:** Exact artifact match · **Size:** S · **Depends on:** 49.2
- **Goal:** spec §3.5 in `checkForUpstreamUpdate` and `planUpdate`; name fallback removed, replaced by `source-unavailable` with a same-name hint; case 6 passes.

### 49.4 - Commit provenance for local-folder sources; committed HEAD by default

- **Status:** `delivered` (2026-10-27) · **Short:** Local-folder provenance · **Size:** M · **Depends on:** 49.2
- **Goal:** spec §1 `sourceRevision {commit, dirty}` for git local folders; read at committed HEAD unless `readWorkingTree: true`; case 3 passes.
- **Result:** Le sorgenti `local-folder` in un repository git registrano `commit` (`HEAD`) e `dirty` (limitato al path dell'artefatto tramite `git status --porcelain -- <path>`) su `pkg.version` e `installation.sourceRevision`, leggono di default il contenuto dal commit `HEAD` (`git ls-tree`/`git cat-file` con mode preservati per le skill e `git show HEAD:<relpath>` per i file singoli), supportano l'opzione `readWorkingTree?: boolean` sul manifest per leggere il working tree riportando `dirty` nel `DriftReport`, e restituiscono `source-unavailable` con l'hint richiesto per gli artefatti untracked; il caso 3 in `src/engine/provenance.test.ts` è verde.

### 49.5 - Status from commits, then content; sourceContentHash

- **Status:** `open` · **Short:** Commit-based status · **Size:** M · **Depends on:** 49.2, 49.4
- **Goal:** spec §2: fast path on unchanged commit, translated-content comparison only when the commit moved; `sourceContentHash` recorded; install resolves at install time (spec §3.4); cases 4, 5, 7 pass.

### 49.6 - Migration of existing state

- **Status:** `open` · **Short:** State migration · **Size:** M · **Depends on:** 49.2, 49.5
- **Goal:** spec §5 with backup of the old state file; `provenance-unknown` + re-link / reinstall actions; case 8 passes; verified on a copy of the real `~/.ai-swissknife/state.json`.

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
