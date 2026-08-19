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

## Initiatives

`#` is the stable id (folder/task prefix); it is NOT reading order —
`Priority` is.

| Priority | #   | Initiative                                                                | Status                          | Depends on           | Size |
| -------- | --- | ------------------------------------------------------------------------- | ------------------------------- | -------------------- | ---- |
| 1        | 01  | [Project scaffold](01-project-scaffold/plan.md)                           | ✅ done                         | —                    | S    |
| 2        | 02  | [Domain types + registry store](02-domain-and-registry/plan.md)           | ✅ done (02.3 hardening merged) | 01                   | S    |
| 3        | 03  | [Claude + Kilo adapters (skill+rule)](03-claude-kilo-adapters/plan.md)    | ✅ done (03.4 hardening merged) | 02                   | M    |
| 4        | 04  | [Source resolver (git-custom + local-folder)](04-source-resolver/plan.md) | ✅ done (04.3 hardening merged) | 02                   | M    |
| 5        | 05  | [Canonical model + translator (skill)](05-translator-skill/plan.md)       | ✅ done (05.2 hardening merged) | 03.4                 | M    |
| 6        | 06  | [Install engine (pipeline)](06-install-engine/plan.md)                    | ✅ done (06.1/06.2 merged)      | 05, 02.3, 03.4, 04.3 | M    |
| 7        | 07  | [Minimal UI (3 views)](07-minimal-ui/plan.md)                             | ✅ done (07.1/07.2/07.3 merged) | 06                   | M    |
| 8        | 08  | [Agent artifact support](08-agent-support/plan.md)                        | ✅ done                         | 07                   | M    |
| 9        | 09  | [Command artifact support](09-command-support/plan.md)                    | ✅ done                         | 08                   | M    |
| 10       | 10  | [MCP-server artifact support](10-mcp-support/plan.md)                     | ✅ done                         | 08                   | L    |
| 11       | 11  | [Marketplace sources resolver](11-marketplace-sources/plan.md)            | ✅ done                         | 08, 09, 10           | M    |
| 12       | 12  | [GitHub Copilot adapter](12-copilot-adapter/plan.md)                      | ✅ done                         | 08, 09, 10           | M    |
| 13       | 13  | [Drift & update detection](13-drift-and-updates/plan.md)                  | ✅ done                         | 12                   | M    |
| 14       | 14  | [Discovery & promotion](14-discovery-promotion/plan.md)                   | ✅ done                         | 13                   | M    |
| 15       | 15  | [File watchers for consistency](15-file-watchers/plan.md)                 | ✅ done                         | 13                   | S    |
| 16       | 16  | [Management dashboard webview](16-dashboard-webview/plan.md)              | ✅ done                         | 13, 14, 15           | L    |

## Specs

| Spec                                        | Drives                         |
| ------------------------------------------- | ------------------------------ |
| [foundations](specs/foundations.md)         | 01, 02, 03, 04, 05, 06, 07     |
| [phase-2-spec](specs/phase-2-spec.md)       | 08, 09, 10, 11, 12             |
| [phase-3-spec](specs/phase-3-spec.md)       | 13, 14, 15, 16                 |

## Dependency graph

```text
Phase 1 & 2:
01 ──► 02 ──► 03 ──► 04 ──► 05 ──► 06 ──► 07 ──► 08 ──► 09 ──► 10 ──► 11 ──► 12

Phase 3:
12 ──► 13 (Drift & Updates) ──┬──► 14 (Discovery & Promotion) ──┬──► 16 (Dashboard Webview)
                              └──► 15 (File Watchers) ──────────┘
```

---

Delegation rules, the pipeline, and the folder convention live in
[`AGENTS.md`](AGENTS.md).
