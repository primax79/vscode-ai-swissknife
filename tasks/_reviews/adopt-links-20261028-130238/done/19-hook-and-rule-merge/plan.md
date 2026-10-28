# 19 — Tipo `hook` + merge attivo di `rule` — Piano di implementazione

> **Derived from spec:** [`../specs/phase-4-spec.md`](../../specs/phase-4-spec.md) §5 · [`../../SPEC.md`](../../../SPEC.md) §1, §5

Task (ciascuno = un commit):

## Tasks

## Vincoli di sequenza

**Il task 19.1 blocca 19.2**: non iniziare 19.2 finché i risultati di 19.1 non sono registrati — questo rispecchia la stessa disciplina già applicata al gate di consolidamento della Fase 1 (`CONTEXT.md`).

## Closed

### 19.1 - Spike di verifica dei percorsi degli hook

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Verifica percorsi hook · **Size:** S · **Kind:** investigation · **Depends on:** 03, 12 · **Spec:** [19.1-hook-path-verification.md](19.1-hook-path-verification.md)
- **Goal:** Verificare i percorsi dei file hook di Claude Code, Kilo Code e GitHub Copilot prima di implementare gli adapter per gli hook.

### 19.2 - Modello `CanonicalHook` e adapter Claude/Copilot

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** CanonicalHook e adapter hook · **Size:** M · **Depends on:** 19.1 · **Spec:** [19.2-hook-adapter.md](19.2-hook-adapter.md)
- **Goal:** Implementare `CanonicalHook` (`name`, `event`, `command`, `timeout`, `extraFields`), `translateHook` e la lettura/scrittura/elencazione degli hook negli adapter di Claude, Kilo e Copilot.

### 19.3 - Politica di merge non distruttiva per `rule`

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Merge rule con blocchi · **Size:** M · **Depends on:** 03, 06, 12 · **Spec:** [19.3-rule-merge-policy.md](19.3-rule-merge-policy.md)
- **Goal:** Implementare il merge non distruttivo delle regole tramite blocchi delimitati (`<!-- ai-swissknife:managed:${sourceId} -->`) nel motore di installazione, affinché l'installazione o la sincronizzazione di una `rule` non sovrascriva mai le istruzioni utente circostanti.

### 19.4 - Integrazione UI per hook e rule

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Integrazione UI hook e rule · **Size:** S · **Depends on:** 19.2, 19.3 · **Spec:** [19.4-hook-rule-ui.md](19.4-hook-rule-ui.md)
- **Goal:** Rilevare i file `hook` e `rule` nei resolver delle sorgenti ed esporre entrambi i tipi nelle viste Available, Installed e Dashboard.
