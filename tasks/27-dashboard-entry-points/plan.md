# 27 — New Dashboard entry points — Implementation plan

> **Derived from spec:** [`../specs/phase-6-spec.md`](../specs/phase-6-spec.md) §4.6

## Tasks

## Task order and gating

- **27.1 has no dependency on this phase** — dispatch it immediately.
- **27.2 depends on 26.1** (needs the filter bar/breadcrumb to exist before it can add a `Source` dimension to it).

## Closed

### 27.1 - Shared pending-count function + status bar item

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Status bar pending counts · **Size:** S · **Depends on:** 22 · **Spec:** [27.1-status-bar.md](27.1-status-bar.md)
- **Goal:** Provide a persistent status bar item as a Dashboard entry point backed by a shared function computing unsatisfied-recommendations and updates-available counts on demand.

### 27.2 - "Open in Dashboard" per-source action

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Source filtered jump · **Size:** S · **Depends on:** 26.1 · **Spec:** [27.2-source-filtered-jump.md](27.2-source-filtered-jump.md)
- **Goal:** Reveal the Dashboard with a `{ sourceId, sourceScope }` filter pre-applied as a removable breadcrumb chip from an inline/context action on `SourceItem`.
