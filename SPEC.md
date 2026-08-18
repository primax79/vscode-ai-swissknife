# Spec — AI Swissknife

## 0. Problem and motivation

The original problem this idea comes from is **not** "there's no generalist
marketplace covering multiple assistants" — native marketplaces (Claude
Code, Kilo Code) and native customization systems (VSCode Agent
Plugins/Agent Host, see below) already exist and keep covering more ground
on their own. The real problem is **poor management of skills/agents/mcp/
rules that live in custom repositories** — private, corporate, on
Gitea/GitLab, local folders, or simply repos without a manifest conforming
to a single assistant's native format. No current native system normalizes
uniformly:

- private or corporate Git repositories, or on providers other than GitHub;
- local folders;
- repositories with a single skill and no marketplace manifest;
- repositories with multiple plugins/skills but no feed dedicated to the
  chosen target;
- the same source reused across different assistants (format translation);
- drift/update between source and installed copy, including manual local
  edits.

Value prop: **not to replace** native marketplaces/managers, but to be the
interoperability layer over independent repositories — deferring to native
backends when possible, and covering where they don't reach. This implies
handling cross-assistant skill/agent/command/mcp-server/rule/hook (Claude
Code, Kilo Code, GitHub Copilot, OpenAI Codex CLI, Google Gemini CLI,
potentially others) across two areas: **Marketplace** (sources and
installation) and **Management** (inventory, editing, sync) — but the
depth of work on each assistant/kind must be **sequenced by actual
priority**, not built out breadth-first from the very first task (see §6
Roadmap).

---

Important note before starting implementation: the working environment
already has a skill covering part of this domain at the CLI/agent level —
`kilo-plugin-manager` (install/update from git marketplaces for Kilo,
emulating Claude's, + Claude↔Kilo frontmatter translation + a
`sync-agents` command that absorbed what used to be the separate
`kilo-claude-sync` skill, now deprecated/merged). It should be read in full
before designing the adapters — it likely already contains the format
translation rules that would otherwise have to be reverse-engineered from
scratch, and it's also a ready source of fixtures/golden tests for Phase 0
(see §6).

Also, `references/agent-hub/` holds the cloned source of **Agent Hub**, an
existing VSCode extension (marketplace: `nimsbhai.agent-hub`) that does
discovery/install of AI artifacts but **only for GitHub Copilot**
(single-assistant, always installs under `.github/`). It doesn't overlap
with this spec's multi-assistant scope (no `Assistant`/`Adapter`/format
translation concept, no mcp-server handling), but its README.md and
ARCHITECTURE.md document Copilot's native syntax well — use it as a
reference for the §1 table and for the Copilot adapter (Phase 2, §6), don't
re-read it from scratch.

