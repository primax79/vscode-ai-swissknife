# 23 — Cross-framework identity lookup + shared content accessor — Implementation plan

> **Derived from spec:** [`../specs/phase-6-spec.md`](../specs/phase-6-spec.md) §4.1, §4.2 (accessor half), §3

Tasks (each = one commit):

## Tasks

### 23.1 - Extract shared resolve+translate content accessor

- **Status:** `delivered` (merged ab02786 2026-09-07; commit a820f3b) · **Short:** Shared resolveAndTranslate accessor · **Size:** M · **Depends on:** 13, 14 · **Spec:** [23.1-shared-content-accessor.md](23.1-shared-content-accessor.md)
- **Goal:** Extract `resolveContentFromSource` and per-kind translation calls from `plan.ts` into a shared `resolveAndTranslate` content accessor supporting all 5 source types and 6 artifact kinds.

### 23.2 - Migrate drift.ts and discovery.ts onto the shared accessor

- **Status:** `delivered` (merged 6bd0da3 2026-09-08; commit 77f6a4a) · **Short:** Migrate drift and discovery · **Size:** M · **Depends on:** 23.1 · **Spec:** [23.2-migrate-drift-discovery.md](23.2-migrate-drift-discovery.md)
- **Goal:** Replace inline resolve-and-translate logic in `drift.ts` and `discovery.ts` with calls to `resolveAndTranslate`, closing the `hook` and `rule` drift/discovery gap.

### 23.3 - Cross-framework identity lookup function

- **Status:** `delivered` (merged d0e6160 2026-09-07; commit 7c95667) · **Short:** Cross-framework identity lookup · **Size:** S · **Depends on:** 13, 14 · **Spec:** [23.3-cross-framework-lookup.md](23.3-cross-framework-lookup.md)
- **Goal:** Implement `findRelatedInstallations` in `src/engine/crossFrameworkLookup.ts` to find all `ManagedInstallation` records representing the same logical artifact across assistants and scopes.

## Task order and gating

- **23.1 gates 23.2** (23.2 calls what 23.1 extracts).
- **23.3 is independent** of 23.1/23.2 — it only reads `ManagedInstallation[]`, no source resolution involved.
- Initiative 24 (diff) depends on 23.2; initiative 26's detail panel depends on 23.3. Preview (24.2) and the rest of Phase 6 do not depend on this initiative at all.
