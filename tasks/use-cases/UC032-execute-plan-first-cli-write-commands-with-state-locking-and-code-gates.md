# UC032 - Execute plan-first CLI write commands with state locking and code gates

- id: UC032
- title: Execute plan-first CLI write commands with state locking and code gates
- actor: Operator
- approval: proposed
- priority: P1
- linked-tasks: 46.1, 46.2, 46.3, 46.4, 46.5
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: CLI writes and state lock

## Description & Business Value
Allows an operator or agent to install, update, uninstall, manage sources, and manage trash from the CLI using a plan-first contract (read-only preview unless --write is passed), refusing hook and mcp-server kinds without --allow-code-kinds and serializing concurrent writers via a cross-process state lock. Source: tasks/specs/mcp-cli-access-study.md §3, §4

## Preconditions
- dist/cli.js is built and target workspace/home directories are writable.

## Scenario / Interaction Steps
1. The operator invokes apply-install, update, uninstall, source add/remove, or trash restore/empty without --write to inspect the JSON execution plan without mutating disk.
2. Passing --write executes the mutation inside withStateLock (taking over dead-PID stale locks and preventing lost updates across concurrent processes).
3. Any write targeting a hook or mcp-server artifact is refused unless --allow-code-kinds is explicitly provided.

## Automated Verification Command
```bash
node --test out/cli/writes.test.js out/domain/stateLock.test.js
```

## Acceptance Criteria
- [ ] Invoking any CLI write command (`apply-install`, `uninstall`, `source add`, `source remove`, `update`, `trash restore`, `trash empty`) without `--write` leaves the filesystem byte-identical.
- [ ] `hook` and `mcp-server` artifacts are refused by every CLI write command unless `--allow-code-kinds` is also passed.
- [ ] `withStateLock` serializes concurrent in-process and cross-process read-modify-write operations on `manifest.json` and `state.json`, taking over dead-PID stale locks without losing updates.

## AI Validation Log

