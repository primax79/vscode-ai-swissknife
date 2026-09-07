# 25 — Move action + Promote disambiguation fix — Implementation plan

> **Derived from spec:** [`../specs/phase-6-spec.md`](../specs/phase-6-spec.md) §4.3, §4.4

Tasks (each = one commit):

1. **[25.1 — Discovery: collect all match candidates](25.1-discovery-candidates.md)**: change the discovery matching loop from one overwritten `match` to a `candidates` list, extended to attempt all 5 source types and to keep scanning a source's remaining packages after one hit.
2. **[25.2 — Promote UI: candidate-based visibility + disambiguation](25.2-promote-ui-fix.md)**: `contextValue` buckets on `ObservedArtifactItem`, split `package.json` menu conditions, `QuickPick` disambiguation at >1 candidate, remove the `'local-promotion'` fallback entirely. Depends on 25.1.
3. **[25.3 — promoteAllIdentical: skip multi-candidate items](25.3-promote-all-identical-fix.md)**: Dashboard's bulk-promote path only acts on single-candidate items, reporting multi-candidate ones as skipped. Depends on 25.1/25.2.
4. **[25.4 — Move primitives: removeMcpServer adapter method + soft-delete helper](25.4-move-primitives.md)**: add `removeMcpServer(id, loc)` to the `Adapter` interface and all 5 adapters; add a soft-delete-move helper for `skill`/`agent`/`command` paths into `.ai-swissknife/_deleted/...`. Independent of 25.1-25.3.
5. **[25.5 — "Move to..." command](25.5-move-command.md)**: wire the new command in `installedView.ts` alongside `syncItem`, reusing `planSync` for the target install and 25.4's primitives for the origin removal, with `manual-recovery-required` on partial failure. Depends on 25.4.

**Task order and gating:**

- **25.1 gates 25.2 gates 25.3** — the Promote fix chain.
- **25.4 gates 25.5** — the Move primitives chain, independent of the Promote chain.
- 25.1-25.3 and 25.4-25.5 can be dispatched in parallel (two independent worktrees) since they touch different files (`discovery.ts`/`package.json`/`dashboard.ts` vs. `adapters/*.ts`/`installedView.ts`).
