# 23 — Cross-framework identity lookup + shared content accessor — Implementation plan

> **Derived from spec:** [`../specs/phase-6-spec.md`](../specs/phase-6-spec.md) §4.1, §4.2 (accessor half), §3

Tasks (each = one commit):

1. **[23.1 — Extract shared resolve+translate content accessor](23.1-shared-content-accessor.md)**: pull `plan.ts`'s `resolveContentFromSource` + per-kind translation calls (the fullest existing implementation — all 5 source types, all 6 kinds) into one reusable function, without changing `planInstall`'s own behavior.
2. **[23.2 — Migrate drift.ts and discovery.ts onto the shared accessor](23.2-migrate-drift-discovery.md)**: replace `checkForUpstreamUpdate`'s and the discovery match loop's narrower (3 source types, 4 kinds) inline resolve+translate logic with calls to 23.1's accessor — closes the `hook`/`rule` gap (including the `analyzeLocalDrift` bug that always reports them as drifted) as a side effect.
3. **[23.3 — Cross-framework identity lookup function](23.3-cross-framework-lookup.md)**: pure function returning every other `ManagedInstallation` representing "the same logical artifact" as a given one — independent of 23.1/23.2, can be built in parallel.

**Task order and gating:**

- **23.1 gates 23.2** (23.2 calls what 23.1 extracts).
- **23.3 is independent** of 23.1/23.2 — it only reads `ManagedInstallation[]`, no source resolution involved.
- Initiative 24 (diff) depends on 23.2; initiative 26's detail panel depends on 23.3. Preview (24.2) and the rest of Phase 6 do not depend on this initiative at all.
