# UC011 - Sync an installed artifact across assistants and scopes

- id: UC011
- title: Sync an installed artifact across assistants and scopes
- actor: User
- status: draft
- priority: P1
- linked-tasks: 18
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: Cross-assistant sync

## Description & Business Value
Enables copying an already-installed artifact (or promoted unmanaged item) from one assistant/scope to another by parsing the origin's canonical content, translating it to the target assistant, and applying it transactionally with skip/overwrite/cancel conflict handling. Source: tasks/specs/phase-4-spec.md §4

## Preconditions
- At least one artifact is installed in an assistant and scope.

## Scenario / Interaction Steps
1. The user selects an installed item and invokes Copy/Sync to another assistant and/or scope.
2. planSync reads the origin's canonical content, runs the standard translator for the target assistant, and computes a SupportedInstallPlan.
3. If a conflict exists at the target, the user chooses overwrite, skip, or cancel; applyInstall writes the translated artifact and records the new ManagedInstallation.

## Automated Verification Command
```bash
node --test out/engine/sync.test.js
```

## Acceptance Criteria
- [ ] `planSync` reads the origin installation's canonical content and reuses the standard `translate*` functions to produce a `SupportedInstallPlan` or `UnsupportedInstallPlan`.
- [ ] `applyInstall` executes the sync plan using the same atomic staging, verification, and state persistence as marketplace installations.
- [ ] Conflict prompts during single or batch sync offer `overwrite`, `skip`, and `cancel`.

## AI Validation Log

