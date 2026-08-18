# 05 — Canonical model + translator (skill+rule) — Implementation plan

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
- **Correction (2026-08-18, second Codex review, finding I10)**: an
  earlier version of this file said the translator "does not know about
  file paths or assistants at all" — that was aspirational, not what
  `05.1` actually implements (`translateSkill(source, fromAssistant,
  toAssistant)` takes both explicitly), and the two documents
  contradicted each other. Resolved in favor of what's implemented: the
  translator **does** take assistant identity as an explicit parameter
  (it needs it to know which target-specific constraints to check, e.g.
  Copilot's name-length cap in a future phase) — it does not, however,
  touch the filesystem or know about paths. Don't re-introduce the
  path-blind-and-assistant-blind framing without changing the code to
  match it.
- This initiative depends on 03 (needs `CanonicalSkill`/`CanonicalRule`
  from `src/adapters/types.ts`) but not on 04.
