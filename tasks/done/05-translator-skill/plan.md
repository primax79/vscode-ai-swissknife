# 05 — Modello canonico + traduttore (skill) — Piano di implementazione

> **Derivato dalla specifica:** [../specs/foundations.md](../../specs/foundations.md)

Task (ciascuno = un commit; passare un file alla volta a un agente delegato):

## Tasks

## Decisioni condivise

Decisioni condivise per questa iniziativa che ogni task deve rispettare:

- `skill` e `rule` hanno formato identico tra Claude Code e Kilo Code (i file
  `plan.md` delle iniziative 03/04 lo stabiliscono già, citando SPEC.md §5 "rule
  convergence" e il controllo dello schema `SKILL.md` in `plugin_manager.py`) —
  pertanto questo traduttore rappresenta intenzionalmente il caso *facile*. Il
  suo scopo nella Fase 1 è dimostrare il funzionamento end-to-end del meccanismo
  traduttore/diagnostica su un caso in cui la risposta corretta è nota e
  semplice (sempre `lossless`), così che il caso realmente complesso della Fase 2
  (`agent`: la lista piatta `tools:` di Claude contro il blocco
  `mode`/`permission` di Kilo, SPEC.md §1) disponga già di uno schema
  funzionante da estendere anziché dover inventare la pipeline e fare debug di
  una traduzione complessa nello stesso passaggio.
- **Decisione fissata dopo il round di hardening 002**: il traduttore accetta
  solo l'`AssistantId` di destinazione; non accetta né deduce un assistente
  sorgente, poiché un repository personalizzato privo di manifest non possiede
  un'identità sorgente attendibile. Rimane agnostico rispetto a filesystem e
  percorsi. Claude/Kilo restituiscono un output senza perdita; ogni altra
  destinazione nella Fase 1 restituisce una diagnostica esplicita di mancato
  supporto.
- Questa iniziativa dipende da 03.4 per il payload completo della directory
  `CanonicalSkill`, ma non dalla 04.

## Chiusi

### 05.1 - Traduttore + diagnostiche di conversione

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Traduttore per skill e regole · **Size:** S · **Depends on:** 03.1 · **Spec:** [05.1-translator.md](05.1-translator.md)
- **Goal:** Implementare `translateSkill` e `translateRule` in `src/translator/skill.ts` restituendo gli oggetti canonici tradotti insieme a `ConversionDiagnostic`.

### 05.2 - Diagnostiche per campo (hardening)

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Diagnostiche per campo per destinazione · **Size:** M · **Depends on:** 05.1, 03.4 · **Spec:** [05.2-hardening.md](05.2-hardening.md)
- **Goal:** Modificare `translateSkill` e `translateRule` affinché accettino solo `targetAssistant: AssistantId` e restituiscano un `TranslationResult<T>` strutturato con diagnostiche per campo e file ausiliari della skill preservati.
