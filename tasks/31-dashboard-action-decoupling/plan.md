# 31 — Dashboard: provider action-layer decoupling — Implementation plan

> **Derived from spec:** [`../specs/phase-9-spec.md`](../specs/phase-9-spec.md) §1.1, §7.1

**Depends on:** 28 (merged), 29 and 30 (Phase 8, `specs/adapter-and-source-registries.md`
— **fully merged 2026-09-08**, including 29.5; confirmed on `main` at
commit `80a9bd8`). Task Scope sections below cite the real post-merge
code (`getAdapter()` in place of the old ternaries, etc.) — re-verify
against current `main` before starting in case anything has moved since.

Tasks (each = one commit):

## Tasks

### 31.1 - `doUpdateInstallation`/`doUninstallItem`

- **Status:** `delivered` (merged e7be2b1 2026-09-08) · **Short:** Installed doUpdate and doUninstall · **Size:** S · **Depends on:** 28, 29, 30 · **Spec:** [31.1-installed-do-methods.md](31.1-installed-do-methods.md)
- **Goal:** Extract plain-`ManagedInstallation`-taking public methods `doUpdateInstallation` and `doUninstallItem` on `InstalledTreeDataProvider` so webview messages can call them.

### 31.2 - Decouple `availableView.ts` install methods

- **Status:** `delivered` (merged bc1b26d 2026-09-08) · **Short:** Decouple available install methods · **Size:** M · **Depends on:** 28, 29, 30 · **Spec:** [31.2-available-decouple-install.md](31.2-available-decouple-install.md)
- **Goal:** Give `installFolder`, `installSourceGroup`, and `installArtifact` plain-identifier entry points on `AvailableTreeDataProvider` and make `installBatch` public.

### 31.3 - Identifier-based recommend/unrecommend

- **Status:** `delivered` (merged 69cf6bf 2026-09-08) · **Short:** Identifier recommendation handlers · **Size:** S · **Depends on:** 28, 29, 30 · **Spec:** [31.3-recommendation-handlers.md](31.3-recommendation-handlers.md)
- **Goal:** Extract identifier-based recommend and unrecommend handlers into `src/ui/recommendations.ts` so they do not depend on `TreeItem` `instanceof` checks.

### 31.4 - Stable item identity + regression verification

- **Status:** `delivered` (merged f4bc36d 2026-09-08) · **Short:** Composite identity and regression · **Size:** M · **Depends on:** 31.1, 31.2, 31.3 · **Spec:** [31.4-identity-and-regression.md](31.4-identity-and-regression.md)
- **Goal:** Introduce a `{assistant, scope, kind, name}` composite identity key with server-side re-resolution and verify full sidebar action parity.

## Task order and gating

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
