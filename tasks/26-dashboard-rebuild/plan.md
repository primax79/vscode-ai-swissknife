# 26 — Dashboard rebuild: unified table, filters, detail — Implementation plan

> **Derived from spec:** [`../specs/phase-6-spec.md`](../specs/phase-6-spec.md) §4.5

Tasks (each = one commit):

1. **[26.1 — Unified table + filter bar + breadcrumb](26.1-unified-table-and-filters.md)**: merge the managed/unmanaged tables into one row model with a single status badge, add the Environment/Scope/Membership/Kind/search filter bar with a removable-chip breadcrumb, escape all interpolated dynamic strings, update the existing dashboard test assertions tied to today's two-table structure. Depends only on initiative 16 (already merged) — can be dispatched immediately, in parallel with 23-25.
2. **[26.2 — Per-item detail panel + value-based action handlers](26.2-detail-panel.md)**: new request/response message protocol for row-selection detail (origin, diff availability, cross-framework list, candidates), rendering the detail section, plus value-based (non-`instanceof`) `Copy`/`Move`/`Promote`/`Edit` handlers reachable from webview messages. Depends on 26.1 and on initiatives 23, 24, and 25 (consumes their outputs).

**Task order and gating:**

- **26.1 has no dependency on 23-25** — dispatch it immediately alongside them.
- **26.2 depends on 26.1 and on 23.3 (cross-framework lookup), 24.1 (diff availability), and 25.2/25.5 (Promote/Move actions)** — it is the integration point where those land in the UI, and must wait for all of them.
