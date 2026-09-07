# 24 — Diff-vs-original + preview-before-install — Implementation plan

> **Derived from spec:** [`../specs/phase-6-spec.md`](../specs/phase-6-spec.md) §4.2

Tasks (each = one commit):

1. **[24.1 — Diff-vs-original command](24.1-diff-vs-original.md)**: new command available on a managed item that's drifted or an unmanaged item that `differs` from a source, resolving the original via initiative 23's shared accessor and opening `vscode.diff` against the on-disk content. Depends on 23.2.
2. **[24.2 — Preview-before-install action](24.2-preview-before-install.md)**: new "Preview" action in the existing install confirmation flow, opening `planInstall`'s already-resolved `prepared.content` read-only before the user confirms. Independent of initiative 23 — `planInstall` already has everything needed.

**Task order and gating:**

- **24.1 depends on 23.2** (needs the shared accessor migrated into `drift.ts`/`discovery.ts` so diff has a single place to call for the "original" content, and so `hook`/`rule` diffing isn't built against code slated to change).
- **24.2 has no dependency on this initiative's own 24.1**, or on initiative 23 — it can be dispatched immediately in parallel with everything else in Phase 6.
