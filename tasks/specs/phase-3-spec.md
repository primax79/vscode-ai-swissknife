# Spec — AI Swissknife Phase 3: Advanced Management & Drift Detection

> **Status:** Draft / Accepted for implementation  
> **Parent Spec:** [`SPEC.md`](../../SPEC.md) · [`phase-2-spec.md`](phase-2-spec.md)  
> **Pre-requisite:** Phase 1 and Phase 2 (Initiatives 01–12) completed and verified.

---

## 1. Goals & Scope of Phase 3

Phase 1 & Phase 2 established cross-assistant packaging, translation, and transactional installation for Skills, Agents, Commands, and MCP Servers across Claude Code, Kilo Code, and GitHub Copilot.

Phase 3 implements **Management** capabilities:
1. **Drift & Update Detection**:
   - Compares installed items (`ManagedInstallation.contentHash` and `sourceRevision`) against disk content and upstream source catalog.
   - States: `up-to-date`, `modified-locally`, `update-available`, `modified-and-update-available`, `missing-on-disk`.
2. **Discovery & Promotion**:
   - Scans unmanaged items (`ObservedArtifact`) in assistant folders and enables safe, user-confirmed promotion to `ManagedInstallation`.
3. **File Watchers**:
   - Real-time reactivity when files are added, modified, or deleted externally in assistant directories.
4. **Management Dashboard & Webview**:
   - Visual inventory dashboard with bulk actions, filters, search, and drift indicators.

---

## 2. Drift Analysis Model

```ts
export type DriftStatus =
  | 'up-to-date'
  | 'modified-locally'
  | 'update-available'
  | 'modified-and-update-available'
  | 'missing-on-disk';

export interface DriftReport {
  installation: ManagedInstallation;
  status: DriftStatus;
  diskHash?: string;
  sourceHash?: string;
  details?: string;
}
```

---

## 3. Phase 3 Initiatives Breakdown

| Initiative | Title | Scope |
| --- | --- | --- |
| **13** | **Drift & Update Detection** | Domain drift analyzer, compare disk/source hashes, update command, status icons in Installed view. |
| **14** | **Discovery & Promotion** | Scan assistant folders for unmanaged `ObservedArtifact`, promotion dialog to `ManagedInstallation`. |
| **15** | **File Watchers** | `createFileSystemWatcher` for real-time tree view and status updates. |
| **16** | **Management Dashboard** | Webview panel with search, filters, drift badges, and bulk install/update/remove. |
