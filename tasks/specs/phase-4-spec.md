# Spec — AI Swissknife Phase 4: Form Editor, Sync, Hook/Rule, Remaining Sources & Adapters

> **Status:** Draft / Accepted for implementation
> **Parent Spec:** [`SPEC.md`](../../SPEC.md) · [`phase-2-spec.md`](phase-2-spec.md) · [`phase-3-spec.md`](phase-3-spec.md)
> **Pre-requisite:** Phase 1, 2, and 3 (Initiatives 01-16) completed and verified.

---

## 1. Goals & scope of Phase 4

Phases 1-3 built the full engine (resolve→plan→preview→apply→verify), four
kinds (`skill`, `agent`, `command`, `mcp-server`), three assistants
(`claude-code`, `kilo-code`, `github-copilot`), three source types
(`git-custom`, `local-folder`, `git-marketplace`), and the management surface
(drift, discovery, watchers, dashboard).

Phase 4 closes the remaining gap against `SPEC.md`'s full scope, in the
priority order already validated against the codebase:

1. **Form Editor Webview** (`SPEC.md` §3.4, §4) — structured create/edit for
   a single artifact, replacing hand-written frontmatter.
2. **Cross-Assistant Sync** (`SPEC.md` §3.5) — copy an already-installed item
   (or a promoted `ObservedArtifact`) from one assistant/scope to another,
   reusing the same pipeline with a different source-side.
3. **`hook` kind + active `rule` merge** (`SPEC.md` §1, §5) — the sixth
   `ItemKind`, plus turning `rule` from "adapter exists, dormant" into an
   actually-installable kind with a non-destructive merge policy.
4. **`remote-url` & `git-single-item` sources** (`SPEC.md` §1) — the two
   `SourceType` values already in the domain union (`src/domain/types.ts`)
   but with no resolver behind them yet.
5. **Codex CLI & Gemini CLI adapters** (`SPEC.md` §1) — the fourth and fifth
   `AssistantId` values already in the domain union but with no adapter yet.

Each area gets its own initiative (17-21, see §7) so they can be delegated
and verified independently; they share no code dependency on each other
(only on already-completed Phase 1-3 work), so they are parallelizable once
their individual prerequisites (below) are met.

## 2. Non-goals (explicit, to prevent scope creep)

- **Not a general-purpose Markdown/TOML editor.** The Form Editor (17) only
  exposes the schema fields already modeled in `CanonicalSkill`/
  `CanonicalAgent`/`CanonicalCommand`/`CanonicalMcpServer`/`CanonicalRule`
  (`src/adapters/types.ts`) plus a body/free-form area; it does not add new
  canonical fields.
- **Sync (18) is not a general file-copy tool.** It only moves items already
  modeled as `ManagedInstallation` or `ObservedArtifact` — it does not
  invent a new "copy any file" feature outside the domain model.
- **Hook (19) does not guess undocumented paths.** Per `SPEC.md` §5, the
  exact hook paths are contradicted between official sources; task 19.1
  is a mandatory verification spike, not implementation — no hook adapter
  code is written before its findings are recorded (see §7).
- **`remote-url`/`git-single-item` (20) do not add new `ItemKind`s or new UI
  concepts** — they slot into the existing `Source`/`Package`/`Artifact`
  model and the existing "Add Source" flow.
- **Codex/Gemini (21) do not retrofit `command` as an install target for
  Codex.** Per `SPEC.md` §5, Codex's `command` is deprecated upstream — the
  adapter reads it for discovery/import only, never offers it when writing.
- **Third scope tier ("Organization")** mentioned in `SPEC.md` §5 stays out
  of scope for all of Phase 4 — no initiative here introduces it.

## 3. Form Editor Webview (drives Initiative 17)

Structured create/edit for a single artifact, replacing raw file editing
(`SPEC.md` §3.4). Reuses the webview-panel pattern already established by
`DashboardPanel` (`src/ui/dashboard.ts`, initiative 16) — same
`createWebviewPanel`/message-protocol shape, not a new mechanism.

**Locked-in architectural decision**: the Form Editor does **not** go
through `planInstall`/`PlanInstallParams` (`src/engine/types.ts`), because
that pipeline requires a `Source`+`Package`+`Artifact` triple resolved from
a marketplace-type source — there is none when authoring a brand-new local
item or hand-editing an already-installed one. Instead it calls the
relevant adapter's own parse/serialize pair directly (e.g.
`parseClaudeAgentMarkdown`/`serializeClaudeAgentMarkdown` in
`src/adapters/claude.ts`, `readSkill`/`writeSkill` in
`src/adapters/codec.ts`), then updates `state.json`'s content hash via the
same `canonical*Hash` functions the install engine already uses
(`src/adapters/codec.ts`), so a form-edited item is indistinguishable from
one installed by the pipeline for later drift detection (initiative 13).

