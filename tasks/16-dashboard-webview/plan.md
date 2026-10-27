# 16 — Management dashboard webview — Implementation plan

> **Derived from spec:** [`../specs/phase-3-spec.md`](../specs/phase-3-spec.md) · [`../../SPEC.md`](../../SPEC.md)

Tasks (each = one commit):

## Tasks

### 16.1 - Dashboard webview panel & message protocol

- **Status:** `delivered` (merged f20f189 2026-08-19; commit 053b6b1) · **Short:** Dashboard webview panel · **Size:** M · **Depends on:** 13, 14, 15 · **Spec:** [16.1-dashboard-panel.md](16.1-dashboard-panel.md)
- **Goal:** Implement `DashboardPanel` in `src/ui/dashboard.ts` with a bidirectional message protocol between the extension host and webview.

### 16.2 - Dashboard UI with search, filters, and actions

- **Status:** `delivered` (merged f20f189 2026-08-19; commit 053b6b1) · **Short:** Dashboard UI and filters · **Size:** M · **Depends on:** 16.1 · **Spec:** [16.2-dashboard-ui.md](16.2-dashboard-ui.md)
- **Goal:** Render the visual inventory with filter tabs, search bar, drift status badges, and action triggers in the Dashboard webview.

### 16.3 - Extension integration & verification

- **Status:** `delivered` (merged f20f189 2026-08-19; commit 053b6b1) · **Short:** Dashboard command integration · **Size:** S · **Depends on:** 16.2 · **Spec:** [16.3-dashboard-integration.md](16.3-dashboard-integration.md)
- **Goal:** Register the `aiSwissknife.openDashboard` command and title bar icon in `src/extension.ts` and `package.json`.
