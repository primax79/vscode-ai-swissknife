# 04 — Source resolver (git-custom + local-folder) — Implementation plan

> **Derived from spec:** [../specs/foundations.md](../specs/foundations.md)

Tasks (each = one commit; hand one file at a time to a delegated agent):

1. [04.1 — Format detection + local-folder resolver](04.1-local-folder-resolver.md) — done
2. [04.2 — git-custom resolver](04.2-git-custom-resolver.md) — done
3. [04.3 — Resolver hardening + portable fixtures](04.3-hardening.md)

Shared decisions for this initiative that every task must honour:

- Resolvers produce `SourceResolution { packages, diagnostics }` (packages
  contain `Artifact[]`, SPEC.md §4) — they
  never write to an assistant's config directories (that's the Install
  engine, initiative 06) and never touch the registry (that's initiative
  02's store, used later by 06).
- `git-custom` (04.2) must reuse 04.1's format-detection logic on the
  local checkout it produces, not duplicate it — a git-custom Source is,
  after cloning, exactly a local-folder in every way that matters to
  detection.
- **Revised (second Codex review, `../_inbox/analyzed/
  codex-analysis-2.md`, finding B7)**: 04.1/04.2's original tests asserted
  against live, mutable, machine-specific paths (`~/.claude/skills/`'s
  exact count, absolute `/Users/Alfredo/...` paths) — this passed here
  but isn't portable to another contributor, CI, or this machine after
  its skill count changes. `04.3` replaces those assertions with a small
  **committed** fixture corpus (`src/sources/__fixtures__/`) with
  provenance notes — "ground tests in real, provenance-tracked artifacts"
  and "keep tests portable" are not in tension; do not revert to
  asserting against `~/.claude/skills/` in any task after `04.3` lands.
- This initiative depends on completed 02.1 domain types. `04.3` additionally
  depends on `03.4` for the codec/detector contract and `02.3` for typed
  `resolveArtifactContent`, `ResolvedRevision`, and the shared Git mutex.
  It lands after both.
