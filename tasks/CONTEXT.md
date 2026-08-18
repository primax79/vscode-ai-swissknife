# Project context (shared)

Durable, project-wide grounding shared by every initiative. Read before any
spec or plan. The full rationale for every decision below lives in
[`../SPEC.md`](../SPEC.md) — this file only lists what's locked in and
where to find the source of truth; re-verify anything load-bearing against
the real files, this drifts between sessions.

## What this project is

A VSCode extension ("AI Swissknife") that manages skill/agent/command/
mcp-server/rule/hook artifacts across multiple AI coding assistants (Claude
Code, Kilo Code, GitHub Copilot, Codex CLI, Gemini CLI), sourced from custom
git repositories that no native marketplace normalizes today. Full domain
model, risk list, and phased roadmap: `../SPEC.md`.

## Codebase map

No source code exists yet — this repo currently holds only `SPEC.md`,
`references/` (gitignored, local research material), and this `tasks/`
tree. Initiative 01 creates the extension scaffold. Once it lands, this
section must be updated with the real `src/` layout (annotate additions:
"added by initiative NN").

## Reference material already in the repo (don't re-fetch, don't re-clone)

- `references/agent-hub/` — a real, structurally similar VSCode extension
  (discovery/install of AI artifacts for GitHub Copilot). Its
  `package.json`/`tsconfig.json`/`esbuild.config.js` are the grounding for
  initiative 01's scaffold (see that initiative for the exact fields used).
- `references/cc-swiss-knife/` — a real `git-marketplace` Source instance
  for Claude Code (`.claude-plugin/marketplace.json` + local plugins) and
  a set of `validate-*.sh` per-kind scripts, useful fixtures/checklist for
  the format-detection and pre-flight-validation work.
- `references/vscode_doc/` — a full local mirror (349 pages) of the
  official VSCode docs, `INDEX.md` inside for the listing. Use instead of
  re-fetching from the web.

## External local sources to ground the Kilo/Claude adapters (outside this repo)

- `agentic-coding-kit/plugins/agent-tooling-meta/skills/kilo-plugin-manager/`
  (sibling dir in the workspace) — the existing CLI-level skill that
  already does Kilo↔Claude marketplace install/translation/sync
  (`sync-agents` command). Read in full before writing the Claude/Kilo
  adapters or the translator — don't reverse-engineer what it already
  encodes.
- `kilocode-dev/packages/kilo-vscode/src/services/marketplace/` (sibling
  dir) — Kilo's own marketplace service source, the ground truth for its
  real manifest/feed format and its current limitations.
- `kilocode-dev/packages/opencode/src/{config/agent.ts,config/command.ts,
  skill/index.ts,config/markdown.ts}` — the real frontmatter/config parser
  entry points for agent/command/skill (YAML frontmatter with a permissive
  fallback sanitizer for unquoted multiline values containing colons, see
  `markdown.ts`'s `fallbackSanitization()`). Use as the parsing-behavior
  ground truth, not just the on-disk schema.
- This workspace's other skill repos (e.g. `agentic-coding-kit/`,
  `adk-agentic-coding-kit/`, `gcube-ai-toolkit/`) already contain real
  `SKILL.md` files in Claude's native format — use them as real fixtures
  for the `skill` kind parser/translator instead of hand-written ones.

## Locked-in decisions

- **Custom-repo interoperability is the core problem, not "another
  marketplace"** — native marketplaces and VSCode's own Agent
  Plugins/Agent Host cover more ground every release; this project's value
  is the layer over independent/private/unstructured repos they don't
  reach. *Why:* motivating pain point, see `SPEC.md` §0.
- **Full scope stays in the spec; implementation is phased, not
  breadth-first** — 5 assistants × 6 kinds × full Marketplace+Management is
  the enduring vision, but nothing gets built for all of them before a
  narrow vertical slice is proven. *Why:* explicit user decision after
  weighing Codex's narrower-MVP recommendation against keeping the full
  vision — see `SPEC.md` §6 and `_inbox/analyzed/codex-analysis.md` for the
  two positions.
- **Phase 1 targets Claude Code + Kilo Code first, `skill` kind only** — not
  the two assistants least covered by VSCode's native tooling (that's Kilo
  and Gemini). Two different, non-conflicting selection axes: Claude+Kilo
  is "where custom-repo pain is most concrete today"; Kilo+Gemini is
  "where VSCode's native Agent Host/Agent Plugins don't reach at all."
  *Why:* see `SPEC.md` §5 top risk entry and §6 Phase 1.
- **`Source → Package → Artifact`, not a flat catalog entry** — a `Source`
  resolves to one or more `Package` (a plugin, a bundle — the distributable
  unit), each containing one or more `Artifact` (a single skill/agent/
  mcp-server/etc.). *Why:* Claude installs composite plugins; flattening
  loses "what gets installed together." See `SPEC.md` §1.
- **`ObservedArtifact` ≠ `ManagedInstallation`, promotion is explicit and
  per-item** — a manually-discovered item on disk is never automatically
  something the extension can overwrite or delete. *Why:* safety — see
  `SPEC.md` §1 "Safety principle."
- **Canonical model per `ItemKind`, not N×N pairwise translation** — every
  adapter reads its native format into one shared canonical model per
  kind; the translator works canonical→canonical and preserves
  unrecognized fields on round-trip instead of dropping them. *Why:*
  scales to 5 assistants without a combinatorial translator matrix. See
  `SPEC.md` §4.
- **Every conversion carries an explicit diagnostic** —
  `lossless | adapted-with-warning | potentially-destructive | unsupported`
  — shown always, not only on loss. *Why:* silent lossy conversion is
  exactly the failure mode this project exists to avoid. See `SPEC.md` §2.
- **Install/sync is a pipeline, not an atomic file copy** —
  `resolve → plan → preview → apply → verify`, atomic/recoverable writes.
  *Why:* the user must see the plan (files touched, conflicts, diagnostics)
  before anything is written. See `SPEC.md` §2.
- **`Source` and the registry both have global + project scope** — a
  `Source` (and a `ManagedInstallation`) registers either personally
  (`~/.ai-toolkit/registry.json`) or shared with the team via git
  (`.ai-toolkit/registry.json` in the workspace); a project-level `Source`
  must never leak into other workspaces. *Why:* explicit user requirement.
  See `SPEC.md` §1.
- **`git-custom` (generic HTTPS/SSH repo, no required manifest) is the
  highest-priority `Source` type** — it's the actual motivating case (§0),
  and must be solved before `git-marketplace`/`remote-url`/
  `git-single-item`. See `SPEC.md` §1 and §6 Phase 1.

## Conventions

- All code, identifiers, comments, commit messages, and doc files
  (including everything under `tasks/`) are in English, regardless of
  what language the planning conversation happened in.
- TypeScript, VSCode extension API. No build tooling chosen yet beyond what
  initiative 01 sets up (grounded in `references/agent-hub/`'s
  esbuild-based setup — adopt or deviate explicitly, don't invent a third
  option without a stated reason).
- Every `ManagedInstallation`-writing task must go through the
  resolve/plan/preview/apply/verify pipeline once it exists (initiative
  "install engine") — don't bypass it with a direct file write, even in an
  early task, without flagging it as temporary scaffolding to be replaced.
