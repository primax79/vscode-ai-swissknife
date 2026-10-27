# 03 — Adapter Claude + Kilo (skill+rule) — Piano di implementazione

> **Derivato dalla specifica:** [../specs/foundations.md](../../specs/foundations.md)

Task (ciascuno = un commit; passare un file alla volta a un agente delegato):

## Tasks

## Decisioni condivise

Decisioni condivise per questa iniziativa che ogni task deve rispettare:

- Vengono implementati solo gli adapter per `skill` e `rule`, mentre solo
  `skill` viene esercitato dalla pipeline resolver/installazione/UI della Fase 1
  — un metodo dell'adapter per `agent`/`command`/`mcp-server`/`hook` non deve
  ancora esistere (nemmeno come stub che solleva "not implemented"); aggiungere
  la superficie dell'interfaccia per quei tipi solo quando un'iniziativa
  successiva li implementa effettivamente, così che l'interfaccia non menta mai
  su ciò che è supportato.
- Ogni metodo dell'adapter accetta uno `scope: 'global' | 'project'` esplicito
  e, quando `scope === 'project'`, un `projectRoot: string` — non dedurre mai
  internamente la radice del workspace (quella è una responsabilità legata alle
  API di VSCode che spetta all'iniziativa della UI risolvere e passare in input,
  secondo il vincolo puro-Node di `CONTEXT.md` già stabilito per lo store del
  registro).
- Percorsi reali e verificati da utilizzare (non ricalcolarli dalla prosa della
  specifica — questi sono i letterali esatti):
  - `skill` Claude: progetto `<projectRoot>/.claude/skills/<name>/SKILL.md`,
    globale `~/.claude/skills/<name>/SKILL.md` — confermata la presenza di
    esempi reali su questa macchina in `~/.claude/skills/*/`.
  - `rule` Claude: progetto `<projectRoot>/CLAUDE.md`, globale
    `~/.claude/CLAUDE.md`.
  - `skill` Kilo: progetto `<projectRoot>/.kilo/skills/<name>/SKILL.md`,
    globale `~/.kilo/skills/<name>/SKILL.md` (SPEC.md §1, `paths.ts:21-24`).
  - `rule` Kilo: **solo lo scope di progetto** condivide esattamente il file di
    Claude — `<projectRoot>/CLAUDE.md`, lo stesso percorso scritto dall'adapter
    di Claude (SPEC.md §5 "rule convergence"), perché Kilo lo legge nativamente
    a quel percorso senza necessità di traduzione. **Lo scope globale NON
    condivide la home di Claude** — il file di regole globale nativo di Kilo è
    `~/.config/kilo/AGENTS.md`, non `~/.claude/CLAUDE.md`. (Corretto il
    2026-08-18, seconda revisione Codex rilievo I11 — una versione precedente di
    questo punto affermava che i due percorsi potessero essere condivisi
    incondizionatamente per entrambi gli scope, il che contraddiceva quanto lo
    stesso `03.3` implementava correttamente per lo scope globale. Questa è ora
    l'unica fonte di verità; il file di `03.3` vi corrisponde.)
- Questa iniziativa dipende dai tipi di dominio completati in 02.1. `03.4` è il
  primo task di hardening aperto: il suo codec è consumato da `02.3` e il
  risultato del suo detector è esteso da `04.3`. Completarlo prima di entrambi.

## Chiusi

### 03.1 - Interfaccia Adapter

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Interfaccia condivisa Adapter · **Size:** S · **Depends on:** 02.1 · **Spec:** [03.1-adapter-interface.md](03.1-adapter-interface.md)
- **Goal:** Definire il contratto condiviso `Adapter` e i modelli canonici in memoria (`CanonicalSkill`, `CanonicalRule`, `ConversionDiagnostic`) in `src/adapters/types.ts`.

### 03.2 - Adapter Claude Code

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Adapter Claude Code · **Size:** M · **Depends on:** 03.1 · **Spec:** [03.2-claude-adapter.md](03.2-claude-adapter.md)
- **Goal:** Implementare `ClaudeAdapter` in `src/adapters/claude.ts` coprendo lettura/scrittura/elenco di `skill` e `rule` negli scope globale e di progetto.

### 03.3 - Adapter Kilo Code

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Adapter Kilo Code · **Size:** M · **Depends on:** 03.1 · **Spec:** [03.3-kilo-adapter.md](03.3-kilo-adapter.md)
- **Goal:** Implementare `KiloAdapter` in `src/adapters/kilo.ts` coprendo lettura/scrittura/elenco di `skill` e `rule` negli scope globale e di progetto.

### 03.4 - Codec condiviso delle skill, validazione dei percorsi, payload della directory (hardening)

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Hardening codec skill condiviso · **Size:** M · **Depends on:** 03.2, 03.3 · **Spec:** [03.4-hardening.md](03.4-hardening.md)
- **Goal:** Creare un codec condiviso delle skill in `src/adapters/codec.ts` che carichi l'intero payload della directory della skill (`files` + permessi di esecuzione), validi percorsi relativi sicuri ed esponga le skill malformate come diagnostiche strutturate.
