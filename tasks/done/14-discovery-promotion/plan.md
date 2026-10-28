# 14 — Rilevamento e promozione — Piano di implementazione

> **Derived from spec:** [`../specs/phase-3-spec.md`](../../specs/phase-3-spec.md) · [`../../SPEC.md`](../../../SPEC.md)

Task (ciascuno = un commit):

## Tasks

## Closed

### 14.1 - Scanner dell'inventario per artefatti non gestiti

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Scanner inventario non gestito · **Size:** M · **Depends on:** 13 · **Use cases:** UC008 · **Spec:** [14.1-inventory-scanner.md](14.1-inventory-scanner.md)
- **Goal:** Implementare `scanInstalledInventory` in `src/engine/discovery.ts` rilevando gli `ObservedArtifact` non gestiti tra tutti gli assistenti e scope e confrontandoli con le sorgenti registrate.

### 14.2 - Motore di promozione

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Motore promozione non gestiti · **Size:** S · **Depends on:** 14.1 · **Use cases:** UC008 · **Spec:** [14.2-promotion-engine.md](14.2-promotion-engine.md)
- **Goal:** Implementare `promoteObservedArtifact` in `src/engine/discovery.ts` calcolando l'hash del contenuto canonico e salvando un record `ManagedInstallation` in `state.json`.

### 14.3 - Integrazione UI

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** UI rilevamento e promozione · **Size:** S · **Depends on:** 14.2 · **Use cases:** UC008 · **Spec:** [14.3-promotion-ui.md](14.3-promotion-ui.md)
- **Goal:** Mostrare gli elementi non gestiti nella vista Installed e fornire il comando e l'azione inline `Promote to Managed`.
