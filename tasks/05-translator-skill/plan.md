# 05 — Canonical model + translator (skill+rule) — Implementation plan

> **Derived from spec:** [../specs/foundations.md](../specs/foundations.md)

Tasks (each = one commit; hand one file at a time to a delegated agent):

1. [05.1 — Translator + conversion diagnostics](05.1-translator.md)

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
- The translator takes/returns the adapters' `CanonicalSkill`/
  `CanonicalRule` types (`src/adapters/types.ts`, initiative 03) — it does
  not know about file paths or assistants at all, only canonical data in,
  canonical data + diagnostic out. Source/target assistant identity is
  the *caller's* concern (the install engine, initiative 06), not the
  translator's.
- This initiative depends on 03 (needs `CanonicalSkill`/`CanonicalRule`
  from `src/adapters/types.ts`) but not on 04.
