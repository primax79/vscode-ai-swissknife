# 31 — Dashboard: provider action-layer decoupling — Summary

> **Closed on:** 2026-10-27 (registry tidy; verifier ai-coding-tools-c1)  
> **Initiative:** 31 — Dashboard: provider action-layer decoupling  
> **Status:** ✅ Done and merged into main

Summary written at closure from the plan and the git history; the per-task specs in this folder hold the detail.

## What was built

- **31.1 `doUpdateInstallation`/`doUninstallItem`** — merged e7be2b1 2026-09-08. Extract plain-`ManagedInstallation`-taking public methods `doUpdateInstallation` and `doUninstallItem` on `InstalledTreeDataProvider` so webview messages can call them.
- **31.2 Decouple `availableView.ts` install methods** — merged bc1b26d 2026-09-08. Give `installFolder`, `installSourceGroup`, and `installArtifact` plain-identifier entry points on `AvailableTreeDataProvider` and make `installBatch` public.
- **31.3 Identifier-based recommend/unrecommend** — merged 69cf6bf 2026-09-08. Extract identifier-based recommend and unrecommend handlers into `src/ui/recommendations.ts` so they do not depend on `TreeItem` `instanceof` checks.
- **31.4 Stable item identity + regression verification** — merged f4bc36d 2026-09-08. Introduce a `{assistant, scope, kind, name}` composite identity key with server-side re-resolution and verify full sidebar action parity.

## Verification

- Every task's work is merged into `main` (evidence: the commits named above, from `git log --grep '<id>'`).
- `npm test` on `main` at 5e85109 (2026-10-27): 577 tests, 576 pass, 0 fail, 1 opt-in skip (`AISK_REAL_KILO=1`).
- `ai-orch tasks validate --tasks-dir tasks`: 0 errors.
