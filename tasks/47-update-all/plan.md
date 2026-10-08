# 47 — Update all — Implementation plan

> Source: owner request 2026-10-08 ("I would like to be able to trigger update all"); action A7 of `specs/actions-study.md`. Decisions, both confirmed by the owner: **UA-Q1 (confirmed by the owner, 2026-10-08: option a)** items modified locally are skipped by default; an explicit opt-in (second button in the summary) includes them and first saves the user's version to the trash; **UA-Q2 (confirmed by the owner, 2026-10-08: option a)** the trigger is available per environment (each sidebar Installed view), on the Dashboard acting on the current filter selection (toolbar button and the clickable "Updates Available" stat card), and as one palette command for everything.
> Inline plan, tasks expanded because they are delegated.

**Depends on:** 37.1 (merged; the apply loop pattern), 46.4 later adds the CLI face. UI placement follows 42.3 once it exists but does not wait for it.

## Problem (grounded)

Updating is one item at a time: `InstalledTreeDataProvider.doUpdateInstallation` (`src/ui/installedView.ts:471-535`) builds a placeholder package/artifact, calls `planInstall`, asks a modal "Update ... to latest version?", `applyInstall`, then runs a **full `checkDrift()`** (re-reads every state file and calls `checkForUpstreamUpdate` for every installation, which does a network fetch per source) after **each** item. Doing that N times would hit the network N x M times. The single-item modal also does not warn that a locally modified item will lose its edits. The drift reports live inside the per-assistant tree providers (`driftReports` map), so there is no single place that knows "what has an update".

## Locked-in decisions

- One drift check at the start (if reports are missing or older than the check the user triggers) and one refresh at the end; each source is resolved **once** per run, not once per item.
- Sequential apply, one item failing never stops the others; per-item outcome reported (same pattern as `applyInstallMatrix`).
- Only `update-available` items are updated by default. `modified-locally` and `modified-and-update-available` are **skipped and listed** unless the user opts in (UA-Q1); opting in saves the current version to the trash first (`_deleted/`, restorable from initiative 42) and says so.
- Items without a source, with a source missing from the manifest or failing to resolve, and `missing-on-disk` are listed as "cannot update" with the reason, never silently dropped.
- Vocabulary: "Global" / "Workspace"; compact rows icon-only, the confirmation dialog uses words.

## Tasks

| Task | Title | Depends on | Size |
| --- | --- | --- | --- |
| [47.1](47.1-engine-update-all.md) | Engine: `planUpdate` extracted from the UI, `planUpdateAll` / `applyUpdateAll` | 37.1 | M |
| [47.4](47.4-drift-resolve-once.md) | Drift check resolves each source once (was once per item: N git fetches) | 47.1 | S |
| [47.3](47.3-hold.md) | Hold an item out of Update all (flag, engine bucket, UI toggle and marker) | 47.1, 47.2 | S |
| [47.2](47.2-ui-update-all.md) | UI: command, per-environment sidebar button, Dashboard button on the filtered selection, summary modal and result report | 47.1 | M |
