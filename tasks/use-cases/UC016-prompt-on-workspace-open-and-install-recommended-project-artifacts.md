# UC016 - Prompt on workspace open and install recommended project artifacts

- id: UC016
- title: Prompt on workspace open and install recommended project artifacts
- actor: User
- approval: proposed
- priority: P1
- linked-tasks: 22.1, 22.2, 22.3, 22.4, 22.5
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: Install workspace recommendations

## Description & Business Value
Detects unsatisfied project recommendations locally on workspace open without network calls, prompts the developer to install or review them (or dismiss per workspace), and resolves/installs pending recommendations with three-way broken diagnostics. Source: tasks/specs/project-recommendations.md §4.2-4.4

## Preconditions
- A cloned workspace contains desiredInstallations in .vscode/ai-swissknife/manifest.json that are not yet recorded in local state.json.

## Scenario / Interaction Steps
1. On workspace open, the extension compares manifest.json desiredInstallations against local state.json without performing network or git calls.
2. When unsatisfied recommendations exist and ignoreRecommendations is not set in workspaceState, an information prompt offers Install All, Review, or Don't ask again.
3. Choosing Install All or running Install Recommended resolves the referenced sources, classifies entries into satisfied, pending, or broken (source-not-registered, source-resolution-failed, artifact-not-found), and installs each pending artifact to its declared assistant and project scope.

## Automated Verification Command
```bash
node --test out/engine/recommendations.test.js out/ui/ui.test.js
```

## Acceptance Criteria
- [ ] Workspace-open detection is local-only (comparing `manifest.json` against `state.json` without git/network resolution) and honours `aiSwissknife.ignoreRecommendations` in `ExtensionContext.workspaceState`.
- [ ] `resolveRecommendations` classifies entries into `satisfied`, `pending`, and `broken` with three distinct broken reasons: `source-not-registered`, `source-resolution-failed`, and `artifact-not-found`.
- [ ] `installResolvedArtifacts` invokes `planInstall` and `applyInstall` using each entry's own declared `assistant` and `project` scope rather than prompting once for the batch.

## AI Validation Log

