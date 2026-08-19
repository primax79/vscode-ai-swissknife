# Task Index

Live registry of planned and in-progress development. For how this
directory works see [`AGENTS.md`](AGENTS.md); for shared project facts see
[`CONTEXT.md`](CONTEXT.md). This file is the state: what exists, priority,
status.

**2026-08-18 — hardening gate inserted**: a second Codex review of the
actual code (not just the spec) found real contract gaps at the
resolver/install/registry boundary — full detail in
[`_inbox/analyzed/codex-analysis-2.md`](_inbox/analyzed/codex-analysis-2.md),
summarized in [`../SPEC.md`](../SPEC.md) §7. `02.3`/`03.4`/`04.3`/`05.2`
close those gaps; `06`/`07` were rewritten in place (no code existed for
either yet) to depend on the hardened contracts instead of the original,
incomplete ones.

**2026-08-18/19 — multi-engine hardening rounds 001-003 applied and Phase 1 completed**:
Hardening tasks 02.3, 03.4, 04.3, 05.2 and initiatives 06 (Install Engine) and 07 (Minimal UI)
have been implemented across isolated worktrees, strictly validated against all hardening contracts,
and merged into `main`. Full test suite passes 69/69 tests.

## Initiatives

`#` is the stable id (folder/task prefix); it is NOT reading order —
`Priority` is.

| Priority | #   | Initiative                                                                | Status                                        | Depends on           | Size |
| -------- | --- | ------------------------------------------------------------------------- | --------------------------------------------- | -------------------- | ---- |
| 1        | 01  | [Project scaffold](01-project-scaffold/plan.md)                           | ✅ done                                       | —                    | S    |
| 2        | 02  | [Domain types + registry store](02-domain-and-registry/plan.md)           | ✅ done (02.3 hardening merged)               | 01                   | S    |
| 3        | 03  | [Claude + Kilo adapters (skill+rule)](03-claude-kilo-adapters/plan.md)    | ✅ done (03.4 hardening merged)               | 02                   | M    |
| 4        | 04  | [Source resolver (git-custom + local-folder)](04-source-resolver/plan.md) | ✅ done (04.3 hardening merged)               | 02                   | M    |
| 5        | 05  | [Canonical model + translator (skill)](05-translator-skill/plan.md)       | ✅ done (05.2 hardening merged)               | 03.4                 | M    |
| 6        | 06  | [Install engine (pipeline)](06-install-engine/plan.md)                    | ✅ done (06.1/06.2 merged)                    | 05, 02.3, 03.4, 04.3 | M    |
| 7        | 07  | [Minimal UI (3 views)](07-minimal-ui/plan.md)                             | ✅ done (07.1/07.2/07.3 merged)               | 06                   | M    |

Everything above completes SPEC.md §6 "Phase 1" (see
[`specs/foundations.md`](specs/foundations.md)). Phase 2 (agent/mcp-server/
hook/command kinds, Copilot/Codex/Gemini adapters, git-marketplace/
remote-url/git-single-item sources) and Phase 3 (dashboard, form editor,
bidirectional sync, watchers, full drift detection) will be registered as
initiatives once Phase 2 specs are authored.

## Specs

| Spec                                | Drives                     |
| ----------------------------------- | -------------------------- |
| [foundations](specs/foundations.md) | 01, 02, 03, 04, 05, 06, 07 |

## Dependency graph

```text
01 ──► 02.1/02.2 ──► 03.4 ──┬──► 02.3 ──┬──► 04.3 ──┐
                            └──► 05.2 ───┼───────────┼──► 06 ──► 07.2
                                        └───────────┘       ├──► 07.3
                                        └──────────────► 07.1
```

---

Delegation rules, the pipeline, and the folder convention live in
[`AGENTS.md`](AGENTS.md).
