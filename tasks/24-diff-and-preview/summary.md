# 24 — Diff-vs-original + preview-before-install — Summary

> **Closed on:** 2026-10-27 (registry tidy; verifier ai-coding-tools-c1)  
> **Initiative:** 24 — Diff-vs-original + preview-before-install  
> **Status:** ✅ Done and merged into main

Summary written at closure from the plan and the git history; the per-task specs in this folder hold the detail.

## What was built

- **24.1 Diff-vs-original command** — merged 94b8609 2026-09-08; commit 96505a8. Add a `diffAgainstOriginal` command on modified managed items and differing unmanaged items that resolves the upstream original via `resolveAndTranslate` and opens `vscode.diff`.
- **24.2 Preview-before-install action** — merged b8e8959 2026-09-07; commit 2614f6d. Add a `Preview` option to the install confirmation flow using a `TextDocumentContentProvider` to inspect `prepared.content` read-only without writing to disk.

## Verification

- Every task's work is merged into `main` (evidence: the commits named above, from `git log --grep '<id>'`).
- `npm test` on `main` at 5e85109 (2026-10-27): 577 tests, 576 pass, 0 fail, 1 opt-in skip (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errors.
