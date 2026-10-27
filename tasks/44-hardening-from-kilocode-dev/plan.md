# 44 — Hardening and fixes found by cross-checking kilocode-dev — Implementation plan

> Source: owner request 2026-10-08 (`_inbox/analyzed/2026-10-08-kilocode-dev-crosscheck-request.md`). Reviewed in `kilocode-dev`: `docs/specs/{STATUS_HANDOVER,multi-repo-marketplace,multi-repo-marketplace-analysis}.md`, the commits `98010925a9` (multi-repo marketplace), `f40deeba8d` / `e1df19cf62` (permissive YAML fallback), `f86381d32a` (config schema), the real Kilo source (`packages/opencode/src/kilocode/config/overlay.ts`, `mcp-migrator.ts`) and `.kilo/plans/`. Every finding below was **re-verified in ai-swissknife's own code**; nothing is carried over on trust.
> Inline plan, tasks expanded because they are delegated.

**Depends on:** 36.1 (merged: `validateLocation`, reused by 44.1). Independent of the other open initiatives.

## Findings, validated here

| # | Idea from kilocode-dev | Verdict in ai-swissknife | Evidence |
| --- | --- | --- | --- |
| F1 | Marketplace engine hardening (analysis §2.8): traversal in the clone target, bare `url` to `git clone`, no transport allow-list | **Applies, not fixed.** | `runGit(['clone', source.url!, targetDir])` with no `--` and no URL validation at resolve time (`gitCustom.ts:104`, `gitSingleItem.ts:57`); `git checkout <ref>` with user ref unguarded (`gitCustom.ts:110-116`); target dir uses `source.id.replace(/[^a-zA-Z0-9._-]/g,'_')` so ids `.` and `..` survive (`gitCustom.ts:89-91`) and the code then `rm -rf`s the target when it has no `.git` (`:96-98`): id `..` wipes `~/.ai-swissknife/cache`. The project manifest travels with `git clone` (initiative 22) and `refreshCatalog()` runs automatically (`extension.ts:~166`), so these values are attacker-influenced in a freshly cloned repo. Exploitability of the option injection was **not demonstrated** (a lone injected option has no repository operand), so this is hardening of an untrusted-input path, not a proven RCE. |
| F2 | (none in kilocode-dev; follows from F1) Workspace Trust | **Unhandled.** | No `isTrusted`, no `capabilities.untrustedWorkspaces` anywhere in `src/` or `package.json`. Whether VS Code runs the extension at all in Restricted Mode when nothing is declared could not be confirmed from the local docs mirror: spike. |
| F3 | MCP install wrote to a phantom file Kilo does not read (analysis §2.9: `kilo.json` vs real `kilo.jsonc`, plain `JSON.parse` failing on comments) | **Probable same class of bug, needs an empirical check.** | Our Kilo adapter reads/writes `~/.config/kilo/mcp.json` and `<project>/.kilo/mcp.json` (`adapters/kilo.ts:480,486`) with `JSON.parse`/`JSON.stringify`. Real Kilo's config targets are `kilo.jsonc → kilo.json → opencode.jsonc → opencode.json` under `.kilo`/`.kilocode` or the global config dir (`overlay.ts:84,140-153`), MCP lives in the `mcp` field (`core/src/v1/config/config.ts:230`); `mcp.json` is only read by the legacy migrator (`mcp-migrator.ts:110-115`) and `removeLegacyMcp()`. Our own `SPEC.md` row for Kilo MCP says exactly this ("legacy ... only for removal/back-compat, not the primary write path"), so the adapter contradicts the spec it was built from. |
| F4 | Permissive YAML fallback for frontmatter with unquoted colons (`f40deeba8d`) | **Colons are fine, but a related bug exists.** | Our parser is line-based, not YAML (`sources/detect.ts:16-60`): `description: Use when: a: b` parses correctly (tested). But block scalars break: `description: >` followed by indented lines returns the literal `">"` as the description (tested on `out/sources/detect.js`). Agents/commands use a separate codec (`adapters/codec.ts`), not checked here. |
| F5 | Writing a merged project+global view back into one scope (analysis §2.7) | **Not present.** | All `writeManifest`/`writeState` call sites read the same scope they write (`sourcesView.ts:270,317`, `recommendations.ts` always `project`, `configTransfer.ts:108`). No task needed; keep it as a review rule for 36.3 ("Both" writes per scope from per-scope reads). |
| F6 | Dual-scope badge `INSTALLED (PROJECT + GLOBAL)`, per-scope filter | **Already covered** by the collapsible tree with scope-icon chips (initiative 40) and the Scope pill filter (40.5). Validates the direction. |
| F7 | Loading indicator while discovery is in flight (`.kilo/plans/agent-behaviour-skills-tab-loading-indicator.md`) | **Partly covered**: Dashboard shell loader (35.1) exists; the sidebar Sources tree has none while sources resolve sequentially (a hung SSH source blocks the rest, see 38). Folded into 44.5 as a small item. |
| F8 | Per-item version for "update available" (analysis §4.3) | **Not applicable**: ai-swissknife compares source commits/hashes (`drift.ts`), not semver. |
| F9 | Claude marketplace adapter layer, `<plugin>@<marketplace>` qualified names, `files` (flat-list) install shape | **Not applicable / already done** (`git-marketplace`, translator, git clone based). |
| F10 | `.gitignore` swallowing `docs/specs` and `bun.lock` (analysis §2, item 10) | Checked: ai-swissknife's `.gitignore` ignores only `node_modules/`, `out/`, `dist/`, `*.vsix`, `.DS_Store`: **fine**. |
| F11 | "Typecheck passes does not mean the feature works" (analysis intro) | Process lesson: our verification rule already requires manual/behavioural checks in every task; 44.3 applies it to the MCP adapter (verify with the real tool, not only unit tests). |

