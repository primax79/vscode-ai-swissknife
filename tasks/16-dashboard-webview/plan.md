# 16 — Management dashboard webview — Implementation plan

> **Derived from spec:** [`../specs/phase-3-spec.md`](../specs/phase-3-spec.md) · [`../../SPEC.md`](../../SPEC.md)

Tasks (each = one commit):

1. **[16.1 — Dashboard webview panel & message protocol](16.1-dashboard-panel.md)**: implement `DashboardPanel` in `src/ui/dashboard.ts` with bidirectional message protocol between host and webview.
2. **[16.2 — Dashboard UI with search, filters, and actions](16.2-dashboard-ui.md)**: render visual inventory with filter tabs (All, Skills, Agents, Commands, MCPs), search bar, drift status badges, and action triggers.
3. **[16.3 — Extension integration & verification](16.3-dashboard-integration.md)**: register `aiSwissknife.openDashboard` command and title bar icon, and verify.
