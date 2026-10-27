# 46 — CLI access to ai-swissknife — Summary

> **Closed on:** 2026-10-27 (registry tidy; verifier ai-coding-tools-c1)  
> **Initiative:** 46 — CLI access to ai-swissknife  
> **Status:** ✅ Done and merged into main

Summary written at closure from the plan and the git history; the per-task specs in this folder hold the detail.

## What was built

- **46.1 CLI skeleton + read-only commands (sources, catalog, installed, updates, item, plan-install)** — merged 5b0bc70 2026-10-09. Build the `vscode`-free `dist/cli.js` bundle (`ai-swissknife`) with pure JSON stdout and read-only commands `sources`, `catalog`, `installed`, `updates`, `item`, and `plan-install`.
- **46.2 Agent-facing documentation: AGENTS.md block + `--help --json` self-description** — merged 88bd55f 2026-10-09. Add the machine-readable `describe` command generated from command definitions and document the CLI contract and examples in `AGENTS.md`.
- **46.3 Cross-process lock for manifest/state read-modify-write** — merged e909ede 2026-10-08. Implement `withStateLock` in `src/domain/stateLock.ts` with exclusive lock files and stale-lock recovery around manifest and state read-modify-write sequences.
- **46.5 `redistribute <path|item>` v1 (installed from a local folder; plan-first, `--write`)** — merged 99a127c 2026-10-09. Add `planRedistribute`/`applyRedistribute` and the CLI `redistribute` command to push edits from a registered `local-folder` source to all installed copies (plan-only without `--write`).
- **46.4 Write commands behind `--write`: apply-install, uninstall (soft), add/remove source** — merged b0872cb 2026-10-09. Add plan-first CLI write commands behind `--write` (`apply-install`, `uninstall`, `source add/remove`, `update`, and `trash list/restore/empty`).

## Verification

- Every task's work is merged into `main` (evidence: the commits named above, from `git log --grep '<id>'`).
- `npm test` on `main` at 5e85109 (2026-10-27): 577 tests, 576 pass, 0 fail, 1 opt-in skip (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errors.
