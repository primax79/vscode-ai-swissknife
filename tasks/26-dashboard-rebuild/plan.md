# 26 — Dashboard rebuild: unified table, filters, detail — Implementation plan

> **Derived from spec:** [`../specs/phase-6-spec.md`](../specs/phase-6-spec.md) §4.5

## Tasks

## Task order and gating

- **26.1 has no dependency on 23-25** — dispatch it immediately alongside them.
- **26.2 depends on 26.1 and on 23.3 (cross-framework lookup), 24.1 (diff availability), and 25.2/25.5 (Promote/Move actions)** — it is the integration point where those land in the UI, and must wait for all of them.

## Closed

### 26.1 - Unified table + filter bar + breadcrumb

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Unified table and filters · **Size:** M · **Depends on:** 16 · **Spec:** [26.1-unified-table-and-filters.md](26.1-unified-table-and-filters.md)
- **Goal:** Replace the Dashboard's two structurally different tables (managed vs. unmanaged) with one unified row model, a single status badge, and an Environment/Scope/Membership/Kind/search filter bar with a removable-chip breadcrumb.

### 26.2 - Per-item detail panel + value-based action handlers

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Per-item detail panel · **Size:** M · **Depends on:** 26.1, 23, 24, 25 · **Spec:** [26.2-detail-panel.md](26.2-detail-panel.md)
- **Goal:** Add a request/response webview message protocol so selecting a row opens a detail section showing origin, diff availability, cross-framework presence, and value-based Copy/Move/Promote/Edit action handlers.
