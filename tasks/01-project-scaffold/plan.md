# 01 — Project scaffold — Implementation plan

> **Derived from spec:** [../specs/foundations.md](../specs/foundations.md)

Tasks (each = one commit; hand one file at a time to a delegated agent):

1. [01.1 — package.json + build tooling](01.1-package-and-build.md)
2. [01.2 — Extension entry point + activation](01.2-extension-entry.md)
3. [01.3 — Lint/format config + npm scripts sanity check](01.3-lint-and-scripts.md)

Shared decisions for this initiative that every task must honour:

- Grounded in `references/agent-hub/` (`package.json`, `tsconfig.json`,
  `esbuild.config.js`) as the real, structurally similar precedent — reuse
  its shape, don't invent a different toolchain, but **drop** what Phase 1
  doesn't need yet: no `better-sqlite3`/`@electron/rebuild` (no local DB in
  this slice — the registry is plain JSON per SPEC.md §1), no webview
  bundle config (Phase 1 UI is `TreeDataProvider`-based per
  `specs/foundations.md`, not a webview).
- Package name/publisher: use `ai-swissknife` / leave `publisher` as a
  placeholder the human will fill in before actually publishing (don't
  invent a real marketplace publisher id).
- Repo already has a remote configured
  (`git@github.com:primax79/vscode-ai-swissknife.git`) and a `.gitignore`
  with `references` — extend it, don't replace it.
- One commit per task, scoped to just that task's files.
