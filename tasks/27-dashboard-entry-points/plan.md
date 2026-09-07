# 27 — New Dashboard entry points — Implementation plan

> **Derived from spec:** [`../specs/phase-6-spec.md`](../specs/phase-6-spec.md) §4.6

Tasks (each = one commit):

1. **[27.1 — Shared pending-count function + status bar item](27.1-status-bar.md)**: one exported function computing unsatisfied-recommendations + updates-available counts on demand, called by a new persistent status bar item created in `activate()`. Independent of everything else in Phase 6.
2. **[27.2 — "Open in Dashboard" per-source action](27.2-source-filtered-jump.md)**: inline/context action on `SourceItem` that reveals the Dashboard with a `{ sourceId, sourceScope }` filter pre-applied as a removable breadcrumb chip. Depends on 26.1's filter bar.

**Task order and gating:**

- **27.1 has no dependency on this phase** — dispatch it immediately.
- **27.2 depends on 26.1** (needs the filter bar/breadcrumb to exist before it can add a `Source` dimension to it).
