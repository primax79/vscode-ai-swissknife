# 16 — Webview della dashboard di gestione — Piano di implementazione

> **Derived from spec:** [`../specs/phase-3-spec.md`](../../specs/phase-3-spec.md) · [`../../SPEC.md`](../../../SPEC.md)

Task (ciascuno = un commit):

## Tasks

## Closed

### 16.1 - Pannello webview della dashboard e protocollo di messaggi

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Pannello webview dashboard · **Size:** M · **Depends on:** 13, 14, 15 · **Use cases:** UC009 · **Spec:** [16.1-dashboard-panel.md](16.1-dashboard-panel.md)
- **Goal:** Implementare `DashboardPanel` in `src/ui/dashboard.ts` con un protocollo di messaggi bidirezionale tra l'extension host e la webview.

### 16.2 - UI della dashboard con ricerca, filtri e azioni

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** UI dashboard e filtri · **Size:** M · **Depends on:** 16.1 · **Use cases:** UC009 · **Spec:** [16.2-dashboard-ui.md](16.2-dashboard-ui.md)
- **Goal:** Mostrare l'inventario visuale con schede di filtro, barra di ricerca, badge dello stato di drift e pulsanti di azione nella webview della Dashboard.

### 16.3 - Integrazione nell'estensione e verifica

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Integrazione comando dashboard · **Size:** S · **Depends on:** 16.2 · **Use cases:** UC009 · **Spec:** [16.3-dashboard-integration.md](16.3-dashboard-integration.md)
- **Goal:** Registrare il comando `aiSwissknife.openDashboard` e l'icona nella barra del titolo in `src/extension.ts` e `package.json`.
