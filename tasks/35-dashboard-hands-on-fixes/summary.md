# 35 — Dashboard: hands-on testing fixes — Summary

> **Closed on:** 2026-10-27 (registry tidy; verifier ai-coding-tools-c1)  
> **Initiative:** 35 — Dashboard: hands-on testing fixes  
> **Status:** ✅ Done and merged into main

Summary written at closure from the plan and the git history; the per-task specs in this folder hold the detail.

## What was built

- **35.1 Instant loading shell** — merged 4a46e04 2026-09-09. Synchronously render an instant loading shell with theme styles and a spinner when the Dashboard opens so it never flashes a blank screen while data loads.
- **35.2 Overview tab content** — merged 366aeb2 2026-09-09. Replace the Overview tab placeholder with an at-a-glance landing view showing summary stat chips and items needing attention.
- **35.3 Installed matrix view** — merged 7f3b8b9 2026-09-09. Replace the Installed flat table with an expandable per-artifact comparison matrix with sub-rows per assistant, quick actions (Preview, Diff, Update), and column sorting.
- **35.4 Catalog rows as a real table** — merged 1afb012 2026-09-09. Convert Sources & Catalog artifact and folder rows from free-wrapping flex layouts to a fixed-column CSS grid table.
- **35.5 Icon-only buttons across the Dashboard** — merged e656d24 2026-09-09. Replace text labels with compact Unicode icon buttons and tooltips across all Dashboard sections where text is not indispensable.

## Verification

- Every task's work is merged into `main` (evidence: the commits named above, from `git log --grep '<id>'`).
- `npm test` on `main` at 5e85109 (2026-10-27): 577 tests, 576 pass, 0 fail, 1 opt-in skip (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errors.
