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

## One file per review round

`tasks/_reviews/<date>-<target-slug>.md`, e.g.
`2026-08-18-hardening-gate.md`. A "round" is one target (a spec, a task
file, or a batch of related task files) reviewed by one or more engines
at roughly the same time — not one file per engine; put every engine's
result for that round in the same file so convergence/divergence is easy
to read at a glance.

```markdown
---
target: <path(s) reviewed, relative to repo root>
date: <YYYY-MM-DD>
engines: [<engine-id>, ...]   # e.g. codex, kilo-gemini
---

# Review round: <short title>

## <engine-id> — verdict: <approved | needs-changes | blocking-issues>

<engine's findings, as it returned them — don't rewrite/summarize away
specifics, this is the raw record>

## <engine-id-2> — verdict: ...

...

## Convergence

- **Agreed**: <findings 2+ engines independently raised>
- **Disagreed**: <findings only one engine raised, or where engines gave
  conflicting advice — and how it was resolved (with the user, or by
  judgment call, stated explicitly)>
- **Novel**: <a finding no engine raised that the human/orchestrator
  caught, if relevant — useful for judging engine coverage>

## Resolution

<what was actually done: which findings were acted on, which were
deferred with a reason, which were rejected with a reason — link to the
commit(s) if any>
```

## Meta-tracking (for judging the practice itself, per this file's purpose)

`tasks/_reviews/00-INDEX.md` lists every round with: date, target, engines
used, verdict per engine, and a rough "was this worth it" note (a real
blocking issue caught vs. only stylistic/already-known feedback). Update
it after every round — this file is the actual answer to "should we keep
doing this."
