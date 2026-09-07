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

Initiatives 01-05 are implemented (`src/domain/`, `src/adapters/`,
`src/sources/`, `src/translator/`) — **this paragraph is a pointer, not a
snapshot**: run `find src -name '*.ts' ! -name '*.test.ts'` for the live
list rather than trusting a hand-maintained tree here, since it drifts
every time an initiative lands (this is itself I12 from the second Codex
review, `_inbox/analyzed/codex-analysis-2.md` — don't let it drift again).

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
  `Source` (and a `ManagedInstallation`) registers either personally or
  shared with the team via git; a project-level `Source` must never leak
  into other workspaces. *Why:* explicit user requirement. See `SPEC.md`
  §1. (Exact paths: see the data-directory-rename decision below —
  `.ai-toolkit` was renamed to `.ai-swissknife`.)
- **`git-custom` (generic HTTPS/SSH repo, no required manifest) is the
  highest-priority `Source` type** — it's the actual motivating case (§0),
  and must be solved before `git-marketplace`/`remote-url`/
  `git-single-item`. See `SPEC.md` §1 and §6 Phase 1.
- **Hardening gate locked before initiative 06** (2026-08-18/19) — a
  second Codex review of the actual code (not just the spec) found real
  contract gaps at the resolver/install/registry boundary: `Artifact` had
  no way to fetch real content, `CanonicalSkill` only modeled `SKILL.md`
  and dropped a skill's other files, the registry mixed shareable and
  machine-local state, `apply` wasn't atomic, untrusted artifact
  names/paths weren't validated, and "preserve unknown fields verbatim"
  wasn't actually implemented. *Why:* explicit user decision to fix these
  before 06/07 lock in a plan/apply/UI contract on top of them — see
  `SPEC.md` §7 and `_inbox/analyzed/codex-analysis-2.md` for full detail.
  Tasks `02.3`/`03.4`/`04.3`/`05.2` close these gaps; `06`/`07` were
  rewritten since no code existed yet. Multi-engine rounds 001 and 002
  are accepted and fully reflected in the current task files. Round 002
  additionally locks portable `DesiredSource` + `desiredInstallations`,
  typed `ResolvedArtifact<CanonicalSkill>`, detector diagnostics carried
  to the UI, one shared Git checkout/read mutex, translated-output
  payloads, apply-time hash + complete-tree revalidation, staged `chmod`,
  truthful recovery outcomes, and zero mutation on every dismissed UI
  path. See `SPEC.md` §7 and `_reviews/002-hardening-gate-SUMMARY.md`.
- **Data directory renamed `.ai-toolkit` → `.ai-swissknife`** (initiative
  02.3) — match the product name before any real user has data under the
  old path; renaming after release would need a migration. *Why:* SPEC.md
  §7 / Codex review finding I13.
- **YAML preservation guarantee: semantic, not byte-verbatim** (initiative
  03.4) — use a real YAML parser (`yaml` npm package) and accept
  canonical reformatting on write, rather than claiming to preserve the
  original document verbatim (comments/anchors/quoting style) when the
  implementation doesn't actually do that. *Why:* SPEC.md §7 / Codex
  review finding B6 — don't overclaim a guarantee the code doesn't meet.
- **`rule` is deferred past Phase 1 for the resolver/install/UI path** — the
  Claude/Kilo `rule` *adapters* stay as already built (dormant, unused by
  any resolver yet), but no resolver discovers a `rule` `Artifact` and no
  install-engine/UI task exposes installing one in Phase 1. *Why:* SPEC.md
  §7 / Codex review finding I7 — installing a rule safely needs a
  merge/composition policy (a project `CLAUDE.md` is often a pre-existing
  shared document, not something to overwrite wholesale) that doesn't
  exist yet; claiming rule as "validated by the vertical slice" when
  nothing actually exercises it end-to-end would be dishonest about what
  Phase 1 proved. **Update 2026-08-19**: this stayed dormant through Phase
  2 and 3 too (never actually closed despite the earlier "Phase 2" label) —
  it's now scheduled as initiative 19 (`specs/phase-4-spec.md` §5), which
  defines the merge policy (demarcated managed block, append-or-replace,
  never touching surrounding content) that unblocks it.
- **`desiredInstallations` was dead data through Phases 1-4** (found
  2026-09-07) — the field has existed in `ManifestFile` since initiative 02
  but nothing ever wrote or resolved it; the only non-declaration reference
  was `sourcesView.ts` pruning entries on source removal. Initiative 22
  gives it a real purpose: project-scoped "recommended installation" entries
  modeled on VS Code's own workspace extension recommendations
  (`.vscode/extensions.json`), surfaced on workspace open. *Why:* re-using
  the existing schema instead of inventing a parallel one avoids a second,
  driftable "intent" list — see `specs/project-recommendations.md`.

## Conventions

- All code, identifiers, comments, commit messages, and doc files
  (including everything under `tasks/`) are in English, regardless of
  what language the planning conversation happened in.
- TypeScript, VSCode extension API, esbuild, ESLint, and the test runner
  already configured by initiative 01. Re-read `package.json` for the
  current commands rather than relying on this summary.
- Every `ManagedInstallation`-writing task must go through the
  resolve/plan/preview/apply/verify pipeline once it exists (initiative
  "install engine") — don't bypass it with a direct file write, even in an
  early task, without flagging it as temporary scaffolding to be replaced.
