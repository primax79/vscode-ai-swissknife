# 31 — Dashboard: provider action-layer decoupling — Implementation plan

> **Derived from spec:** [`../specs/phase-9-spec.md`](../specs/phase-9-spec.md) §1.1, §7.1

**Depends on:** 28 (merged), 29 and 30 (Phase 8, `specs/adapter-and-source-registries.md`
— **fully merged 2026-09-08**, including 29.5; confirmed on `main` at
commit `80a9bd8`). Task Scope sections below cite the real post-merge
code (`getAdapter()` in place of the old ternaries, etc.) — re-verify
against current `main` before starting in case anything has moved since.

Tasks (each = one commit):

1. **[31.1 — `doUpdateInstallation`/`doUninstallItem`](31.1-installed-do-methods.md)**: extract plain-`ManagedInstallation`-taking public methods in `InstalledTreeDataProvider`.
2. **[31.2 — Decouple `availableView.ts` install methods](31.2-available-decouple-install.md)**: `installFolder`/`installSourceGroup`/`installBatch` gain plain-identifier entry points; `installBatch` becomes non-private.
3. **[31.3 — Identifier-based recommend/unrecommend](31.3-recommendation-handlers.md)**: extract `handleRecommendForWorkspace`/`handleUnrecommendForWorkspace`'s core logic out of `extension.ts` into `src/ui/recommendations.ts`.
4. **[31.4 — Stable item identity + regression verification](31.4-identity-and-regression.md)**: `{assistant, scope, kind, name}` composite key; full sidebar-parity regression pass closing out the initiative.

**Task order and gating:**

- **31.1, 31.2, 31.3 are independent of each other** (different files: `installedView.ts`, `availableView.ts`, `extension.ts`+`recommendations.ts`) — dispatch in parallel.
- **31.4 depends on all three** (the composite identity key is consumed by 31.1's methods; the regression pass exercises 31.1-31.3 together) — do not start until they land.
- This whole initiative gates Initiative 33 and 34 (`specs/phase-9-spec.md` §7).

**Delegation note:** expanded packaging (per `tasks/AGENTS.md`), one task
file per hand-off. Point the agent at the one task file + `specs/phase-9-spec.md`
(§1.1 and §7.1 specifically) + `tasks/CONTEXT.md` — not the whole `tasks/`
tree. Every task's Scope section below describes the **post-Phase-8**
target shape (`getAdapter()`/registry-based dispatch) — if Phase 8 hasn't
actually landed yet when a task starts, stop and re-verify against current
`main` rather than guessing which shape is real.
