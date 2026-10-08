# Task pipeline convention

This directory is a durable, resumable home for AI Swissknife's development
work, structured so a fresh session or a delegated agent (e.g. Kilo, via
`kilo_implement`) with zero conversational memory can pick up correctly.

## Structure

- `CONTEXT.md` — shared, project-wide facts every initiative relies on. Read
  first.
- `00-INDEX.md` — live registry: every initiative, its priority, its status,
  the spec→initiative map. The "what's left / what's done" source of truth.
- `_inbox/to-analyze/` — raw, unstructured input not yet distilled into a
  spec. `_inbox/analyzed/` — same, once it has produced spec(s)/initiative(s)
  (kept for provenance).
- `specs/<slug>.md` — structured spec (*what & why*); one spec can drive
  several initiatives, one initiative can draw on several specs.
- `NN-<slug>/plan.md` — an active initiative's task breakdown (*how*). Tasks
  are `NN.T`, each sized for one independently-verifiable commit. Packaged
  either inline (sections in `plan.md`, for small/medium initiatives) or
  expanded (`NN.T-<name>.md` one file per task, for large or
  delegated-piecemeal initiatives — this project defaults to expanded for
  anything handed to Kilo).
- `NN-<slug>/summary.md` — completion record, added when an initiative ships.
- `done/NN-<slug>/` — implemented + verified on its branch, not yet merged.
- `merged/NN-<slug>/` — merged into the integration branch.

## Pipeline

raw input (`_inbox/`) → distilled into `specs/<slug>.md` → generates/updates
one or more `NN-<slug>/plan.md` → on completion, `summary.md` + move to
`done/` → after merge, move to `merged/`.

## Core rules

- **Ground every task in real code.** Grep/read the actual files (this
  project, `references/agent-hub/`, `references/cc-swiss-knife/`,
  `references/vscode_doc/`, the sibling `kilo-plugin-manager` skill and
  `kilocode-dev` repo elsewhere in the workspace) and quote them — never
  describe a format or API abstractly.
- **Locked-in decisions are durable memory.** Every real design fork
  resolved with the user becomes one bullet with *why* — see `CONTEXT.md`
  for cross-cutting ones. Never re-derive or re-guess a decision already
  made.
- **Explicit non-goals** on every spec — what it does NOT do, and why.
- **Dependency ordering is explicit** — every initiative states what it
  depends on. The `NN` id is stable and never reused; `Priority` in
  `00-INDEX.md` is the actual reading/execution order.
- **Verification is part of the spec, not an afterthought** — every task
  ends with a concrete, runnable check. Match depth to risk: a task whose
  correctness depends on a negative claim ("X is unused elsewhere," "this
  path is dead") needs a full check, not a smoke test, regardless of file
  count (see the `task-spec-authoring` skill for the full rationale).
- **One task, one commit.** Say so explicitly in each task file so a
  continuously-working agent doesn't sweep unrelated changes into it.

## Delegating a task to Kilo

Point `kilo_implement` at exactly one task file (`NN.T-<name>.md`) plus the
owning `specs/<slug>.md` (for locked-in decisions it must not contradict)
and `CONTEXT.md` (global facts) — not the whole `tasks/` tree. Use
`isolation='worktree'` for anything beyond a trivial single-file edit.
After the report, verify against that task's own Verification section
specifically, then update `00-INDEX.md`.

## Emergent tasks

Short copy of the `macroplan-authoring` skill, section "Emergent tasks" (common-tools >= 0.2.1). These are `T###` tasks that appear mid-session, beside the `NN.T` tasks of the initiatives.

- **Capture first, then continue**: write the task file at once; do not keep it only in the session.
- **Ids** `T###`, unique including `done/`; reserve by creating the file. Layout `tasks/<category>/T###-<slug>.md`, or a folder with README/CONTEXT/PROGRESS when there is context. Each category has a `README.md` and `notes/`.
- **Header** (one `key: value` per line): `id`, `title`, `category`, `priority` (P0-P3) with `priority-reason`, `next-up`, `state`, `executor`, `depends-on`, `decider`, `sources`, `paths`, `handoff`.
- **States**: open, in progress, waiting, blocked, delivered, verified, done, dropped. Only someone other than the executor sets `verified`.
- **Registry**: `00-INDEX.md` sections Next up (<= 5), Tasks by category, Decisions waiting, Done are the state; update them with every change.
- Finished tasks move with `git mv` to `tasks/done/<category>/`.
