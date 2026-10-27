# 34 — Dashboard: Recommendations + Installed action parity — Implementation plan

> **Derived from spec:** [`../specs/phase-9-spec.md`](../specs/phase-9-spec.md) §1 (goals 2-3), §4, §4.1

**Depends on:** 31 (all of it, merged), 32 (all of it, merged). Independent
of Initiative 33 — different sections, no shared code — may run before,
after, or in parallel with it.

Tasks (each = one commit):

## Tasks

## Task order and gating

- **34.1 and 34.2 are independent of each other** (different sections/data) — dispatch in parallel.
- **34.3 depends on both** (it is the integration/verification pass across everything this initiative and Initiative 33 added).

**Delegation note:** expanded packaging (per `tasks/AGENTS.md`), one task
file per hand-off. Point the agent at the one task file + `specs/phase-9-spec.md`
(§1, §4, §4.1) + `tasks/CONTEXT.md` + the relevant Initiative 31 task
file(s) for the exact `do*` method signatures being consumed.

## Closed

### 34.1 - Recommendations section

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Dashboard recommendations section · **Size:** M · **Depends on:** 31.3, 32 · **Spec:** [34.1-recommendations-section.md](34.1-recommendations-section.md)
- **Goal:** Surface `resolveRecommendations` `pending` and `broken` buckets in the Dashboard Recommendations tab with install-one, install-all, and unrecommend actions.

### 34.2 - Uninstall + Update-to-latest in detail panel

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Detail panel uninstall and update · **Size:** S · **Depends on:** 31.1, 31.4 · **Spec:** [34.2-uninstall-update-parity.md](34.2-uninstall-update-parity.md)
- **Goal:** Extend the Installed detail panel with Uninstall and Update-to-latest actions using server-side re-resolution by stable composite identity key.

### 34.3 - Cross-refresh wiring

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Cross-refresh mutation audit · **Size:** S · **Depends on:** 34.1, 34.2 · **Spec:** [34.3-cross-refresh.md](34.3-cross-refresh.md)
- **Goal:** Audit and ensure every Dashboard-triggered state mutation refreshes the status bar and sidebar tree providers.
