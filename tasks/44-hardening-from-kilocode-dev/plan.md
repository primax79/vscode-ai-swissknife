# 44 — Hardening e correzioni emersi dal confronto incrociato con kilocode-dev — Piano di implementazione

> Fonte: richiesta dell'owner del 2026-10-08 (`_inbox/analyzed/2026-10-08-kilocode-dev-crosscheck-request.md`). Esaminati in `kilocode-dev`: `docs/specs/{STATUS_HANDOVER,multi-repo-marketplace,multi-repo-marketplace-analysis}.md`, i commit `98010925a9` (marketplace multi-repo), `f40deeba8d` / `e1df19cf62` (fallback YAML permissivo), `f86381d32a` (schema della configurazione), il codice sorgente reale di Kilo (`packages/opencode/src/kilocode/config/overlay.ts`, `mcp-migrator.ts`) e `.kilo/plans/`. Ogni rilievo seguente è stato **riverificato nel codice di ai-swissknife**; nulla è stato riportato sulla fiducia.
> Piano inline, task espansi perché delegati.

**Depends on:** 36.1 (unito: `validateLocation`, riutilizzato da 44.1). Indipendente dalle altre iniziative aperte.

## Rilievi, validati qui

| # | Idea da kilocode-dev | Verdetto in ai-swissknife | Evidenza |
| --- | --- | --- | --- |
| F1 | Hardening del motore dei marketplace (analisi §2.8): traversal nella destinazione del clone, `url` nudo passato a `git clone`, nessuna allow-list sui trasporti | **Si applica, non corretto.** | `runGit(['clone', source.url!, targetDir])` senza `--` e senza validazione dell'URL al momento della risoluzione (`gitCustom.ts:104`, `gitSingleItem.ts:57`); `git checkout <ref>` con ref dell'utente non protetto (`gitCustom.ts:110-116`); la directory di destinazione usa `source.id.replace(/[^a-zA-Z0-9._-]/g,'_')` per cui gli id `.` e `..` sopravvivono (`gitCustom.ts:89-91`) e il codice esegue poi `rm -rf` sulla destinazione quando non contiene `.git` (`:96-98`): l'id `..` cancella `~/.ai-swissknife/cache`. Il manifest di progetto viaggia con `git clone` (iniziativa 22) e `refreshCatalog()` viene eseguito automaticamente (`extension.ts:~166`), quindi questi valori sono influenzabili da un attaccante in un repository appena clonato. La sfruttabilità dell'iniezione di opzioni **non è stata dimostrata** (una singola opzione iniettata non ha l'operando del repository), quindi si tratta di hardening di un percorso di input non attendibile, non di una RCE dimostrata. |
| F2 | (assente in kilocode-dev; consegue da F1) Workspace Trust | **Non gestito.** | Nessun `isTrusted`, nessun `capabilities.untrustedWorkspaces` in `src/` o `package.json`. Non è stato possibile confermare dal mirror locale della documentazione se VS Code esegua comunque l'estensione in Restricted Mode quando non viene dichiarato nulla: spike. |
| F3 | L'installazione MCP scriveva in un file fantasma che Kilo non legge (analisi §2.9: `kilo.json` vs reale `kilo.jsonc`, `JSON.parse` semplice che fallisce sui commenti) | **Probabile bug della stessa classe, richiede verifica empirica.** | Il nostro adapter Kilo legge/scrive `~/.config/kilo/mcp.json` e `<project>/.kilo/mcp.json` (`adapters/kilo.ts:480,486`) con `JSON.parse`/`JSON.stringify`. I file di configurazione reali di Kilo sono `kilo.jsonc → kilo.json → opencode.jsonc → opencode.json` sotto `.kilo`/`.kilocode` o nella directory di configurazione globale (`overlay.ts:84,140-153`), MCP risiede nel campo `mcp` (`core/src/v1/config/config.ts:230`); `mcp.json` viene letto solo dal migratore legacy (`mcp-migrator.ts:110-115`) e da `removeLegacyMcp()`. La riga per Kilo MCP nella nostra stessa `SPEC.md` afferma esattamente questo ("legacy ... only for removal/back-compat, not the primary write path"), quindi l'adapter contraddice la specifica da cui è stato costruito. |
| F4 | Fallback YAML permissivo per frontmatter con due punti non quotati (`f40deeba8d`) | **I due punti funzionano, ma esiste un bug correlato.** | Il nostro parser è basato su righe, non YAML (`sources/detect.ts:16-60`): `description: Use when: a: b` viene analizzato correttamente (testato). Ma gli scalari a blocco si rompono: `description: >` seguito da righe indentate restituisce il letterale `">"` come descrizione (testato su `out/sources/detect.js`). Agent e command usano un codec separato (`adapters/codec.ts`), non verificato qui. |
| F5 | Riscrittura di una vista unificata project+global dentro un singolo ambito (analisi §2.7) | **Non presente.** | Tutti i punti di chiamata di `writeManifest`/`writeState` leggono lo stesso ambito in cui scrivono (`sourcesView.ts:270,317`, `recommendations.ts` sempre `project`, `configTransfer.ts:108`). Nessun task necessario; mantenerlo come regola di revisione per 36.3 ("Both" scrive per singolo ambito a partire da letture per singolo ambito). |
| F6 | Badge a doppio ambito `INSTALLED (PROJECT + GLOBAL)`, filtro per ambito | **Già coperto** dall'albero comprimibile con chip delle icone di ambito (iniziativa 40) e dal filtro a pill Scope (40.5). Conferma la direzione intrapresa. |
| F7 | Indicatore di caricamento mentre la discovery è in corso (`.kilo/plans/agent-behaviour-skills-tab-loading-indicator.md`) | **Parzialmente coperto**: il loader dello scheletro della Dashboard (35.1) esiste; l'albero Sources della barra laterale non ne ha alcuno mentre le sorgenti vengono risolte sequenzialmente (una sorgente SSH bloccata blocca le altre, vedere 38). Inserito in 44.5 come piccolo intervento. |
| F8 | Versione per elemento per "update available" (analisi §4.3) | **Non applicabile**: ai-swissknife confronta i commit/hash della sorgente (`drift.ts`), non semver. |
| F9 | Livello adapter per il marketplace Claude, nomi qualificati `<plugin>@<marketplace>`, forma di installazione `files` (lista piatta) | **Non applicabile / già fatto** (`git-marketplace`, traduttore, basato su git clone). |
| F10 | `.gitignore` che ingloba `docs/specs` e `bun.lock` (analisi §2, punto 10) | Verificato: il `.gitignore` di ai-swissknife ignora solo `node_modules/`, `out/`, `dist/`, `*.vsix`, `.DS_Store`: **tutto in ordine**. |
| F11 | "Il superamento del typecheck non significa che la funzionalità funzioni" (introduzione dell'analisi) | Lezione di processo: la nostra regola di verifica richiede già controlli manuali/comportamentali in ogni task; 44.3 la applica all'adapter MCP (verificare con lo strumento reale, non solo con gli unit test). |

## Decisioni consolidate

- 44.1 e 44.3 sono la priorità (igiene di sicurezza e un probabile bug di fallimento silenzioso); 44.2 dipende da uno spike; 44.4 e 44.5 sono piccoli.
- Nessuna nuova dipendenza runtime senza dichiararlo: 44.3 necessita di un parser compatibile con JSONC (`jsonc-parser`, quello usato da Kilo); è l'unica nuova dipendenza consentita in questa iniziativa e deve essere dichiarata nel relativo messaggio di commit.

## Tasks

### 44.2 - Workspace Trust: spike, poi dichiarare `limited` e saltare le sorgenti di progetto quando non attendibile

- **Status:** `open` · **Short:** Controllo Workspace Trust · **Size:** S · **Priority:** P2 · **Depends on:** - · **Spec:** [44.2-workspace-trust.md](44.2-workspace-trust.md)
- **Goal:** Verificare il comportamento in Restricted Mode, dichiarare `capabilities.untrustedWorkspaces` e saltare la risoluzione delle sorgenti e le installazioni nell'ambito progetto quando il workspace non è attendibile.

## Closed

### 44.1 - Irrigidire la risoluzione delle sorgenti git (validazione di url/ref/id, `--`, allow-list dei protocolli, directory di cache sicura)

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Hardening risoluzione sorgenti git · **Size:** M · **Priority:** P1 · **Depends on:** 36.1 · **Spec:** [44.1-git-source-hardening.md](44.1-git-source-hardening.md)
- **Goal:** Validare URL git, ref e ID delle directory di cache al momento della risoluzione, passare i separatori `--` a `git clone`/`checkout` e limitare `GIT_ALLOW_PROTOCOL`.

### 44.3 - Configurazione MCP di Kilo: verificare la destinazione reale con Kilo, poi scrivere nel vero campo `mcp` (compatibile con JSONC)

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Percorso config JSONC MCP Kilo · **Size:** M · **Priority:** P1 · **Depends on:** - · **Spec:** [44.3-kilo-mcp-config-path.md](44.3-kilo-mcp-config-path.md)
- **Goal:** Scrivere i server MCP di Kilo in `kilo.jsonc`/`kilo.json`/`opencode.jsonc` nel vero campo `mcp` nella forma `local`/`remote` di Kilo usando `jsonc-parser`, mantenendo leggibile e rimovibile il file legacy `mcp.json`.

### 44.4 - Scalari a blocco (`>`, `|`) e valori multilinea nel frontmatter

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Scalari a blocco nel frontmatter · **Size:** S · **Priority:** P2 · **Depends on:** - · **Spec:** [44.4-frontmatter-block-scalars.md](44.4-frontmatter-block-scalars.md)
- **Goal:** Estendere il parsing del frontmatter basato su righe in `src/sources/detect.ts` e `src/adapters/codec.ts` per supportare gli scalari a blocco YAML folded (`>`) e literal (`|`) e le continuazioni multilinea.

### 44.5 - Barra laterale: stato di caricamento per singola sorgente durante la risoluzione

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Stato caricamento sorgenti sidebar · **Size:** S · **Priority:** P3 · **Depends on:** 38.1 · **Spec:** [44.5-sidebar-source-loading.md](44.5-sidebar-source-loading.md)
- **Goal:** Mostrare un'icona spinner e la descrizione `"Refreshing..."` su ciascun elemento sorgente della barra laterale mentre il relativo gruppo del catalogo viene risolto, renderizzando progressivamente le sorgenti completate.

### 44.6 - Le modifiche alla configurazione Kilo mantengono intatti gli elementi adiacenti e i relativi commenti (seguito di 44.3)

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Preservare voci adiacenti JSONC Kilo · **Size:** S · **Priority:** P3 · **Depends on:** 44.3 · **Spec:** [44.6-kilo-jsonc-preserve-neighbors.md](44.6-kilo-jsonc-preserve-neighbors.md)
- **Goal:** Rendere minimali le modifiche MCP al JSONC di Kilo in modo che le voci sorelle non vengano mai riformattate e i loro commenti finali non vengano mai spostati.
