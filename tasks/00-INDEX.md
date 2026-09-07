# Task Index

Live registry of planned and in-progress development. For how this
directory works see [`AGENTS.md`](AGENTS.md); for shared project facts see
[`CONTEXT.md`](CONTEXT.md). This file is the state: what exists, priority,
status.

**2026-08-18/19 — Phase 1 completed**:
Hardening tasks 02.3, 03.4, 04.3, 05.2 and initiatives 06 (Install Engine) and 07 (Minimal UI)
have been implemented across isolated worktrees, strictly validated against all hardening contracts,
and merged into `main`. Full test suite passes 71/71 tests.

**2026-08-19 — Phase 2 opened**:
Phase 2 widens the platform to support additional artifact kinds (`agent`, `command`, `mcp-server`),
additional source types (`git-marketplace`, `remote-url`, `git-single-item`), and additional
target adapters (GitHub Copilot). See [`specs/phase-2-spec.md`](specs/phase-2-spec.md).

**2026-08-19 — Phase 4 planned**:
Initiatives 17-21 close the remaining gap against `SPEC.md`'s full scope: Form Editor Webview,
Cross-Assistant Sync, `hook` kind + active `rule` merge, `remote-url`/`git-single-item` sources,
and Codex CLI/Gemini CLI adapters. All five are specced and broken into tasks but not yet started —
see [`specs/phase-4-spec.md`](specs/phase-4-spec.md). Note: 19.1 (hook path verification) and 21.1
(Gemini agent verification) are mandatory research spikes that gate the adapter code in their own
initiatives — do not skip straight to implementation there.

**2026-09-07 — Phase 5 opened**:
Initiative 22 gives the already-existing but dead `desiredInstallations` field a real purpose:
project-scoped recommended installations modeled on VS Code's own workspace extension
recommendations (`.vscode/extensions.json`) — a curator marks artifacts as recommended, the
recommendation travels with `git clone` inside the existing shared manifest, and opening the
workspace offers to install what's missing. See [`specs/project-recommendations.md`](specs/project-recommendations.md).
Task 22.2 (resolution engine) gates 22.3 and 22.4 — do not start either until it lands.

## Initiatives

`#` is the stable id (folder/task prefix); it is NOT reading order —
`Priority` is.

| Priority | #   | Initiative                                                                                | Status                         | Depends on             | Size |
| -------- | --- | ----------------------------------------------------------------------------------------- | ------------------------------ | ---------------------- | ---- |
| 1        | 01  | [Project scaffold](01-project-scaffold/plan.md)                                           | ✅ done                         | —                      | S    |
| 2        | 02  | [Domain types + registry store](02-domain-and-registry/plan.md)                           | ✅ done (02.3 hardening merged) | 01                     | S    |
| 3        | 03  | [Claude + Kilo adapters (skill+rule)](03-claude-kilo-adapters/plan.md)                    | ✅ done (03.4 hardening merged) | 02                     | M    |
| 4        | 04  | [Source resolver (git-custom + local-folder)](04-source-resolver/plan.md)                 | ✅ done (04.3 hardening merged) | 02                     | M    |
| 5        | 05  | [Canonical model + translator (skill)](05-translator-skill/plan.md)                       | ✅ done (05.2 hardening merged) | 03.4                   | M    |
| 6        | 06  | [Install engine (pipeline)](06-install-engine/plan.md)                                    | ✅ done (06.1/06.2 merged)      | 05, 02.3, 03.4, 04.3   | M    |
| 7        | 07  | [Minimal UI (3 views)](07-minimal-ui/plan.md)                                             | ✅ done (07.1/07.2/07.3 merged) | 06                     | M    |
| 8        | 08  | [Agent artifact support](08-agent-support/plan.md)                                        | ✅ done                         | 07                     | M    |
| 9        | 09  | [Command artifact support](09-command-support/plan.md)                                    | ✅ done                         | 08                     | M    |
| 10       | 10  | [MCP-server artifact support](10-mcp-support/plan.md)                                     | ✅ done                         | 08                     | L    |
| 11       | 11  | [Marketplace sources resolver](11-marketplace-sources/plan.md)                            | ✅ done                         | 08, 09, 10             | M    |
| 12       | 12  | [GitHub Copilot adapter](12-copilot-adapter/plan.md)                                      | ✅ done                         | 08, 09, 10             | M    |
| 13       | 13  | [Drift & update detection](13-drift-and-updates/plan.md)                                  | ✅ done                         | 12                     | M    |
| 14       | 14  | [Discovery & promotion](14-discovery-promotion/plan.md)                                   | ✅ done                         | 13                     | M    |
| 15       | 15  | [File watchers for consistency](15-file-watchers/plan.md)                                 | ✅ done                         | 13                     | S    |
| 16       | 16  | [Management dashboard webview](16-dashboard-webview/plan.md)                              | ✅ done                         | 13, 14, 15             | L    |
| 17       | 17  | [Form editor webview](17-form-editor/plan.md)                                             | ✅ done                         | 08, 09, 10, 16         | M    |
| 18       | 18  | [Cross-assistant sync](18-cross-assistant-sync/plan.md)                                   | ✅ done                         | 06, 13, 14, 16         | M    |
| 19       | 19  | [`hook` kind + active `rule` merge](19-hook-and-rule-merge/plan.md)                       | ✅ done                         | 03, 06, 12             | L    |
| 20       | 20  | [`remote-url` & `git-single-item` sources](20-remote-url-and-single-item-sources/plan.md) | ✅ done                         | 04, 11                 | M    |
| 21       | 21  | [Codex CLI & Gemini CLI adapters](21-codex-gemini-adapters/plan.md)                       | ✅ done                         | 03, 05, 08, 09, 10, 12 | L    |
| 22       | 22  | [Project-scoped recommended installations](22-project-recommendations/plan.md)           | 📝 specced, not started         | 02, 06, 07             | M    |

## Specs

| Spec                                                         | Drives                     |
| ------------------------------------------------------------ | -------------------------- |
| [foundations](specs/foundations.md)                          | 01, 02, 03, 04, 05, 06, 07 |
| [phase-2-spec](specs/phase-2-spec.md)                        | 08, 09, 10, 11, 12         |
| [phase-3-spec](specs/phase-3-spec.md)                        | 13, 14, 15, 16             |
| [phase-4-spec](specs/phase-4-spec.md)                        | 17, 18, 19, 20, 21         |
| [project-recommendations](specs/project-recommendations.md)  | 22                         |

## Dependency graph

```text
Phase 1 & 2:
01 ──► 02 ──► 03 ──► 04 ──► 05 ──► 06 ──► 07 ──► 08 ──► 09 ──► 10 ──► 11 ──► 12

Phase 3:
12 ──► 13 (Drift & Updates) ──┬──► 14 (Discovery & Promotion) ──┬──► 16 (Dashboard Webview)
                              └──► 15 (File Watchers) ──────────┘

Phase 4 (independent of each other beyond shared Phase 1-3 prerequisites):
16 ────────────────────► 17 (Form Editor)
06, 13, 14 ─────────────► 18 (Cross-Assistant Sync)
03, 06, 12 ─────────────► 19 (hook + rule merge)
04, 11 ─────────────────► 20 (remote-url + git-single-item)
03, 05, 08, 09, 10, 12 ─► 21 (Codex + Gemini adapters)
```

---

Delegation rules, the pipeline, and the folder convention live in
[`AGENTS.md`](AGENTS.md).
