# 34 — Dashboard: Recommendations + Installed action parity — Implementation plan

> **Derived from spec:** [`../specs/phase-9-spec.md`](../specs/phase-9-spec.md) §1 (goals 2-3), §4, §4.1

**Depends on:** 31 (all of it, merged), 32 (all of it, merged). Independent
of Initiative 33 — different sections, no shared code — may run before,
after, or in parallel with it.

Tasks (each = one commit):

1. **[34.1 — Recommendations section](34.1-recommendations-section.md)**: `resolveRecommendations` `pending`/`broken` buckets surfaced with install-one/install-all/unrecommend actions.
2. **[34.2 — Uninstall + Update-to-latest in detail panel](34.2-uninstall-update-parity.md)**: extend the existing Installed detail panel (Initiative 26) with the two missing actions, using Initiative 31's `do*` methods and 31.4's stable identity.
3. **[34.3 — Cross-refresh wiring](34.3-cross-refresh.md)**: confirm every Dashboard-triggered mutation (33's and 34's) refreshes the status bar and sidebar providers, per `specs/phase-9-spec.md` §4.1.

**Task order and gating:**

- **34.1 and 34.2 are independent of each other** (different sections/data) — dispatch in parallel.
- **34.3 depends on both** (it is the integration/verification pass across everything this initiative and Initiative 33 added).

**Delegation note:** expanded packaging (per `tasks/AGENTS.md`), one task
file per hand-off. Point the agent at the one task file + `specs/phase-9-spec.md`
(§1, §4, §4.1) + `tasks/CONTEXT.md` + the relevant Initiative 31 task
file(s) for the exact `do*` method signatures being consumed.
