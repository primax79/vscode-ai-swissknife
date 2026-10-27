# 03 — Claude + Kilo adapters (skill+rule) — Implementation plan

> **Derived from spec:** [../specs/foundations.md](../../specs/foundations.md)

Tasks (each = one commit; hand one file at a time to a delegated agent):

## Tasks

## Shared decisions

Shared decisions for this initiative that every task must honour:

- Only `skill` and `rule` adapters are implemented, while only `skill` is
  exercised by the Phase-1 resolver/install/UI pipeline — an adapter method for
  `agent`/`command`/`mcp-server`/`hook` should not exist yet (not even as
  a stub that throws "not implemented"); add the interface surface for
  those kinds only when a later initiative actually implements them, so
  the interface never lies about what's supported.
- Every adapter method takes an explicit `scope: 'global' | 'project'`
  and, when `scope === 'project'`, a `projectRoot: string` — never infer
  the workspace root internally (that's a VSCode-API concern for the UI
  initiative to resolve and pass in, per `CONTEXT.md`'s pure-Node
  constraint already established for the registry store).
- Real, verified paths to use (don't re-derive from the spec's prose —
  these are the exact literals):
  - Claude `skill`: project `<projectRoot>/.claude/skills/<name>/SKILL.md`,
    global `~/.claude/skills/<name>/SKILL.md` — confirmed real examples
    exist on this machine at `~/.claude/skills/*/`.
  - Claude `rule`: project `<projectRoot>/CLAUDE.md`, global
    `~/.claude/CLAUDE.md`.
  - Kilo `skill`: project `<projectRoot>/.kilo/skills/<name>/SKILL.md`,
    global `~/.kilo/skills/<name>/SKILL.md` (SPEC.md §1, `paths.ts:21-24`).
  - Kilo `rule`: **project scope only** shares Claude's exact file —
    `<projectRoot>/CLAUDE.md`, same path Claude's adapter writes (SPEC.md
    §5 "rule convergence"), because Kilo reads it natively at that path
    with no translation needed. **Global scope does NOT share Claude's
    home** — Kilo's own native global rule file is
    `~/.config/kilo/AGENTS.md`, not `~/.claude/CLAUDE.md`. (Corrected
    2026-08-18, second Codex review finding I11 — an earlier version of
    this bullet said the two paths could be shared unconditionally for
    both scopes, which contradicted what `03.3` itself correctly
    implemented for global scope. This is now the single source of
    truth; `03.3`'s own file matches it.)
- This initiative depends on completed 02.1 domain types. `03.4` is the
  first open hardening task: its codec is consumed by `02.3`, and its
  detector result is extended by `04.3`. Land it before both.

## Closed

### 03.1 - Adapter interface

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Shared Adapter interface · **Size:** S · **Depends on:** 02.1 · **Spec:** [03.1-adapter-interface.md](03.1-adapter-interface.md)
- **Goal:** Define the shared `Adapter` contract and canonical in-memory models (`CanonicalSkill`, `CanonicalRule`, `ConversionDiagnostic`) in `src/adapters/types.ts`.

### 03.2 - Claude Code adapter

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Claude Code adapter · **Size:** M · **Depends on:** 03.1 · **Spec:** [03.2-claude-adapter.md](03.2-claude-adapter.md)
- **Goal:** Implement `ClaudeAdapter` in `src/adapters/claude.ts` covering `skill` and `rule` read/write/list at global and project scopes.

### 03.3 - Kilo Code adapter

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Kilo Code adapter · **Size:** M · **Depends on:** 03.1 · **Spec:** [03.3-kilo-adapter.md](03.3-kilo-adapter.md)
- **Goal:** Implement `KiloAdapter` in `src/adapters/kilo.ts` covering `skill` and `rule` read/write/list at global and project scopes.

### 03.4 - Shared skill codec, path validation, directory payload (hardening)

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Shared skill codec hardening · **Size:** M · **Depends on:** 03.2, 03.3 · **Spec:** [03.4-hardening.md](03.4-hardening.md)
- **Goal:** Create a shared skill codec in `src/adapters/codec.ts` that loads the full skill directory payload (`files` + executable modes), validates safe relative paths, and surfaces malformed skills as structured diagnostics.
