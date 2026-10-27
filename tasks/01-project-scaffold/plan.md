# 01 — Project scaffold — Implementation plan

> **Derived from spec:** [../specs/foundations.md](../specs/foundations.md)

Tasks (each = one commit; hand one file at a time to a delegated agent):

## Tasks

## Shared decisions

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

## Closed

### 01.1 - package.json + build tooling

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Package and build tooling · **Size:** S · **Depends on:** - · **Spec:** [01.1-package-and-build.md](01.1-package-and-build.md)
- **Goal:** Create `package.json`, `tsconfig.json`, and an esbuild-based build script so the extension can compile.

### 01.2 - Extension entry point + activation

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Extension entry point · **Size:** S · **Depends on:** 01.1 · **Spec:** [01.2-extension-entry.md](01.2-extension-entry.md)
- **Goal:** Provide a minimal `src/extension.ts` that activates cleanly in the Extension Development Host with the folder layout later initiatives fill in.

### 01.3 - Lint/format config + npm scripts sanity check

- **Status:** `done` (2026-10-27; ai-coding-tools-c1) · **Short:** Lint config and build gate · **Size:** S · **Depends on:** 01.2 · **Spec:** [01.3-lint-and-scripts.md](01.3-lint-and-scripts.md)
- **Goal:** Configure working `eslint`, `typecheck`, and `build` scripts as the standard verification gate.