Per-kind field schema (only fields that already exist on the canonical
model — see `src/adapters/types.ts`):

- `skill`: `name`, `description`, body (markdown), auxiliary files list
  (read-only in v1 — attaching new files is a plain-text/file-picker
  fallback, not a structured field).
- `agent`: `name`, `description`, `mode`, `tools[]`, `permissions` (map),
  `model`, `variant`, body.
- `command`: `name`, `description`, `agent`, `model`, `subtask`, body.
- `mcp-server`: `id`, `type` (`stdio`/`http`/`sse`), `command`, `args[]`,
  `url`, `env` (map), `headers` (map).
- `rule`: single body field (content is unstructured markdown per
  `CanonicalRule`) — no structured fields to expose.

`extraFields` (unrecognized frontmatter preserved by every canonical model)
is never dropped: the form shows it as a read-only "raw fields" panel, not
as editable structured inputs, and round-trips it unchanged on save — this
is the same "preserve unrecognized fields" guarantee already locked in for
the translator (`CONTEXT.md` "Canonical model per `ItemKind`" entry), now
extended to the editor path.

`hook` is explicitly **out of scope for 17** — its canonical model does not
exist yet (that's initiative 19); the form editor is extended to cover it
once 19 lands, not before.

## 4. Cross-Assistant Sync (drives Initiative 18)

"Copy this agent from Kilo to Claude", or promote an item between scopes
(`SPEC.md` §3.5). Reuses the `resolve → plan → preview → apply → verify`
pipeline (`SPEC.md` §2), but the source-side is a `ManagedInstallation` (or
an `ObservedArtifact` promoted on the fly via the existing promotion engine,
initiative 14) instead of a remote `Artifact`.

**Locked-in architectural decision**: `planInstall`
(`src/engine/plan.ts`)/`PlanInstallParams` (`src/engine/types.ts`) is
shaped around `{source, pkg, artifact}` from a source resolution — sync has
none of these, only an already-materialized `ManagedInstallation`. Rather
than force a fake `Source`/`Package`/`Artifact` triple through the existing
function, add a sibling entry point (e.g. `planSync` in a new
`src/engine/sync.ts`) that:

1. Reads the origin's canonical content via the origin assistant's own
   parse function (dispatch on `installation.assistant`/`installation.kind`
   — the same functions the Form Editor (17) calls).
2. Translates it to the target assistant via the **existing, unmodified**
   `translateSkill`/`translateAgent`/`translateCommand`/`translateMcp`/
   `translateRule` functions (`src/translator/*.ts`) — sync must not fork a
   second translation path.
3. Produces the same `SupportedInstallPlan`/`UnsupportedInstallPlan` shape
   (`src/engine/types.ts`) the marketplace pipeline already produces, so
   the **existing, unmodified** `applyInstall`/verify functions
   (`src/engine/apply.ts`) can run unchanged. Sync must not duplicate the
   atomic-write/rollback logic (`CONTEXT.md`'s hardening-gate invariants
   apply here identically).

Conflict handling: the existing Available-view pattern
(`src/ui/availableView.ts:377-390` and `:490-525`) is a binary
overwrite/cancel confirmation. Sync needs a third option, **skip**, exposed
through the same prompt (reusable for both single-item and batch sync),
since syncing N items to a target where some already exist should not force
an all-or-nothing choice.

## 5. `hook` kind + active `rule` merge (drives Initiative 19)

**`hook` is the sixth `ItemKind`** (already in the `ItemKind` union in
`src/domain/types.ts`, unimplemented). Per `SPEC.md` §5, the exact paths are
**contradicted between official VSCode sources** for both Claude Code and
GitHub Copilot — this must be closed by direct verification (reading
`references/vscode_doc/`, the Copilot extension source if needed, or a real
test install) **before** writing adapter code, not guessed by analogy. See
§7, task 19.1.

**`rule` install/sync activation**: the Claude/Kilo `rule` adapters already
exist (`src/translator/rule.ts`) but are dormant — no resolver discovers a
`rule` `Artifact` and no install/UI path installs one
(`CONTEXT.md`'s "`rule` is deferred to Phase 2" entry, which — despite the
label — was never actually closed in Phase 2 or 3). The blocker named there
still applies: `CLAUDE.md`/`AGENTS.md`/`copilot-instructions.md` are often a
pre-existing, hand-maintained document — installing a `rule` must **merge**,
not overwrite. Policy: content contributed by an install/sync is wrapped in
demarcated markers (e.g. `<!-- ai-swissknife:managed:<sourceId> -->` /
`<!-- /ai-swissknife:managed -->`), appended if the marker block doesn't
exist yet, replaced in place if it does (so a re-install/update doesn't
duplicate), and the pre-existing surrounding content is never touched. This
is exposed in preview as a diff of the merge result, not just the new
block.

## 6. `remote-url` & `git-single-item` sources (drives Initiative 20)

Both values already exist in the `SourceType` union
(`src/domain/types.ts`) with no resolver in `src/sources/`.

- **`git-single-item`**: a Git repo that is itself one artifact (no
  marketplace manifest, not even the loose sibling-directories structure
  `git-custom` handles). Reuses `gitCustom.ts`'s clone/checkout/mutex
  machinery (`KeyedMutex`, already exported from `src/sources/gitCustom.ts`
  and reused as-is by `gitMarketplace.ts` — same pattern applies here), but
  the checked-out root itself *is* the `Artifact`: kind is detected by
  presence of `SKILL.md` at root, agent/command frontmatter, or an MCP
  config file, via the existing `detect.ts` helpers
  (`findSkillDirs`/`findAgentFiles`/`findCommandFiles`/`findMcpDefinitions`)
  applied to the single root instead of scanned recursively for siblings.
- **`remote-url`**: a single file or small manifest fetched over plain
  HTTP(S) (e.g. a raw gist/file URL) — no Git involved. Content-hash based
  re-fetch (skip re-download when the ETag/hash is unchanged), cached under
  the same cache-directory convention `gitCustom`/`gitMarketplace` already
  use.

Both plug into the existing "Add Source" flow in the Sources view
(`src/ui/sourcesView.ts`) and the existing `resolve`/`plan` pipeline
unchanged — no new UI concept, no new `Package`/`Artifact` shape.

## 7. Codex CLI & Gemini CLI adapters (drives Initiative 21)

Both `AssistantId` values already exist in the domain union
(`src/domain/types.ts`) with no adapter in `src/adapters/`. Per the `SPEC.md`
§1 table:

- **Codex CLI**: `agent` is a structurally different `.toml`
  (`name`/`description`/`developer_instructions`/model/reasoning/sandbox/
  mcp/skills — not a frontmatter rename, a different shape entirely);
  `command` (`prompts/*.md`, `$1..$9`/`$ARGUMENTS`) is **deprecated
  upstream** — read for import/discovery only, never an install target
  (`SPEC.md` §5); `mcp-server` is a TOML `[mcp_servers.<id>]` entry;
  `rule` is plain `AGENTS.md`, no frontmatter; `skill` is the same
  `SKILL.md` format as Claude (no translation needed).
- **Gemini CLI**: `command` is a `.toml` file where the command name is the
  path with `/` replaced by `:` (e.g. `git/commit.toml` → `/git:commit`);
  `rule` is `GEMINI.md`, hierarchical (global + project combine, unlike the
  single-file Claude/Codex model); `mcp-server` is a `mcpServers` key in
  `settings.json` (which always wins over an extension-declared server);
  `skill` is the same `SKILL.md` format; **`agent` has no confirmed
  standalone format outside an extension bundle** — per `SPEC.md` §5 this
  must be verified directly against the `google-gemini/gemini-cli` repo,
  not assumed absent (see §7 task 21.1).

Both adapters plug into the **existing** translator functions
(`src/translator/*.ts`) by adding new `targetAssistant` branches — most of
these are necessarily lossy (Codex's `sandbox`/`reasoning` has no
equivalent anywhere else in the matrix), which must produce an explicit
`adapted-with-warning`/`unsupported` diagnostic per the already-locked
"every conversion carries an explicit diagnostic" invariant
(`CONTEXT.md`), never a silent drop.

## 8. Phase 4 initiatives breakdown

| Initiative | Title                                       | Scope                                                                                                                        | Depends on   |
| ---------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **17**     | **Form Editor Webview**                     | Per-kind field schema, `FormEditorPanel`, direct adapter read/write (no `planInstall`), extraFields raw panel, create+edit commands. | 08, 09, 10, 16 |
| **18**     | **Cross-Assistant Sync**                    | `planSync` sibling entry point, reuse of existing translators/apply/verify, skip/overwrite/cancel conflict UI, "Copy to..." action. | 06, 13, 14, 16 |
| **19**     | **`hook` kind + active `rule` merge**       | Path-verification spike, `CanonicalHook` + Claude/Copilot adapters, non-destructive `rule` merge policy, UI wiring.          | 03, 06, 12   |
| **20**     | **`remote-url` & `git-single-item` sources**| Two new resolvers reusing `gitCustom`'s mutex/checkout machinery and `detect.ts`, Sources-view wiring.                       | 04, 11       |
| **21**     | **Codex CLI & Gemini CLI adapters**         | Gemini-agent verification spike, TOML parse/serialize for both, translator branches, UI assistant pickers.                   | 03, 05, 08, 09, 10, 12 |
