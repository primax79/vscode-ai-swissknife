# 32 — Dashboard: structural skeleton — Implementation plan

> **Derived from spec:** [`../specs/phase-9-spec.md`](../../specs/phase-9-spec.md) §3.3, §3.4, §5

**Depends on:** 28 (merged), 29 (Phase 8 — **fully merged 2026-09-08**,
confirmed on `main` at commit `80a9bd8`, including 29.4's registry-driven
provider/view registration in `activate()` that task 32.1 also edits).

Tasks (each = one commit):

## Tasks

## Task order and gating

- **32.1 has no dependency on 32.2/32.3** (pure constructor/wiring change) — can be dispatched first or in parallel.
- **32.2 depends on 32.1** (the shell needs the new providers in scope even if unused until Initiative 33/34).
- **32.3 depends on 32.2** (there must be sections/mount-points before deciding what gets updated incrementally vs. re-rendered).
- This whole initiative, together with Initiative 31, gates Initiative 33 and 34.

**Delegation note:** expanded packaging (per `tasks/AGENTS.md`), one task
file per hand-off. Point the agent at the one task file + `specs/phase-9-spec.md`
(§3.3, §3.4, §5) + `tasks/CONTEXT.md`.

## Closed

### 32.1 - Provider wiring

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Dashboard provider wiring · **Size:** S · **Depends on:** 28, 29 · **Spec:** [32.1-provider-wiring.md](32.1-provider-wiring.md)
- **Goal:** Pass `SourcesTreeDataProvider`, `AvailableTreeDataProvider`, and a cross-refresh callback into `DashboardPanel` and update `extension.ts` call sites.

### 32.2 - Section navigation shell + New Artifact entry point

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Dashboard section shell · **Size:** M · **Depends on:** 32.1 · **Spec:** [32.2-section-shell.md](32.2-section-shell.md)
- **Goal:** Add top-level section tabs (Overview, Installed, Sources & Catalog, Recommendations) and `+ New Artifact` entry point, splitting `getHtml()` into per-section templates.

### 32.3 - Incremental update model

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Incremental dashboard updates · **Size:** M · **Depends on:** 32.2 · **Spec:** [32.3-incremental-updates.md](32.3-incremental-updates.md)
- **Goal:** Replace wholesale `webview.html` reassignment on refresh with a single initial shell render and incremental `postMessage`-driven DOM updates.
