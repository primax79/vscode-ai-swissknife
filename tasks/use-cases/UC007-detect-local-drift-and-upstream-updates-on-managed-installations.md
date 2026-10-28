# UC007 - Detect local drift and upstream updates on managed installations

- id: UC007
- title: Detect local drift and upstream updates on managed installations
- actor: User
- approval: proposed
- priority: P1
- linked-tasks: 13.1, 13.2, 13.3, 15.1, 15.2
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: Detect drift and updates

## Description & Business Value
Compares each ManagedInstallation's recorded contentHash and sourceRevision against current disk files and upstream source catalogs to classify items as up-to-date, modified-locally, update-available, modified-and-update-available, or missing-on-disk, with debounced file watchers refreshing state when assistant directories change. Source: tasks/specs/phase-3-spec.md §1-2

## Preconditions
- At least one artifact is installed and tracked in state.json.

## Scenario / Interaction Steps
1. The drift analyzer hashes the installed files on disk and compares against ManagedInstallation.contentHash.
2. When upstream checks run, each source is resolved once (deduplicated across installations) and compared against the recorded sourceRevision/contentHash.
3. The item is classified into one of the five DriftStatus states and surfaced in the Installed tree and Dashboard; external filesystem edits trigger debounced watchers.

## Automated Verification Command
```bash
node --test out/engine/drift.test.js
```

## Acceptance Criteria
- [ ] `analyzeLocalDrift` classifies an installed artifact as `up-to-date`, `modified-locally`, or `missing-on-disk` by comparing disk content hashes against `ManagedInstallation.contentHash`.
- [ ] `checkForUpstreamUpdate` and `checkDriftForAll` detect `update-available` and `modified-and-update-available` while resolving each upstream source at most once per batch run.
- [ ] A failing upstream source resolution reports the failure on its items without aborting drift checks for other sources.

## AI Validation Log

