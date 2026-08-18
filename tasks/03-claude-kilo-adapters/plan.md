# 03 — Claude + Kilo adapters (skill+rule) — Implementation plan

> **Derived from spec:** [../specs/foundations.md](../specs/foundations.md)

Tasks (each = one commit; hand one file at a time to a delegated agent):

1. [03.1 — Adapter interface](03.1-adapter-interface.md)
2. [03.2 — Claude Code adapter](03.2-claude-adapter.md)
3. [03.3 — Kilo Code adapter](03.3-kilo-adapter.md)

Shared decisions for this initiative that every task must honour:

- Only `skill` and `rule` are implemented — an adapter method for
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
  - Kilo `rule`: Kilo reads `AGENTS.md`/`CLAUDE.md` at project root and
    `~/.config/kilo/AGENTS.md` globally **natively**, same as Claude's own
    file — the Kilo adapter's `writeRule` can write the exact same
    `CLAUDE.md` path Claude's adapter writes (SPEC.md §5 "rule
    convergence"). Don't invent a separate Kilo-specific rule file for
    this task.
- This initiative depends on 02 (needs `src/domain/types.ts`).
