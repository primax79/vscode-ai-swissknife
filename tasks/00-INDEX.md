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

**2026-08-18/19 — multi-engine hardening rounds 001 and 002 applied**: before any of
`02.3`/`03.4`/`04.3`/`05.2`/`06.1`/`06.2`/`07.1`/`07.2` was delegated,
three independent engines reviewed them in two cycles. Round 001 resolved
12 blocking contract defects; targeted round 002 found and resolved 19
remaining composition, integrity, recovery, diagnostic-transport, and UI
gate decisions. See
[`_reviews/001-hardening-gate-SUMMARY.md`](_reviews/001-hardening-gate-SUMMARY.md)
and [`_reviews/002-hardening-gate-SUMMARY.md`](_reviews/002-hardening-gate-SUMMARY.md).
Every accepted decision is folded into the eight task files and `SPEC.md`
§7. **No implementation of any hardening-gate task has been delegated
yet.** The gate specifications are now ready for a final consistency
check/delegation; review-engine history remains in
[`_reviews/00-INDEX.md`](_reviews/00-INDEX.md).

## Initiatives

`#` is the stable id (folder/task prefix); it is NOT reading order —
`Priority` is.

| Priority | # | Initiative | Status | Depends on | Size |
| --- | --- | --- | --- | --- | --- |
| 1 | 01 | [Project scaffold](01-project-scaffold/plan.md) | ✅ done | — | S |
| 2 | 02 | [Domain types + registry store](02-domain-and-registry/plan.md) | partial (02.1/02.2 done, 02.3 hardening open) | 01 | S |
| 3 | 03 | [Claude + Kilo adapters (skill+rule)](03-claude-kilo-adapters/plan.md) | partial (03.1/03.2/03.3 done, 03.4 hardening open) | 02 | M |
| 4 | 04 | [Source resolver (git-custom + local-folder)](04-source-resolver/plan.md) | partial (04.1/04.2 done, 04.3 hardening open) | 02 | M |
| 5 | 05 | [Canonical model + translator (skill)](05-translator-skill/plan.md) | partial (05.1 done, 05.2 hardening open) | 03.4 | M |
| 6 | 06 | [Install engine (pipeline)](06-install-engine/plan.md) | open (revised) | 05, 02.3, 03.4, 04.3 | M |
| 7 | 07 | [Minimal UI (3 views)](07-minimal-ui/plan.md) | open (revised) | 06 | M |

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
01 ──► 02.1/02.2 ──► 03.4 ──┬──► 02.3 ──┬──► 04.3 ──┐
                            └──► 05.2 ───┼───────────┼──► 06 ──► 07.2
                                        └───────────┘       ├──► 07.3
                                        └──────────────► 07.1
```

`02.3`, `03.4`, `04.3`, and `05.2` are the hardening tasks. Land `03.4`
first so every later task can compile against its codec/detector contract;
then land `02.3`. `04.3` follows both because it extends their shared
resolver/codec/lock contracts. `05.2` follows `03.4` and can run in
parallel with `02.3` in isolated worktrees with disjoint write scope.
`06` depends on all four. `07.1` only needs 02.3; `07.2` needs 04.3 + 06;
`07.3` needs the state/install contracts.

---

Delegation rules, the pipeline, and the folder convention live in
[`AGENTS.md`](AGENTS.md).
