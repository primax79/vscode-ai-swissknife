# 20 — `remote-url` & `git-single-item` sources — Implementation plan

> **Derived from spec:** [`../specs/phase-4-spec.md`](../specs/phase-4-spec.md) §6 · [`../../SPEC.md`](../../SPEC.md) §1

Tasks (each = one commit):

1. **[20.1 — `git-single-item` resolver](20.1-git-single-item-resolver.md)**: implement `src/sources/gitSingleItem.ts`, reusing `gitCustom.ts`'s clone/checkout/mutex machinery, treating the checked-out root as a single `Artifact`.
2. **[20.2 — `remote-url` resolver](20.2-remote-url-resolver.md)**: implement `src/sources/remoteUrl.ts`, plain HTTP(S) fetch of a single file/manifest with hash-based re-fetch and shared caching.
3. **[20.3 — Sources-view wiring & verification](20.3-source-types-ui.md)**: extend the "Add Source" flow to offer both types, wire into resolve/plan, and verify.
