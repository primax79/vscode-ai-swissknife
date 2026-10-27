# 05 — Canonical model + translator (skill) — Implementation plan

> **Derived from spec:** [../specs/foundations.md](../specs/foundations.md)

Tasks (each = one commit; hand one file at a time to a delegated agent):

## Tasks

## Shared decisions

Shared decisions for this initiative that every task must honour:

- `skill` and `rule` are format-identical between Claude Code and Kilo
  Code (`plan.md`s of initiatives 03/04 already establish this,
  citing SPEC.md §5 "rule convergence" and the `SKILL.md` schema check in
  `plugin_manager.py`) — so this translator is intentionally the *easy*
  case. Its purpose in Phase 1 is to prove the translator/diagnostic
  machinery end-to-end on a case where the right answer is known and
  simple (`lossless`, always), so Phase 2's genuinely hard case (`agent`:
  Claude's flat `tools:` list vs Kilo's `mode`/`permission` block, SPEC.md
  §1) has a working pattern to extend instead of inventing the pipeline
  and debugging a hard translation in the same pass.
- **Locked after hardening round 002**: the translator accepts only the
  target `AssistantId`; it does not accept or infer a source assistant,
  because a manifest-less custom repo has no trustworthy source identity.
  It remains filesystem/path agnostic. Claude/Kilo return lossless output;
  every other Phase-1 target returns an explicit unsupported diagnostic.
- This initiative depends on 03.4 for the complete `CanonicalSkill`
  directory payload but not on 04.

## Closed

### 05.1 - Translator + conversion diagnostics

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Skill and rule translator · **Size:** S · **Depends on:** 03.1 · **Spec:** [05.1-translator.md](05.1-translator.md)
- **Goal:** Implement `translateSkill` and `translateRule` in `src/translator/skill.ts` returning translated canonical objects alongside `ConversionDiagnostic`.

### 05.2 - Per-field diagnostics (hardening)

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Target-typed per-field diagnostics · **Size:** M · **Depends on:** 05.1, 03.4 · **Spec:** [05.2-hardening.md](05.2-hardening.md)
- **Goal:** Change `translateSkill` and `translateRule` to take only `targetAssistant: AssistantId` and return structured `TranslationResult<T>` with per-field diagnostics and preserved auxiliary skill files.
