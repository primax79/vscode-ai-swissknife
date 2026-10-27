# UC003 - Separate shared manifest intent from machine-local install state

- id: UC003
- title: Separate shared manifest intent from machine-local install state
- actor: User
- status: draft
- priority: P1
- linked-tasks: 02, 06, 07
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: Manifest and state persistence

## Description & Business Value
Keeps version-controllable source/recommendation intent in manifest.json separate from machine-local ManagedInstallation provenance in state.json, storing relative paths and automatically gitignoring project state.json. Source: tasks/specs/foundations.md §Locked-in decisions

## Preconditions
- Workspace or global home directory is writable.

## Scenario / Interaction Steps
1. Adding or removing a source updates manifest.json using relative paths for local-folder sources and ensures .vscode/ai-swissknife/state.json is listed in project .gitignore.
2. Installing an artifact updates only state.json with contentHash and sourceRevision without polluting manifest.json.
3. Removing a source cleans up dependent manifest entries while preserving already-installed local files and state records.

## Automated Verification Command
```bash
node --test out/domain/registry.test.js out/domain/gitignore.test.js
```

## Acceptance Criteria
- [ ] `manifest.json` stores `DesiredSource` entries with paths relative to the workspace root (project scope) or home root (global scope) and rejects paths outside those roots.
- [ ] Writing project `manifest.json` ensures `.vscode/ai-swissknife/state.json` is added to the project `.gitignore`, while global `writeManifest` never touches `.gitignore`.
- [ ] `readManifest` and `readState` return empty defaults when files do not exist and fail closed on corrupt JSON or `schemaVersion` mismatch.

## AI Validation Log

