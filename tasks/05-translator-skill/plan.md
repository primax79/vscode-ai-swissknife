# 05 — Canonical model + translator (skill) — Implementation plan

> **Derived from spec:** [../specs/foundations.md](../specs/foundations.md)

Tasks (each = one commit; hand one file at a time to a delegated agent):

1. [05.1 — Translator + conversion diagnostics](05.1-translator.md) — done
2. [05.2 — Per-field diagnostics (hardening)](05.2-hardening.md)

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
