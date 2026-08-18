# Engine/agent performance log

Tracks quality and speed per engine/model, across both implementation
delegations (`kilo_implement` calls) and review rounds — a reference for
future task assignment (which engine/model to pick for which kind of
work), not a judgment of any one run. Durations are the wall-clock time
of the *dispatching* call as observed in this conversation (includes the
subagent-wrapper overhead where one was used, not just the underlying
engine's own runtime) — treat them as approximate, not lab-grade
benchmarks, and note explicitly where a duration wasn't captured rather
than guessing one.

## Implementation delegations (Phase 1 hardening-gate-predecessor tasks)

All via `kilo_implement`, model `google/gemini-flash-latest` (mechanical/
low-risk tier), tasks 01.1 through 05.1 of the original (pre-hardening)
task set.

| Task | Duration (wrapper call) | Outcome | Quality notes |
| --- | --- | --- | --- |
| 01.1 (scaffold) | not captured precisely (foreground call) | success, verified | Matched spec exactly on direct file inspection. |
| 01.2 (entry point) | not captured | success, verified | Improvised a headless activation check (`node -e ... ext.activate({})`) when it correctly judged it couldn't launch a real Extension Development Host, and said so explicitly rather than claiming it had. |
| 01.3 (lint+gate) | not captured | success, verified | Clean; completed the initiative's final index update as asked. |
| 02.1 (domain types) | ~27s (wrapper) | success, verified | File matched the spec byte-for-byte on inspection; no `DesiredManifest`/`LocalState` scope creep. |
| 02.2, 03.1, 04.1 (parallel worktrees) | ~28s each (wrapper, launched concurrently) | success, verified (24/24 combined tests) | 04.1 computed real fixture skill counts (1, 1, 25) before writing assertions, exactly as instructed, instead of guessing; noted the missing `claude.ts` dependency honestly and worked around it. |
| 03.2, 04.2 (parallel worktrees) | ~27-30s each | success, verified (32/32 combined tests) | `gitCustom.ts` used real `git` CLI via `execFile`, correct ref precedence, real cache reuse — not a mocked implementation. |
| 03.3 (Kilo adapter) | ~16s (progress check) to completion | success, verified (41/41 tests) | Got the trickiest part of its own spec exactly right: project-scope rule path shared with Claude, global-scope path different (`~/.config/kilo/AGENTS.md`) — this was the one place easy to get subtly wrong. |
| 05.1 (translator) | not captured | success, verified (48/48 tests) | Clean; this is the code multi-engine review round 001 found real contract gaps *around* (not *in*) — the translator itself was fine, its call-site assumptions in later tasks weren't. |

**Read so far**: `google/gemini-flash-latest` on cleanly-scoped, single-
concern tasks with a concrete verification section has a 100% first-try
success rate across 9 dispatches in this project (measured by: typecheck/
lint/test all green, diff matches the task file's intent on direct
inspection, no task required a corrective re-dispatch). Not yet tested
here: how it performs on a genuinely ambiguous or under-specified task —
every task above was written with the level of detail `task-spec-
authoring` calls for, which may be doing a lot of the work.

## Review round 001 (hardening-gate task specs, pre-implementation)

| Engine | Model | Duration (dispatching call) | Findings (B / I) | Depth/character |
| --- | --- | --- | --- | --- |
| kilo-gemini | `google/gemini-3.1-pro-preview-customtools` | ~160s | 4 B, 3 I | Fastest, correctly found the headline bug (targetRootPath/skillPath conflation) but missed the TOCTOU git issue, the overwrite-deletes-files data-loss path, and the rollback-contract dishonesty — a real but shallower pass. |
| codex | default (via `mcp__codex__codex`) | ~444s | 9 B, 13 I | Slowest, deepest and most systemic — found the same headline bug independently, plus every high-impact finding kilo-gemini missed (TOCTOU, data-loss overwrite, dishonest rollback status, registry manifest dropping desired installations). Produced a full corrected dependency sequence unprompted. |
| claude-blind-subagent | inherited session model, zero authored context | not captured precisely | 7 B, 6 I | Sharpest on concrete, compile-time-verifiable contradictions — found the same headline bug independently *and* a real `tsc`-failing type mismatch (`SupportedAssistant` vs `AssistantId`) neither other engine named explicitly, plus an internal contradiction within a single task file (03.4's `parseSkillMarkdown` vs. its own mandatory `files` field) that both other engines missed entirely. |

**Read so far**: the headline bug being caught 3/3 times independently is
the strongest single data point for the practice's value — it's exactly
the kind of "obvious in hindsight, easy to miss while writing" mistake
this process exists to catch. Beyond that: coverage was genuinely
complementary, not redundant — each engine's *unique* findings were all
independently judged real (see `001-hardening-gate-SUMMARY.md`), so no
single engine here could have substituted for the panel. Codex's greater
depth came with roughly 2.8x kilo-gemini's latency; whether that
trade-off is worth it by default or only for higher-stakes rounds is
worth another data point or two before generalizing.

## How to extend this log

Append a row (or a new table for a new category of work) after every
delegation/review round worth remembering — not every single one if the
project settles into a routine, but at least until a pattern is clear
enough to state as a rule of thumb above the table, the way the two
"Read so far" notes do now.
