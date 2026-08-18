# 06 — Install engine (pipeline) — Implementation plan

> **Derived from spec:** [../specs/foundations.md](../specs/foundations.md)

Tasks (each = one commit; hand one file at a time to a delegated agent):

1. [06.1 — Plan + preview](06.1-plan-and-preview.md)
2. [06.2 — Apply + verify + registry recording](06.2-apply-and-verify.md)

Shared decisions for this initiative that every task must honour:

- The pipeline is `resolve → plan → preview → apply → verify` (SPEC.md
  §2.4) — `resolve` is already covered by initiative 04's resolvers
  (they return `Package[]`/`Artifact[]` with real content already
  fetched); this initiative starts from an already-resolved `Artifact`.
- `plan` must be a pure function with no side effects — it computes what
  *would* happen (target path, whether it exists already → conflict,
  the `ConversionDiagnostic` from initiative 05's translator) without
  touching the filesystem beyond read-only existence checks. This is what
  makes `preview` possible before `apply` writes anything.
- `apply` writes must be atomic and recoverable (SPEC.md §2.4 "apply") —
  reuse the same temp-file-then-rename pattern initiative 02.2 established
  for the registry, applied here to the skill/rule file itself.
- `verify` means re-reading what was just written and confirming it
  parses back into an equivalent `CanonicalSkill`/`CanonicalRule` — not
  merely checking the write call didn't throw.
- This initiative depends on 03 (adapters), 04 (resolvers), and 05
  (translator) — it's the first task that wires all three together.