`references/cc-swiss-knife/` holds the cloned source of **cc-swiss-knife**,
not a tool but a real `git-marketplace` Source for Claude Code (a repo with
`.claude-plugin/marketplace.json` + local plugins, installed via Claude
Code's native `/plugin install`, no UI/state of its own). Use it as a
concrete, minimal example of the manifest schema to parse in the
`git-marketplace` Source resolver (§6), and as a reference for the
per-kind `validate-*.sh` scripts cited in the §5 risks — don't re-read it
from scratch.

A complete local mirror of the official VSCode documentation (349 pages,
not just the Agents section) lives in `references/vscode_doc/` — see
`INDEX.md` in there for the listing. Consult it instead of re-fetching from
the web while implementing the Copilot adapter (Phase 2, §6) and for any
question about native VSCode behavior cited in the §5 risks.

**Relevant external development to know before designing Area A**: VSCode
introduced a native **Agent Plugins** system
(<https://code.visualstudio.com/docs/agent-customization/agent-plugins>)
that auto-detects and installs (from a configurable marketplace or
directly from a git repo) plugins in 4 manifest formats — including
`.claude-plugin/plugin.json`, the same format as `cc-swiss-knife` — defining
`skill` and `mcp-server` as cross-client "portable component types", with
`agent`/`hook`/slash command being client-specific. For the Claude↔Copilot
pair inside VSCode, this already covers a good chunk of what Area A
(Marketplace) was meant to provide: browsing, cross-format install,
enable/disable per scope. It doesn't touch Kilo Code, Codex CLI, Gemini CLI
(none of them run inside VSCode's chat runtime), and it offers nothing of
Area B (Management: dashboard, edit via form, drift detection, sync across
scopes) — the project's real differentiator shifts accordingly toward
those two fronts, not toward mere cross-format installation for
Claude/Copilot. See §5 for detail.

Another piece: the **Agents Window**
(<https://code.visualstudio.com/docs/agents/run/agents-window>) — a
dedicated, agent-first, multi-workspace/multi-session VSCode window — has a
**"Customizations"** panel that natively manages `Agents`/`Skills`/
`Instructions`/`Hooks`/`MCP servers`/`Plugins` from a single UI, and its
sessions run on an "Agent Host" with **Copilot, Cloud, Claude, and Codex**
(not just Copilot). The real depth of the Customizations panel (just a
toggle/list, or structured editing/creation with validation?) hasn't been
verified — don't assume it's equivalent to the Form editor (Phase 3, §6)
without direct verification. See §5 for the impact on the value prop.

---

## 1. Domain model

Core, assistant-agnostic entities:

- **Assistant** — a target tool: `claude-code`, `kilo-code`,
  `github-copilot`, `codex-cli`, `gemini-cli` (extensible: `cursor`,
  `cline`, ...). Defines its own conventions via an **Adapter** (see §5).
- **Scope** — `global` (e.g. `~/.claude`, `~/.kilo`, `~/.codex`,
  `~/.gemini`, `~/.copilot`) or `project` (e.g. `.claude/`, `.kilo/`,
  `.codex/`, `.gemini/`, `.github/` inside a workspace). GitHub Copilot is
  **no longer** a special case — it has both project (`.github/...`) and
  user (`~/.copilot/...`) locations for almost every kind (see table). An
  installed item always lives in an `(Assistant, Scope, projectPath?)`
  triple.
- **ItemKind** — `skill | agent | command | mcp-server | rule | hook`.
  `hook` was promoted from "candidate" to a first-class kind: confirmed
  native both on Claude Code (plugin-scoped `hooks/hooks.json`, presumably
  `.claude/settings.json` for normal projects) and on GitHub Copilot
  (near-identical schema), with the exact path still to be pinned down in
  Phase 1/2 (see §5). Every kind has a different physical shape per
  assistant — **don't treat "install" as a uniform file-copy operation**,
  it must be modeled per kind and per assistant. Verified (not guessed)
  mapping for the 5 covered targets — **the Copilot column was rewritten**:
  the previous taxonomy (chatmode/instructions/prompt/task/profile, taken
  from Agent Hub) was based on an older format largely superseded by
  VSCode's native "Agent Customization" system (2026):

  | ItemKind     | Claude Code                                                                                                                                                                                    | Kilo Code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | GitHub Copilot (native VSCode)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Codex CLI                                                                                                                                                                              | Gemini CLI                                                                                                                            |
  | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
  | `skill`      | dir with `SKILL.md` (frontmatter)                                                                                                                                                              | dir with `SKILL.md`, same layout as Claude (`installer.ts:214`, `plugin_manager.py:316-321`); required frontmatter `name`/`description` only. Project `.kilo/skills/`, global `~/.kilo/skills/` (`paths.ts:21-24`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | dir with `SKILL.md` in `.github/skills/` (project, default) or `.claude/skills/`/`.agents/skills/` (also read natively!); user: `~/.copilot/skills/`, `~/.claude/skills/`, `~/.agents/skills/`; other locations via the `chat.agentSkillsLocations` setting. Frontmatter `name` (≤64, lowercase-hyphen)/`description` (≤1024) + optional `argument-hint`/`user-invocable`/`disable-model-invocation`/`context:"fork"` — **same format 1:1 as Claude/Codex/Gemini**, was a mapping error in the earlier version                                                                                                                                                                               | dir with `SKILL.md` — same Anthropic-style format                                                                                                                                      | dir with `SKILL.md` — same format, portable 1:1 from Claude/Codex                                                                     |
  | `agent`      | `.md` file with frontmatter                                                                                                                                                                    | `.md` file, but a different schema from Claude: `mode: primary\|subagent\|all` + a nested `permission:` block (`read`/`edit`/`bash`/`skill`/`webfetch`/`mcp` → allow) instead of Claude's flat `tools:` list (mapping both ways in `TOOL_PERMISSION_MAP`/`PERMISSION_TOOL_MAP`, `plugin_manager.py:44-61`). **Unresolved path discrepancy between Kilo's two own repos**: `kilo-plugin-manager`'s `plugin_manager.py:262-263`/`sync-agents` use `.kilo/agent/` (singular, project) + `~/.config/kilo/agent` (global, per `MOVE_KINDS`); `kilocode-dev`'s `paths.ts:15-17` (`agentsDir()`) uses `.kilo/agents/` (**plural**, project) + `~/.config/kilo/agents` (global). Must pin down which one the actual Kilo CLI reads before writing the adapter (Phase 1) — don't guess, test against a real Kilo install. | `*.agent.md` file in `.github/agents/` (project, default) or `.claude/agents/` (Claude format read natively); user: `~/.copilot/agents/`; other locations via `chat.agentFilesLocations`. Frontmatter `name`/`description`/`tools`/`model`/`agents` (subagents)/`handoffs`/`user-invocable`/`hooks`. **Used to be called "custom chat modes" (`.chatmode.md`)** — renamed to `.agent.md`; treat the old format as deprecated/transitional, not a stable alias                                                                                                                                                                                                                                | `.toml` file in `agents/` (`name`/`description`/`developer_instructions`/model/reasoning/sandbox/mcp/skills) — **structurally different from MD frontmatter**, not just renamed fields | not confirmed to exist standalone outside an extension — to verify, don't assume absent                                               |
  | `command`    | command file/dir                                                                                                                                                                               | project `.kilo/command/`, global `~/.config/kilo/command` (`plugin_manager.py` `MOVE_KINDS['command']`, 746-749); exact on-disk file format not verified in the same depth as skill/agent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | prompt files `*.prompt.md` in `.github/prompts/` (project, other locations via `chat.promptFilesLocations`); user-level path not specified in official pages. Optional frontmatter `description`/`name`/`argument-hint`/`agent`/`model`/`tools`. Invoked via `/prompt-name`, "Chat: Run Prompt" palette command, `${input:var}` variables, `#tool:<name>` tool refs                                                                                                                                                                                                                                                                                                                          | `prompts/*.md` with `$1..$9`/`$ARGUMENTS` placeholders — **deprecated**, OpenAI recommends migrating to `skill`                                                                        | `.toml` file in `commands/`; command name = path with `/`→`:` (e.g. `git/commit.toml` → `/git:commit`); `prompt`/`description` fields |
  | `mcp-server` | JSON entry in MCP config (also `.mcp.json` at workspace root)                                                                                                                                  | no dedicated MCP config file — an `mcp` field inside Kilo's generic config (`kilo.jsonc`/`kilo.json`/`opencode.json`, exact path ambiguous across those 3 names + project-root vs `.kilo`/`.kilocode`), written via a `config.overlay` CLI endpoint (`installer.ts:51-70,326-330`). Legacy `mcp.json` with an `mcpServers` key (same field name as Claude) still exists at `.kilo/mcp.json`/`.kilocode/mcp.json` (project) and `settings/mcp_settings.json` (global, extension storage) but only for removal/back-compat, not the primary write path (`actions.ts`'s `removeLegacyMcp()`, 238-272)                                                                                                                                                                                                               | **two layers**: `.vscode/mcp.json` (editor/workspace-level config, VSCode "forwards" it to the Agent Host) vs. harness-agnostic config read directly by the Agent Host — `.mcp.json` at workspace root (**same file as Claude Code**) + `~/.copilot/mcp-config.json` (user). `.vscode/mcp.json` schema: `{"servers":{...},"inputs":[...],"sandbox":{...}}`; stdio (`type`/`command`/`args`/`cwd`/`env`/`envFile`/`dev`/`sandboxEnabled`) or http/sse (`type`/`url`/`headers`/`oauth`)                                                                                                                                                                                                        | TOML entry `[mcp_servers.<id>]` in `config.toml` (stdio: command/args/env; http: url/bearer_token_env_var/auth)                                                                        | `mcpServers` key in `settings.json` (global or project; always wins over an mcp-server declared by an extension)                      |
  | `rule`       | `CLAUDE.md` (root, `.claude/CLAUDE.md`, or `~/.claude/CLAUDE.md`)                                                                                                                              | no single fixed file like `CLAUDE.md` — an `instructions` array inside `kilo.jsonc` referencing markdown paths/globs (project: typically `.kilo/rules/*.md`; global: `~/.config/kilo/kilo.jsonc`'s `instructions`), with explicit back-compat for legacy Roo/Kilocode formats (`.kilocoderules`, `.kilocode/rules/*.md`, etc). **`AGENTS.md`/`CLAUDE.md` at project root, and `~/.config/kilo/AGENTS.md` globally, are read natively without needing to be listed in `instructions`** — same convergence already noted for Copilot, so a `rule` written for Claude may need zero translation for Kilo too                                                                                                                                                                                                        | Two families: **always-on** `.github/copilot-instructions.md` — **and now also `AGENTS.md`/`CLAUDE.md`, read natively with the same auto-applied treatment** (direct convergence with Codex/Claude); **conditional** `*.instructions.md` in `.github/instructions/` (project) or `~/.copilot/instructions/`/`~/.claude/rules/` (user), frontmatter `name`/`description`/`applyTo` (glob; absent = manual attach; note: `.claude/rules/*.md` uses `paths` instead of `applyTo`)                                                                                                                                                                                                               | `AGENTS.md` at root, plain markdown with no frontmatter                                                                                                                                | `GEMINI.md`, hierarchical loading (global + project combine)                                                                          |
  | `hook`       | plugin-scoped `hooks/hooks.json`; for a normal project, presumably a `hooks` key in `.claude/settings.json`/`.claude/settings.local.json` (to confirm, not verified as thoroughly as the rest) | not verified, no data collected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **Ambiguity between official sources**: the overview page lists workspace paths `.github/hooks/*.json`, `.claude/settings.json`/`.claude/settings.local.json` (read natively!); user `~/.copilot/hooks`, `~/.claude/settings.json`; plugin-scoped `hooks.json`/`hooks/hooks.json`; agent-scoped via a `hooks` field in `.agent.md` — but the dedicated reference page didn't confirm the paths, only the schema (`type`/`command`/`windows`\|`linux`\|`osx`/`cwd`/`env`/`timeout`) and events (PreToolUse/PostToolUse/UserPromptSubmit/SessionStart/Stop/SubagentStart/SubagentStop/PreCompact — nearly identical to Claude Code). **Treat the paths as still to be reconfirmed**, not final | not verified, no data collected                                                                                                                                                        | not verified, no data collected                                                                                                       |

  "To verify in ..." or "not verified" cells must be closed by reading the
  local skills cited above (or the official sources directly) before
  writing the adapter; they must not be assumed by analogy. `task` and
  `profile` (Agent Hub taxonomy) have no match in any of the official
  VSCode pages read so far: treat them as Agent Hub-specific non-standard
  extensions, not native features to replicate.
- **Source** — the origin of a catalog or of a single item. Types:
  - `git-marketplace` (repo with a manifest). Two real, distinct native
    shapes to support, not one "Claude format + a Kilo equivalent to
    invent": Claude's `.claude-plugin/marketplace.json` (+ `skills/`/
    `agents/`/`commands/` per plugin), and Kilo's own official
    `marketplace-skills.json` feed — `{id, description, category,
    githubUrl, content}` where `content` is a tarball URL (`--mode
    tarball`) or a list of relative file paths (`--mode files`); consumed
    by Kilo's own "Kilo Marketplace" panel via `fetchMarketplaceData()`
    (`kilocode-dev`'s `services/marketplace/actions.ts`), generated by
    `Kilo-Org/kilo-marketplace`'s own toolchain
    (`bin/generate-skill-marketplace.ts`) or its community Python port
    `generate_skill_marketplace.py`. **Caveat**: `fetchMarketplaceData()`
    is confirmed working but, as of this writing, only in `kilocode-dev`
    builds — not yet in a released Kilo Code version; verify current
    status before assuming end users already have it.
  - `local-folder` (marketplace or single item on disk)
  - `remote-url` (single file/manifest via HTTP)
  - `git-single-item` (a repo that is itself a skill/agent/mcp, with no
    marketplace manifest)
  - **`git-custom` (new, high priority)** — a generic Git repo via
    HTTPS/SSH (GitHub/GitLab/Gitea/other, not just GitHub), with no
    conforming marketplace manifest: structure to infer (dir with
    `SKILL.md`, single-skill repo, multiple sibling dirs with `SKILL.md`),
    configurable branch/tag/commit pin, auth delegated to Git credentials
    already present on the machine. This is the motivating case for this
    spec (§0) and must be solved before the other types, not after.
- **Marketplace** — a local cache of the manifest resolved from a
  marketplace-type `Source`: name, owner, list of `Package`.
- **Package** — a distributable unit installed as a block (e.g. a Claude
  plugin, a Kilo bundle, an "Agent Pack"): id, version/ref, native
  provenance format, reference to the `Source`, list of contained
  `Artifact`. A `Source` can resolve to multiple `Package`; a single-skill
  repo is a degenerate `Package` with exactly one `Artifact`.
- **Artifact** (a rename/specialization of what we used to call
  `CatalogEntry`) — a single item available for installation inside a
  resolved `Package`: id, `ItemKind`, name, description, native format,
  reference to the parent `Package`. Reason for the 3-level distinction
  (`Source → Package → Artifact`) instead of a flat `CatalogEntry`: Claude
  installs composite plugins (several artifacts together), other
  ecosystems install single items — flattening both cases into the same
  concept loses the information of "what gets installed together".
- **Local state, 4 separate concepts (not a single `InstalledItem`)**:
  - **`ObservedArtifact`** — an item found on the filesystem/config during
    a scan (discovery), **not** necessarily managed by the extension.
  - **`ManagedInstallation`** — an item installed by the extension, which
    the extension "owns" (can update/remove autonomously):
    `(assistant, scope, projectPath?, kind, name)` → path on disk,
    provenance (`sourceId`, `packageId`, `artifactId`, installed version,
    hash/commit), timestamp.
  - **`DesiredManifest`** — dependencies a project wants to share with the
    team (versionable in git), distinct from what is *actually* installed
    at a given moment on a given machine.
  - **`LocalState`** — machine-specific path/hash/data, not versionable.

  **Safety principle to hold firm**: an `ObservedArtifact` discovered by
  hand **does not automatically become** a `ManagedInstallation` that the
  extension can overwrite or delete — promoting it from observed to
  managed is an explicit user action, never implicit in the discovery scan
  (§3.2).
- **`Source` registry (marketplace), also global + per-project**: a
  `Source` registers at the **global** level (personal, valid across every
  workspace — e.g. a developer's personal skill repo) or at the
  **project** level (shared with the team via git, e.g. the internal
  company catalog every collaborator on that repo must be able to resolve
  without any manual reconfiguration). Same schema, separate persistence,
  same as the Registry below — a project-level `Source` must not "leak"
  into other projects, a global one is visible everywhere.
- **Registry / Lockfile** — persistence of `ManagedInstallation` and
  configured `Source`. Two levels: global (a lockfile in
  `~/.ai-toolkit/registry.json`) and per-project
  (`.ai-toolkit/registry.json` inside the workspace, versionable in git if
  the team wants to share it).

A delicate point to hold firm in the design: **the provenance format is
orthogonal to the installation target**. An `Artifact` written in "Claude
plugin" format must be installable as a Kilo skill — this requires a
**translation** layer between formats (frontmatter fields, path
conventions, any tool/permission placeholders), not just a "download and
copy".

---

## 2. Feature Area A — Marketplace

1. **Source management** (CRUD): add/remove/list `Source`, independent of
   the assistant they were originally intended for. Supported types:
   `git-custom` (high priority, §0/§1), git-marketplace, local-folder,
   remote-url, git-single-item. Every `Source` registers at **global**
   scope (personal) or **project** scope (shared via git with the team,
   §1) — a project-level `Source` must not show up in other workspaces.
2. **Catalog refresh/sync**: for every `Source`, pull/fetch and rebuild the
   `Package`/`Artifact` list (with a diff against the previous cache to
   surface new/updated items). For `git-custom` this includes the
   **format detection** phase (§1): recognizing the structure without
   requiring the author to generate a manifest when it isn't ambiguous.
3. **Browse catalog**: a view filterable by kind, by originating assistant,
   by source; full-text search.
4. **Cross-assistant installation**, as an explicit pipeline (not an atomic
   "download and copy"):
   `resolve(artifact) → plan(targetAssistant, targetScope, projectPath?) →
   preview → apply → verify`.
   - **resolve**: fetches the `Artifact`'s actual content from the
     `Source`.
   - **plan**: resolves the translation adapter (source-format →
     target-format) and computes which files would be created/modified/
     removed, any conflicts, and the **conversion diagnostic** for each
     field: `lossless | adapted-with-warning | potentially-destructive |
     unsupported` — always shown, not only when there's loss.
   - **preview**: the user sees the plan before anything is written.
   - **apply**: atomic, recoverable write (backup or transaction), records
     the result as a `ManagedInstallation` in the relevant registry
     (global or project).
   - **verify**: confirms the written file is actually valid in the target
     format (not just that the write succeeded).
5. **Provenance and versioning**: every `ManagedInstallation` tracks
   `sourceId`/`packageId`/`artifactId`/ref/commit/version so drift can
   later be detected (§3.6).

## 3. Feature Area B — Management

1. **Per-environment summary**: a table/tree of all `ManagedInstallation`,
   groupable by assistant × scope × project. Must answer "what do I have
   installed where" at a glance.
2. **Initial discovery**: besides `ManagedInstallation`, a scan is needed
   that detects items already present on the filesystem (skill/agent/mcp
   created by hand, not going through the registry) and exposes them as
   **`ObservedArtifact`** — **not** automatically promoted to
   `ManagedInstallation` (safety principle, §1): promoting an item to
   "managed by the extension" is an explicit, per-item user action, with
   confirmation.
3. **Preview**: read-only rendering of the content (rendered markdown for
   skill/agent, structured view for mcp-server config).
4. **Edit via form**: a structured form for the schema's known fields
   (name, description, allowed tools, model, etc. for agent/skill;
   command/args/env for mcp-server) instead of raw file editing — with a
   fallback to a plain text editor for free-form body content.
5. **Copy/Sync across environments**: the same `resolve → plan → preview →
   apply → verify` pipeline as marketplace installation, but the
   source-side is a `ManagedInstallation` (or an `ObservedArtifact`
   promoted on the fly) instead of a remote `Artifact`. Must handle
   conflicts (item already existing at the destination:
   skip/overwrite/merge).
6. **Drift/update detection**: comparison between the installed version and
   the source's current version (if still resolvable), flagging "update
   available" or "modified locally relative to the source" — this latter
   case requires having saved a hash/snapshot at `apply` time to be able
   to compare.

---

## 4. Extension architecture (high level)

- **Per-assistant adapter** (a single interface, one implementation per
  `claude-code`, `kilo-code`, `github-copilot`, `codex-cli`, `gemini-cli`,
  ...): path/location resolution (global/project, with precedence when
  several locations are valid for the same kind — see §1 table),
  parse/serialize skill/agent/rule (frontmatter or TOML depending on the
  assistant), read/write mcp-server config (JSON or TOML depending on the
  assistant), list already-present items (used both by the adapter itself
  and by discovery, §3.2).
- **Canonical model per kind**: every Adapter reads the native format and
  normalizes it into a shared canonical model (one per `ItemKind`) instead
  of translating directly format-to-format for every pair of assistants.
  The translator therefore works canonical→canonical instead of N×N
  pairwise, and **preserves unrecognized/unmapped fields** instead of
  silently dropping them on a round trip (it serializes them back even if
  it doesn't use them, but never loses them).
- **Format translation adapter**: given an item in canonical format,
  produces the equivalent in the target format, with the explicit
  conversion diagnostic (§2) for every field that isn't directly mappable.
- **Source resolver** per type (`git-custom`, `git-marketplace`,
  `local-folder`, `remote-url`, `git-single-item`): normalizes everything
  into `Package[]`/`Artifact[]`.
- **Registry store**: two instances (global, project), same schema —
  contains configured `ManagedInstallation` and `Source`, **not**
  `ObservedArtifact` (those stay in a separate cache until promoted).
- **VSCode UI**:
  - Tree view in the Activity Bar: Marketplaces (configured sources →
    entries) + Installed (grouped by assistant/scope).
  - "Dashboard" webview: table of installed items, filters, bulk actions.
  - "Form editor" webview: create/edit a single item.
  - Command palette: add source, refresh, install, sync, uninstall.
- **File watchers**: on each assistant's known directories (global and
  project), to keep the registry consistent if the user edits files by
  hand outside the extension.

---

## 5. Risks / open questions (to close before or during implementation)

- **[High priority] Re-scoping the value prop, but only toward two specific
  native features — not toward the whole Agent Host**: this spec manages
  **the files inside config folders** (skill/agent/mcp-server/rule/hook),
  not session execution — whoever later reads them at runtime (a
  standalone CLI, or VSCode's "Agent Host", which literally runs the
  Claude Agent SDK/OpenAI Codex reading `~/.claude`/`~/.copilot` as
  "harness-agnostic" folders, `docs/agents/concepts/agent-host`) is
  irrelevant to our scope — if anything, being harness-agnostic makes
  those folders *more* canonical, not less worth curating well. The two
  VSCode features that actually compete with the extension are different
  and more targeted: (1) **Agent Plugins**, the native marketplace that
  installs into those folders for Claude/Copilot (direct competition with
  Area A for that pair); (2) the Agents Window → **"Customizations"**
  panel, which lists/manages Agents/Skills/Instructions/Hooks/MCP/Plugins
  (potential competition with Area B — depth, whether it's just a
  list/toggle or real editing, not yet verified, see the note at the start
  of the document). Kilo Code and Gemini CLI remain the two targets fully
  uncovered by both (they're neither a supported harness nor covered by
  Agent Plugins), but they're not the only ones of value: Area B on
  Claude/Copilot/Codex retains value wherever the "Customizations" panel
  doesn't reach (depth to verify before writing off that work).
- **Agent Plugins as a possible canonical intermediate format**: since
  Agent Plugins 1.0 already treats `skill` and `mcp-server` as portable,
  cross-client types (consistent with what's been verified: `SKILL.md` is
  identical across Claude/Codex/Gemini/Copilot-via-Agent-Plugins), evaluate
  whether the Format translator should use this standard as a hub for
  these two kinds instead of N×N point-to-point — it reduces the
  combinations to map, but it must be validated that the standard is
  stable and not just newly introduced.
- ~~Exact format of the Kilo marketplace~~ — **resolved**: Kilo has its
  own native marketplace, format and mechanism genuinely distinct from
  Claude's (see the `git-marketplace` Source entry in §1) — not something
  to invent. What it lacks is a way to consume a Claude-shaped git repo
  *directly*, without first generating its own feed; that gap is what
  `kilo-plugin-manager` fills for the marketplace ↔ Claude bridge case.
- ~~Exact Kilo frontmatter schema for agent/skill vs. Claude~~ —
  **resolved for `skill`** (same as Claude, `name`/`description` only, see
  §1 table); **resolved for `agent`**: structurally different
  (`mode`/`permission` vs Claude's `tools:`), mapping tables identified
  (`TOOL_PERMISSION_MAP`/`PERMISSION_TOOL_MAP` in `plugin_manager.py`,
  §1 table) — but see the new unresolved path-discrepancy risk below
  before writing the adapter.
- **New: unresolved `.kilo/agent/` vs `.kilo/agents/` path discrepancy**
  — `kilo-plugin-manager` and `kilocode-dev` disagree on the project path
  (singular vs plural) and partially on the global one too (§1 `agent`
  row has the exact citations). Must be settled by testing against a real
  Kilo install, not by picking one source over the other — this blocks
  writing the Kilo `agent` adapter in Phase 1/2.
- MCP servers are JSON config (not "installable" files in the classic
  sense) — installing this kind means merging a block into an existing
  config file (`.mcp.json`, `claude_desktop_config.json`, the Kilo
  equivalent): needs careful merge/conflict handling on a file shared with
  other entries.
- Additional targets beyond the 5 already scoped (Cursor, Cline/Roo) aren't
  covered yet: the adapter-based architecture should make them addable
  without touching the core, and the fifth real adapter (Gemini CLI) is
  already a good genericity validation.
- Bidirectional sync with feature loss (e.g. a field exists in Claude but
  not in Kilo): needs an explicit policy (a visible warning, not a silent
  drop). This becomes more relevant with 5 targets: Codex's `agent` (TOML
  with its own `sandbox`/`reasoning`/`model`) has no 1:1 equivalent in any
  of the other 4 — it will almost always be a lossy translation, not the
  exception.
- **`command` on Codex CLI is deprecated** (OpenAI recommends skills
  instead): the translator must still be able to read it for
  import/discovery from existing installations, but must never offer it as
  an install target when writing.
- ~~Recurring "bundle/pack" concept, not yet modeled~~ — **resolved**:
  this is exactly the role of `Package` in the revised domain model (§1) —
  Agent Hub's "Agent Pack" and Gemini's "Extension" are both instances of
  `Package` with several `Artifact` of different kinds installed together.
  No extra concept needed.
- ~~MCP-server on GitHub Copilot: verify whether it exposes its own
  `mcp.json`~~ — **resolved, with an added nuance**: there are two
  distinct layers, not one. `.vscode/mcp.json` is the editor/workspace-level
  config that VSCode "forwards" to the Agent Host; the Agent Host itself
  instead reads harness-agnostic `.mcp.json` at the workspace root (**the
  same file as Claude Code**) + `~/.copilot/mcp-config.json` (user). The
  Copilot adapter (Phase 2, §6) must write/read both layers, not just
  `.vscode/mcp.json`.
- **`Tool set` (`.jsonc`, referenced with `#name`) confirmed out of
  scope**: it's a local alias/grouping of existing tools (built-in/MCP/
  extension), not an artifact installable from a marketplace — it should
  not be added as an ItemKind, confirming what was already suspected for
  "Tools" in the customization taxonomy.
- **Third scope tier, "Organization"**: the `agent-customization/
  customization` concept page explicitly mentions it ("centrally managed
  and shared across repositories, where supported") alongside User/
  Workspace. The current domain model only has `global|project` — not
  urgent for v1, but worth keeping in mind if enterprise/team-wide policy
  support is needed later (not specified which kinds support it today).
- **`agent` on Gemini CLI**: no solid confirmation of a standalone format
  outside an extension bundle — verify directly on the
  `google-gemini/gemini-cli` repo before excluding it from the adapter, not
  assumed absent by analogy with the others.
- **`hook` — paths still ambiguous even though the kind is confirmed**:
  two official VSCode pages contradict each other on the exact paths (one
  lists `.github/hooks/*.json`/`.claude/settings.json`/`~/.copilot/hooks`,
  the other — the dedicated reference — states it doesn't specify paths
  and only gives the schema). Same doubt for standalone Claude Code
  (outside the plugin context) and for Kilo Code (no data collected). Must
  be closed with direct verification (a test install in VSCode Insiders,
  or reading the Copilot extension's code) before writing the Claude
  (Phase 1) or Copilot (Phase 2) adapter.
- **`rule` convergence to exploit, not just a risk**: Copilot now natively
  reads `AGENTS.md` and `CLAUDE.md` with the same always-on treatment as
  its own instructions. For the `rule` kind, installing/syncing to Copilot
  from a Claude or Codex source can therefore require **zero
  translation** — the file just needs to exist at the right path and
  Copilot picks it up on its own. Needs to be verified whether this also
  holds in reverse (Copilot→Claude/Codex) or is a Copilot-side one-way
  read only, but it's a concrete case where the Format translator can skip
  conversion entirely for one assistant×kind combination.
- **Pre-flight validation before install/sync**: `cc-swiss-knife` has
  per-kind scripts `validate-skill.sh`/`validate-command.sh`/
  `validate-agent.sh`/`validate-hook-schema.sh` (manual, pre-PR, not an
  automated gate) that check frontmatter, required fields, name format,
  allowed tools, broken file references. Worth evaluating for the Install
  engine (Phase 1) and the Sync engine (Phase 3): an explicit validation
  step before writing to disk, not just format translation — not currently
  planned in the spec.

---

## 6. Phased roadmap

Not a single flat list: the breadth (5 assistants, 6 kinds, full Area A+B)
remains the spec's scope, but implementation proceeds in phases — generic
engine first, widening incrementally. The task-by-task breakdown, detailed
enough for direct delegation to an Executor, lives in the `tasks/`
(macroplan) pipeline tied to this spec, not here — this section is the map
of phases and their dependencies.

- **Phase 0 — Verify real formats (blocks everything else)**: close the
  "to verify in ..." cells of the §1 table by reading `kilo-plugin-manager`
  in full (including `sync-agents`) and `kilocode-dev` (in particular the
  marketplace service's `actions.ts`, which today normalizes only skills,
  only remote GitHub, a fixed `main` branch, a `marketplace-skills.json`
  feed, with no per-item versioning). Derive real fixtures/golden tests
  from this, not invented ones. **Don't freeze the domain types (§1) as
  final interfaces until this phase is closed** — the concept names can
  stay fixed, the field details can't.
- **Phase 1 — Generic engine + first 2 assistants, skill-first**: a
  complete but deliberately narrow vertical slice — a single `ItemKind`
  (`skill`), two `Assistant` (Claude Code, Kilo Code — the two where
  custom-repo pain is most concrete today, not the two least covered
  natively by VSCode: these are different selection axes, see §5), a
  single new `Source` type (`git-custom`, generic HTTPS/SSH, not just
  GitHub). Includes: minimal domain types, registry store, Claude+Kilo
  adapters for `skill`+`rule`, `git-custom`+`local-folder` source
  resolvers, canonical model and translator for `skill`, install engine
  with the resolve→plan→preview→apply→verify pipeline and conversion
  diagnostics, minimal UI with 3 views (Sources/Available/Installed, no
  dashboard/form editor yet). Phase goal: a user can register a private
  Git repo with scattered, manifest-less skills and install them onto
  Claude Code or Kilo Code, with preview and tracked provenance.
- **Phase 2 — Expand kinds and assistants**: widen horizontally what
  Phase 1 validated vertically.
  - Kinds: `agent`, `mcp-server`, `hook`, `command` for Claude+Kilo (in
    this likely value/risk order — `mcp-server` requires handling
    merge/conflicts on a shared config file, §5).
  - Assistants: GitHub Copilot, Codex CLI, Gemini CLI adapters — **but
    before investing here, re-verify the actual depth of the Agent
    Plugins/Customizations panel** (§5, high priority): if they already
    cover Claude↔Copilot well, that specific adapter's marginal value may
    be lower than it looks on paper, and the order among the 3 should be
    decided accordingly instead of arbitrarily.
  - `git-marketplace`/`remote-url`/`git-single-item` as additional Source
    types beyond `git-custom`.
- **Phase 3 — Advanced management**: full drift/update detection
  (including "modified locally"), dashboard webview with filters/bulk
  actions, structured form editor, bidirectional sync with
  skip/overwrite/merge conflict handling, file watcher for
  registry↔filesystem consistency, discovery→promotion of
  `ObservedArtifact`→`ManagedInstallation` with a dedicated UI (not just a
  silent scan).

Dependency order: Phase 0 blocks Phase 1; Phase 1 blocks Phase 2 and Phase
3 (both start from the validated engine, but are independent of each other
and delegable in parallel once Phase 1 is closed).
