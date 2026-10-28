# UC015 - Mark or unmark project-scoped recommended artifacts in manifest.json

- id: UC015
- title: Mark or unmark project-scoped recommended artifacts in manifest.json
- actor: Project maintainer
- status: draft
- priority: P2
- linked-tasks: 22
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: Curate project recommendations

## Description & Business Value
Allows a project curator to recommend or unrecommend specific source-tracked artifacts for a target assistant at project scope, persisting DesiredInstallation entries in the shared manifest.json while keeping state.json gitignored. Source: tasks/specs/project-recommendations.md §4.1, §4.5

## Preconditions
- A workspace is open with at least one registered source.

## Scenario / Interaction Steps
1. The curator selects an artifact in the catalog (picking a target assistant) or an installed project item tracked to a source and runs Recommend for Workspace.
2. The extension writes a deduplicated DesiredInstallation { sourceId, artifactId, assistant, scope: 'project' } to .vscode/ai-swissknife/manifest.json and ensures state.json is in .gitignore.
3. Both the catalog and Installed views refresh immediately to display the Recommended badge; Unrecommend for Workspace removes the entry.

## Automated Verification Command
```bash
node --test out/ui/recommendations.test.js out/domain/gitignore.test.js
```

## Acceptance Criteria
- [ ] `recommendForWorkspace` writes a project-scoped `DesiredInstallation` deduplicated on `sourceId + artifactId + assistant` into `manifest.json`.
- [ ] Recommending an installed item without `sourceId` or `artifactId` provenance is refused with a clear user message instead of writing malformed manifest data.
- [ ] `writeManifest('project', ...)` appends the project `state.json` path to an existing `.gitignore` while never gitignoring `manifest.json`.

## AI Validation Log

