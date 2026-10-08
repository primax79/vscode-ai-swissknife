# 38 — Per-source refresh — Implementation plan

> Source: owner idea of 2026-10-08, `_inbox/analyzed/2026-10-08-per-source-refresh.md`.
> Inline plan, tasks expanded because it is delegated. No open questions.

**Depends on:** 31 (action layer), 33 (Dashboard Sources & Catalog) — merged. Independent of 36, 37.

## Problem (grounded)

The only refresh is global: `AvailableProvider.refreshCatalog()` (`src/ui/availableView.ts:242`) → `doRefreshCatalog()` (`:254-356`) clears **all** caches and re-resolves **every** source sequentially (`:302-326`). Each git resolve does a network `git fetch --all --tags --prune` (`src/sources/gitCustom.ts:97-98`), so refreshing one repo you just pushed to costs the time of all of them, and a hung source (e.g. SSH auth) delays the rest. The buttons: sidebar view title `aiSwissknife.refreshCatalog` (`package.json:320`), Dashboard toolbar `↻` (`src/ui/dashboard.ts:975`). Source rows have inline actions installSourceGroup/removeSource/openInDashboard/exportSource (`package.json:~440-460`) but no refresh.

## Target

A refresh button on each source: sidebar inline action on `sourceItem`, and an icon-only `↻` on each Dashboard source row. It re-resolves **only that source**, replaces its group in the cached catalog in place, and recomputes the Recommended group (it depends on every source's resolution attempt, `:339-346`). Other sources are untouched and not re-fetched.

## Locked-in decisions

- Icon-only button (Dashboard decision of initiative 35.5), codicon `refresh`, tooltip "Refresh source".
- A source's identity for refresh is `(id, scope)`: the same id may exist in both scopes.
- If the source no longer exists in its manifest, remove its group from the cache instead of erroring.
- Per-source refresh while a full refresh is in flight awaits the full one (reuse the `refreshInFlight` dedup idea); two refreshes of the same source dedupe; refreshes of different sources may run concurrently.

## Tasks

| Task | Title | Depends on | Size |
| --- | --- | --- | --- |
| [38.1](38.1-provider-refresh-source.md) | `AvailableProvider.refreshSource` (single-source re-resolve, in-place cache update) | - | M |
| [38.2](38.2-buttons.md) | Sidebar inline command + Dashboard row button wired to it | 38.1 | S |
