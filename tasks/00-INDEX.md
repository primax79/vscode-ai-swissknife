# Task Index

Live registry of planned and in-progress development. For how this
directory works see [`AGENTS.md`](AGENTS.md); for shared project facts see
[`CONTEXT.md`](CONTEXT.md). This file is the state: what exists, priority,
status.

## Initiatives

`#` is the stable id (folder/task prefix); it is NOT reading order —
`Priority` is.

| Priority | # | Initiative | Status | Depends on | Size |
| --- | --- | --- | --- | --- | --- |
| 1 | 01 | [Project scaffold](01-project-scaffold/plan.md) | ✅ done | — | S |
| 2 | 02 | [Domain types + registry store](02-domain-and-registry/plan.md) | open | 01 | S |
| 3 | 03 | [Claude + Kilo adapters (skill+rule)](03-claude-kilo-adapters/plan.md) | open | 02 | M |
| 4 | 04 | [Source resolver (git-custom + local-folder)](04-source-resolver/plan.md) | open | 02 | M |
| 5 | 05 | [Canonical model + translator (skill+rule)](05-translator-skill/plan.md) | open | 03, 04 | M |
| 6 | 06 | [Install engine (pipeline)](06-install-engine/plan.md) | open | 05 | M |
| 7 | 07 | [Minimal UI (3 views)](07-minimal-ui/plan.md) | planned, not yet detailed | 06 | M |

Everything above is SPEC.md §6 "Phase 1" (see
[`specs/foundations.md`](specs/foundations.md)). Phase 2 (agent/mcp-server/
hook/command kinds, Copilot/Codex/Gemini adapters, git-marketplace/
remote-url/git-single-item sources) and Phase 3 (dashboard, form editor,
bidirectional sync, watchers, full drift detection) are not registered as
initiatives yet — they get their own spec(s) once Phase 1 ships and is
validated end to end.

## Specs

| Spec | Drives |
| --- | --- |
| [foundations](specs/foundations.md) | 01, 02, 03, 04, 05, 06, 07 |

## Dependency graph

```text
01 ──► 02 ──► 03 ──┐
             04 ──┤──► 05 ──► 06 ──► 07
```

03 and 04 both depend only on 02 and are independent of each other —
delegable in parallel once 02 is done.

---

Delegation rules, the pipeline, and the folder convention live in
[`AGENTS.md`](AGENTS.md).
