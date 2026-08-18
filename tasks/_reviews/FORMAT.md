# Multi-engine spec review — format and log

Tracks every time a spec/task was submitted to an independent AI engine
for review (per `task-spec-authoring`'s "cross-check with other available
engines" step), what it found, and what happened next. Purpose: build a
real record to later judge whether this practice is worth its cost —
findings caught vs. review time spent, and how often engines actually
disagree with each other or with the original author.

"Engine" includes a fresh, context-blind subagent instance of the
authoring model itself (e.g. `engine-id: claude-blind-subagent`) — not
only a different underlying model. The independence that matters is
freedom from authorship bias, not model identity.

## What to ask a reviewing engine for

State this structure **directly in the review request itself** — never
tell an engine to go read a past review file to infer the format; that
makes every request depend on a specific prior document staying around
and being re-read, instead of on this one, self-contained spec. Ask for:

1. **Executive assessment** — does the target achieve what it claims to,
   in general terms.
2. **What it gets right** — genuine strengths, not just a token nod.
3. **Blocking findings** (numbered, `B1`, `B2`, ...) — contract gaps,
   contradictions, anything that would let a delegated agent implement
   something incorrectly with high confidence. Specific: exact file/
   line/field/symbol names, not general descriptions.
4. **Important non-blocking findings** (numbered, `I1`, `I2`, ...) —
   real but lower-urgency issues.
5. **Task-by-task (or file-by-file) recommendations** — one entry per
   reviewed unit.
6. **Final verdict** — safe to proceed as-is / proceed with changes /
   stop and correct first.

This list is the format — update it in place as the practice evolves
(e.g. if a round shows a section is never useful, drop it here; if a new
section proves valuable, add it here) rather than pointing at whatever
past review happened to look good.

## One file per engine per round, plus one summary file

A "round" is one target (a spec, a task file, or a batch of related task
files) reviewed by one or more engines at roughly the same time. Naming
is **`NNN-<target-slug>`** — a zero-padded, repo-wide progressive round
number, not a date: a date alone collides the first time two rounds
happen on the same day (this has already happened once), and says
nothing about which commit was actually reviewed. Find the next `NNN` by
listing existing `tasks/_reviews/NNN-*` prefixes.

Each engine gets its **own file**, written directly by that engine
whenever it has file-write access — give it the exact path in the
request (e.g. "write your complete review to
`tasks/_reviews/003-install-engine-rewrite-codex.md`") instead of asking
it to return text for the orchestrator to transcribe. This is both less
work and removes a transcription-error step. Only fall back to
orchestrator-transcribed text when the engine genuinely has no write
access in that invocation:

```text
tasks/_reviews/NNN-<target-slug>-<engine-id>.md   # one per engine, written by that engine when possible
tasks/_reviews/NNN-<target-slug>-SUMMARY.md        # written by the orchestrator after all engines land
```

Writing every engine to the same file risks a concurrent-write race when
rounds are dispatched in parallel (the normal case) — don't do it.

Per-engine file:

```markdown
---
target: <path(s) reviewed, relative to repo root>
date: <YYYY-MM-DD>
commit: <full git SHA of HEAD at review time — `git rev-parse HEAD`>
engine: <engine-id>
model: <model id if known>
verdict: <short phrase>
---

# Review: <short title> — <engine-id>

<the engine's findings — don't rewrite/summarize away specifics, this
is the raw record>
```

Summary file (orchestrator-written, after every engine for the round has
landed):

```markdown
---
target: <same as the per-engine files>
date: <YYYY-MM-DD>
commit: <same commit as the per-engine files>
engines: [<engine-id>, ...]
---

# Summary: <short title> — convergence and resolution

Individual reviews: [<engine-id>](NNN-<target-slug>-<engine-id>.md), ...

## Convergence
- **Triple/double-confirmed**: <findings 2+ engines independently raised>
- **Novel, single-engine**: <findings only one engine raised, judged
  real and worth acting on>
- **Disagreements**: <where engines gave conflicting advice, and how it
  was resolved — with the user, or by judgment call, stated explicitly>
- **What this says about the practice**: worth it or not this round, and
  why — this is the actual meta-tracking data point.

## Resolution — locked-in decisions
<one bullet per decision actually made, so the task-file edits that
follow don't re-litigate it>

## What was NOT changed
<findings deliberately deferred or rejected, with a reason>
```

## Meta-tracking (for judging the practice itself, per this file's purpose)

`tasks/_reviews/00-INDEX.md` lists every round with: date, target, engines
used, verdict per engine, and a rough "was this worth it" note (a real
blocking issue caught vs. only stylistic/already-known feedback). Update
it after every round — this file is the actual answer to "should we keep
doing this."
