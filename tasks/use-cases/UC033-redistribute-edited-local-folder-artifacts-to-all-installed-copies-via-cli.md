# UC033 - Redistribute edited local-folder artifacts to all installed copies via CLI

- id: UC033
- title: Redistribute edited local-folder artifacts to all installed copies via CLI
- actor: Agent session
- approval: proposed
- priority: P1
- linked-tasks: 46.1, 46.2, 46.3, 46.4, 46.5
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: CLI redistribute edited skill

## Description & Business Value
Allows an agent session or maintainer that edited a skill/agent/command inside a registered local-folder source to push the updated files to every installed copy across assistants and scopes in one non-interactive CLI call (plan-first, applying with --write). Source: tasks/specs/dev-deploy-study.md §3

## Preconditions
- A local directory is registered as a local-folder source and one or more of its artifacts are installed.

## Scenario / Interaction Steps
1. After editing an artifact in the source folder, the agent runs node dist/cli.js redistribute <path> to preview per-copy classifications (identical, stale, modified-locally, missing-on-disk, orphan) without mutating disk.
2. Re-running with --write updates all stale copies, reports oldHash, newHash, and changedFiles, and keeps orphan copies untouched.
3. Copies that were modified-locally are skipped unless --force is passed (which backs up the previous copy to _deleted/ first), and missing targets are installed only when --install-missing is passed.

## Automated Verification Command
```bash
node --test out/cli/redistribute.test.js
```

## Acceptance Criteria
- [ ] Running `redistribute <path>` without `--write` outputs the per-copy classification plan (`identical`, `stale`, `modified-locally`, `missing-on-disk`, `orphan`) and leaves disk byte-identical.
- [ ] Running with `--write` updates `stale` copies in place without creating duplicate `state.json` records, skips `modified-locally` copies unless `--force` is passed (saving a backup to `_deleted/`), and never deletes `orphan` copies.
- [ ] Passing a path that is not a registered `local-folder` source fails with `NOT_A_LOCAL_FOLDER_SOURCE`, and `hook`/`mcp-server` artifacts require `--allow-code-kinds`.

## AI Validation Log

