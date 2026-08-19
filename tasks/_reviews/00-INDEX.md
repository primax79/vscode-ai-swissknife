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

## Review round 002 (hardening-gate task specs, after round-001 fixes applied)

Targeted re-verification of the same 8 files after the round-001 fixes were
applied (commit `7e123af`). Codex and `kilo-gemini-3.1-pro` were told to
read `001-hardening-gate-SUMMARY.md` first (targeted, not blind); the
planned fourth engine (a fresh Claude subagent, blind) was cancelled before
producing output — the user asked to stop spending Claude tokens on review
work mid-round and let Kilo/Codex carry it instead, so round 002 has no
blind-subagent data point.

| Engine | Model | Duration (dispatching call) | Findings (B / I) | Depth/character |
| --- | --- | --- | --- | --- |
| codex | default (via `mcp__codex__codex`) | ~90s, wrote its own file directly (workspace-write sandbox, a first for this project) | 10 B, 7 I | Deepest again: caught that decision 9 was not just "partially reflected" but explicitly reversed (the manifest kept absolute paths and the wrong field name), plus new compile-time-shaped gaps (`ResolvedArtifact.content: unknown` meeting `CanonicalSkill` consumers, `Adapter.assistant: AssistantId` vs. `translateSkill`'s narrower `SupportedAssistant`), a `contentHash` that plan computes but apply never checks, and an overwrite-safety gap for files that appear *after* preview but before apply. |
| kilo-gemini-3.1-pro | `google/gemini-3.1-pro-preview-customtools` | ~4 min (ran directly in the shared working directory, no isolation) | 3 B, 3 I | Fewer findings but independently caught the same two highest-value bugs codex found (decision 9 reversal; `PreparedInstall.content` storing the translator's *input* instead of `TranslationResult.value`) — the second is a real, silent "translation gets discarded" bug, doubly confirmed. Also found one genuinely novel bug neither codex nor round 001 caught: `06.2`'s staging step never `chmod`s `content.files`, silently dropping executable-bit `mode` that `03.4` explicitly added support for. |
| kilo-gemini-3.7-flash | `google/gemini-3.7-flash` | first attempt crashed (~1-2 min in, "provider ended the response with an error") before writing anything, running concurrently with `kilo-gemini-3.1-pro` in the same working directory with no isolation; retried with `isolation: 'worktree'`, succeeded in ~3 min | 3 B, 4 I | The retry independently caught the same headline bug as codex/pro (translator input vs. output) plus the same `mode`/`chmod` staging bug pro found, and the same `AssistantId`/`SupportedAssistant` type mismatch codex found (pro missed that one) — strong convergence across all three engines on the two highest-value findings once given a clean run. |

**Read so far**: round 002 confirms round 001's core lesson at a second
level — reviewing the *fix* is as valuable as reviewing the original, since
the fix itself introduced or missed real defects (translator-output vs.
input being the standout: two of three completed engines caught it
independently, and it would have shipped a translator that never actually
translates). It also produced the first `workspace-write`-sandboxed Codex
review that wrote its own file directly, matching `kilo_implement`'s
long-standing behavior — worth using non-`read-only` sandbox by default for
future review rounds when the target is a docs-only tree, purely so the
orchestrator doesn't have to transcribe. Running two `kilo_implement`
review dispatches against the same working directory without
`isolation: 'worktree'` produced a real collision (a crash), not just the
theoretical race the tool's own warning describes — treat that warning as
load-bearing even for read-mostly review tasks, not only for tasks that
edit files.

## Review round 003 (hardening-gate task specs, after a full round-002 rewrite)

The round-002 correction pass was delivered as a large, from-scratch
rewrite of all 8 task files (plus `SPEC.md`/`CONTEXT.md`/`foundations.md`/
six `plan.md` files), not a series of small targeted edits. Round 003
exists to check whether that rewrite actually preserved every earlier
decision — the same "reviewing the fix is as valuable as reviewing the
original" lesson from round 002, one level up.

The user set a standing default of `google/gemini-3.7-flash` for Kilo
review/analysis tasks after independently testing both tiers (see the
`feedback_kilo_gemini_model_choice` memory) — dispatched here accordingly,
alongside codex, with no Claude subagent (standing token-conservation
instruction from round 002 carries forward).

| Engine | Model | Duration (dispatching call) | Findings (B / I) | Depth/character |
| --- | --- | --- | --- | --- |
| codex | default (via `mcp__codex__codex`) | ~2 min, wrote its own file directly (`workspace-write` sandbox) | 4 B, 9 I | Caught a real, serious regression the rewrite introduced: it silently dropped `Adapter.skillDir()` (reopening round 001's headline bug) and silently reversed round-001 decision 7 (uncovered pre-existing files became deletable via a new "full replacement" policy) — both previously multi-engine-confirmed as fixed. Plus two novel findings (unhandled staging residue on one rollback path; `writeState` not specified to preserve unrelated records, risking silently wiping other installations on every successful install). |
| kilo-gemini-3.7-flash | `google/gemini-3.7-flash` | crashed a second time ("provider ended the response with an error"), this time on a *fully isolated* solo dispatch — not a concurrency issue this time | none (crashed before writing) | Second crash on a long, many-file, `sequentialthinking`-heavy review task in this project. Its recovered partial transcript (10-step plan, reached step 6) had independently reconfirmed round 002's 19 decisions as correctly reflected — aligned with codex up to the crash point — but produced no written findings. Treat as a real reliability limit of this tier on long analytical tasks, not a concurrency artifact and not evidence the batch was clean; don't rely on a single flash dispatch as full coverage for a large round. |

**Read so far**: the biggest finding this round is about *process*, not
just content — a full rewrite that cites every accepted decision number in
its headers can still silently drop the *mechanism* behind an earlier
decision while looking internally consistent. Citing a decision number is
not evidence its fix survived a rewrite. Going forward, corrections after
a review round should default to narrow, surgical edits against the
specific decision list, reserving a full rewrite for cases where the
structure itself is wrong — and any full rewrite, if one does happen,
should get its own dedicated re-verification round before being trusted,
exactly as happened here. Separately, `gemini-3.7-flash` has now crashed
on two different long review dispatches in this project (once under
concurrency, once solo) — still the right default for smaller/faster
review tasks per the user's own testing, but pair it with codex (or expect
to retry) once a review target grows to a full multi-file batch like this
one.

## How to extend this log

Append a row (or a new table for a new category of work) after every
delegation/review round worth remembering — not every single one if the
project settles into a routine, but at least until a pattern is clear
enough to state as a rule of thumb above the table, the way the two
"Read so far" notes do now.
