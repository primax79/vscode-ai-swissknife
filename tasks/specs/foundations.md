# Foundations: generic engine + Claude/Kilo, skill-first (spec & context)

> **Drives initiatives:** [01](../01-project-scaffold/plan.md),
> [02](../02-domain-and-registry/plan.md),
> [03](../03-claude-kilo-adapters/plan.md),
> [04](../04-source-resolver/plan.md),
> [05](../05-translator-skill/plan.md),
> [06](../06-install-engine/plan.md),
> [07](../07-minimal-ui/plan.md) · raw sources: `../_inbox/analyzed/codex-analysis.md`

## Goal

Ship a working, narrow vertical slice of AI Swissknife (SPEC.md §6 "Phase
1"): a VSCode extension where a user can register a private/custom Git
repository containing loose skills (directories with `SKILL.md`, no
marketplace manifest required), browse what it contains, and install any
of them onto **Claude Code** or **Kilo Code**, at global or project scope,
with a preview step before anything is written and tracked provenance
afterward. `rule` (CLAUDE.md/AGENTS.md-equivalent) rides along at the same
time as `skill` because both assistants already converge on it with near
zero translation (SPEC.md §5 "`rule` convergence").

This is deliberately **not** the full spec: no `agent`/`mcp-server`/`hook`/
`command`, no Copilot/Codex/Gemini adapters, no dashboard/form editor/
bidirectional sync/watchers. Those are Phase 2/3 (SPEC.md §6) and get their
own specs once this slice ships and is validated end to end.

## Current state (verified 2026-08-18 — re-check before starting)

- The repo has no source code yet: only `SPEC.md`, `.gitignore`,
  `references/` (gitignored local research material), and this `tasks/`
  tree. Confirmed via `ls -la` on 2026-08-18.
- Git remote is configured: `git@github.com:primax79/vscode-ai-swissknife.git`,
  on branch `main`, no commits yet.
- Full domain model, the verified per-assistant format table, and every
  open risk live in `../../SPEC.md` — read §1 (domain model + format
  table), §4 (architecture), §5 (risks) before starting any task below.
  This spec does not repeat that content; it only says which slice of it
  applies now.

## Locked-in decisions (scoped to this slice; see `CONTEXT.md` for
cross-cutting ones)

- **`skill` + `rule` only, Claude Code + Kilo Code only, for this whole
  spec.** Both kinds are near-zero-translation between the two (see below)
  — the slice is chosen specifically to validate the pipeline
  end-to-end without also debugging a hard translation case in the same
  pass.
- **`skill` format is byte-identical between Claude Code and Kilo Code**:
  a directory containing `SKILL.md` with `name`/`description` frontmatter.
  Verified in Kilo's own source: `installer.ts:214` (checks for
  `SKILL.md`), `plugin_manager.py:316-321` (warns if `name`/`description`
  missing, no Kilo-specific extra fields). This means the "translator" for
  `skill` in this slice is close to a passthrough — still route it through
  the canonical-model + diagnostic pipeline (SPEC.md §4) rather than a
  special-cased copy, so Phase 2 doesn't have to retrofit it.
- **`rule` needs zero translation Claude↔Kilo either**: Kilo reads
  `AGENTS.md`/`CLAUDE.md` at project root and `~/.config/kilo/AGENTS.md`
  globally *natively*, with no need to list them in its own `instructions`
  mechanism (source: `rules-migration.md:67-73` in `kilocode-dev`'s docs,
  cited in SPEC.md §1 `rule` row). A `rule` installed for Claude at
  `<project>/CLAUDE.md` is therefore already valid for Kilo without any
  adapter-side rewrite — the Kilo adapter's `writeRule()` can literally be
  "ensure the file exists at the same path", but the canonical model must
  still model it as its own step (again: for Phase 2 uniformity, and
  because a *different* rule content per assistant might be wanted later).
- **Kilo paths for `skill`**: project `<repo>/.kilo/skills/`, global
  `~/.kilo/skills/` (`paths.ts:21-24`, consistent with
  `plugin_manager.py:269`). **Not** `~/.config/kilo/skills` — that's the
  agent path family (Phase 2 concern, not this slice).
- **Claude paths**: `skill` — project `<repo>/.claude/skills/`, global
  `~/.claude/skills/` (standard Claude Code convention, SPEC.md §1).
  `rule` — `CLAUDE.md` at repo root (project) or `~/.claude/CLAUDE.md`
  (global).
- **Source type for this slice: `git-custom` only** (generic HTTPS/SSH
  git repo, no manifest required, structure inferred) + `local-folder`
  for fixtures/testing. `git-marketplace`/`remote-url`/`git-single-item`
  are Phase 2 (SPEC.md §6).
- **Format detection for `git-custom`** must handle at least: a repo that
  *is* a single skill (has `SKILL.md` at its root), and a repo with
  multiple sibling directories each containing `SKILL.md` one level down
  (or nested — don't assume a fixed depth, walk and detect). No manifest
  generation should ever be required from the user when the structure is
  unambiguous (SPEC.md §2.2).
- **Real fixtures, not invented ones**: use this workspace's own existing
  `SKILL.md` files (e.g. under `agentic-coding-kit/`,
  `adk-agentic-coding-kit/`, `gcube-ai-toolkit/` — sibling directories in
  the workspace) as test input for the format detector and skill parser,
  and `references/cc-swiss-knife/plugins/*/skills/` as a second real
  source with a different repo shape (plugin-nested, not flat). Do not
  hand-write synthetic `SKILL.md` fixtures as the *only* test input.

## Non-goals (explicit, don't build these in this slice)

- No `agent`, `mcp-server`, `hook`, `command` kind — even though the
  domain model (SPEC.md §1) defines all 6, only `skill`+`rule` get an
  adapter, resolver, and translator implementation here. Stub the
  `ItemKind` union with all 6 values (types are cheap and shared), but do
  not implement handling for the other 4.
- No GitHub Copilot / Codex CLI / Gemini CLI adapters.
- No `git-marketplace`, `remote-url`, `git-single-item` Source resolvers.
- No dashboard webview, no form editor, no bidirectional sync, no file
  watchers, no drift/update detection beyond what's needed to record
  provenance (the *detection* itself is Phase 3, SPEC.md §6).
- No `Bundle`/`Package` UI for multi-artifact install flows beyond what
  the `Package` domain type itself requires structurally — a `git-custom`
  Source in this slice always resolves to one degenerate `Package` per
  skill (SPEC.md §1 "a single-skill repo is a degenerate Package").
- Do not attempt to resolve the `.kilo/agent/` vs `.kilo/agents/` path
  discrepancy (SPEC.md §5) — it only matters once `agent` is implemented
  in Phase 2. Don't let it block or creep into this slice.