## Locked-in decisions

- 44.1 and 44.3 are the priority (security hygiene and a probable silent-failure bug); 44.2 gates on a spike; 44.4 and 44.5 are small.
- No new runtime dependency without saying so: 44.3 needs a JSONC-aware parser (`jsonc-parser`, the one Kilo uses); that is the single permitted new dependency in this initiative and must be stated in its commit message.

## Tasks

### 44.2 - Workspace Trust: spike, then declare `limited` and skip project sources when untrusted

- **Status:** `open` · **Short:** Workspace Trust gating · **Size:** S · **Priority:** P2 · **Depends on:** - · **Spec:** [44.2-workspace-trust.md](44.2-workspace-trust.md)
- **Goal:** Verify Restricted Mode behaviour, declare `capabilities.untrustedWorkspaces`, and skip project-scope source resolution and installs when the workspace is untrusted.

## Closed

### 44.1 - Harden git source resolution (url/ref/id validation, `--`, protocol allow-list, safe cache dir)

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Harden git source resolution · **Size:** M · **Priority:** P1 · **Depends on:** 36.1 · **Spec:** [44.1-git-source-hardening.md](44.1-git-source-hardening.md)
- **Goal:** Validate git URLs, refs, and cache directory IDs at resolve time, pass `--` separators to `git clone`/`checkout`, and restrict `GIT_ALLOW_PROTOCOL`.

### 44.3 - Kilo MCP config: verify the real target with Kilo, then write to the real `mcp` field (JSONC-safe)

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Kilo MCP JSONC config path · **Size:** M · **Priority:** P1 · **Depends on:** - · **Spec:** [44.3-kilo-mcp-config-path.md](44.3-kilo-mcp-config-path.md)
- **Goal:** Write Kilo MCP servers to the real `kilo.jsonc`/`kilo.json`/`opencode.jsonc` `mcp` field in Kilo's `local`/`remote` shape using `jsonc-parser` while keeping legacy `mcp.json` readable/removable.

### 44.4 - Frontmatter block scalars (`>`, `|`) and multi-line values

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Frontmatter block scalars · **Size:** S · **Priority:** P2 · **Depends on:** - · **Spec:** [44.4-frontmatter-block-scalars.md](44.4-frontmatter-block-scalars.md)
- **Goal:** Extend line-based frontmatter parsing in `src/sources/detect.ts` and `src/adapters/codec.ts` to support YAML folded (`>`) and literal (`|`) block scalars and multi-line continuations.

### 44.5 - Sidebar: per-source loading state while sources resolve

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Sidebar per-source loading state · **Size:** S · **Priority:** P3 · **Depends on:** 38.1 · **Spec:** [44.5-sidebar-source-loading.md](44.5-sidebar-source-loading.md)
- **Goal:** Show a spinner icon and `"Refreshing..."` description on each sidebar source item while its catalog group is resolving, rendering finished sources progressively.

### 44.6 - Kilo config edits keep neighbours and their comments untouched (follow-up of 44.3)

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Preserve Kilo JSONC neighbours · **Size:** S · **Priority:** P3 · **Depends on:** 44.3 · **Spec:** [44.6-kilo-jsonc-preserve-neighbors.md](44.6-kilo-jsonc-preserve-neighbors.md)
- **Goal:** Make Kilo JSONC MCP edits minimal so sibling entries are never reformatted and their trailing comments are never displaced.
