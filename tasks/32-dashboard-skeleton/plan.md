# 32 — Dashboard: structural skeleton — Implementation plan

> **Derived from spec:** [`../specs/phase-9-spec.md`](../specs/phase-9-spec.md) §3.3, §3.4, §5

**Depends on:** 28 (merged), 29 (Phase 8 — **fully merged 2026-09-08**,
confirmed on `main` at commit `80a9bd8`, including 29.4's registry-driven
provider/view registration in `activate()` that task 32.1 also edits).

Tasks (each = one commit):

1. **[32.1 — Provider wiring](32.1-provider-wiring.md)**: `DashboardPanel` gains `SourcesTreeDataProvider`/`AvailableTreeDataProvider` + a cross-refresh callback; `extension.ts` call sites updated.
2. **[32.2 — Section navigation shell + New Artifact entry point](32.2-section-shell.md)**: top-level section tabs (Overview/Installed/Sources & Catalog/Recommendations), `getHtml()` split into per-section template functions, existing Installed content ported into the shell unchanged.
3. **[32.3 — Incremental update model](32.3-incremental-updates.md)**: replace full `webview.html` reassignment on refresh/filter with shell-once + `postMessage`-driven data updates.

**Task order and gating:**

- **32.1 has no dependency on 32.2/32.3** (pure constructor/wiring change) — can be dispatched first or in parallel.
- **32.2 depends on 32.1** (the shell needs the new providers in scope even if unused until Initiative 33/34).
- **32.3 depends on 32.2** (there must be sections/mount-points before deciding what gets updated incrementally vs. re-rendered).
- This whole initiative, together with Initiative 31, gates Initiative 33 and 34.

**Delegation note:** expanded packaging (per `tasks/AGENTS.md`), one task
file per hand-off. Point the agent at the one task file + `specs/phase-9-spec.md`
(§3.3, §3.4, §5) + `tasks/CONTEXT.md`.
