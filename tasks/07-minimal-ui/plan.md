# 07 — Minimal UI (3 views) — Implementation plan

> **Derived from spec:** [../specs/foundations.md](../specs/foundations.md)

Tasks (each = one commit; hand one file at a time to a delegated agent):

1. [07.1 — Activity Bar container + Sources view](07.1-sources-view.md)
2. [07.2 — Available view (browse + install command)](07.2-available-view.md)
3. [07.3 — Installed view (registry-backed)](07.3-installed-view.md)

Shared decisions for this initiative that every task must honour:

- Three plain `vscode.TreeDataProvider`-based views (SPEC.md §4 "Tree
  view in Activity Bar"), **not** webviews — Phase 1 explicitly excludes
  the dashboard/form-editor webviews (`specs/foundations.md` non-goals).
- All three views live under one new Activity Bar container (like
  `references/agent-hub/package.json`'s `viewsContainers.activitybar`
  entry, but with `id: "ai-swissknife"`) — add this container once, in
  task 07.1, not duplicated across tasks.
- `projectRoot` for any `scope: 'project'` operation is resolved from
  `vscode.workspace.workspaceFolders?.[0]?.uri.fsPath` at the UI layer —
  this is the one place that resolution is allowed to happen (every
  lower layer takes it as an explicit parameter, per `CONTEXT.md`'s
  pure-Node constraint). If there's no open workspace folder, project-scope
  actions must be disabled/hidden in the UI, not silently fall back to
  global scope.
- This initiative depends on 06 (install engine) for the Available view's
  install action, but the Sources view (07.1) only depends on 02 (registry)
  and can be built and tested before 06 lands if delegated separately —
  note this when assigning 07.1 vs 07.2/07.3.
