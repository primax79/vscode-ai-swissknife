# UC023 - Configure which AI assistants are enabled in the sidebar and pickers

- id: UC023
- title: Configure which AI assistants are enabled in the sidebar and pickers
- actor: User
- approval: proposed
- priority: P2
- linked-tasks: 29.1, 29.2, 29.3, 29.4, 29.5, 30.1, 30.2, 30.3, 30.4
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: Configure enabled assistants

## Description & Business Value
Allows a developer to enable or disable any of the five supported AI assistants via VS Code settings (aiSwissknife.enabledAssistants) or the Configure Enabled Assistants command, dynamically toggling per-assistant sidebar sections and picker lists without reloading the window. Source: tasks/specs/adapter-and-source-registries.md §4.5

## Preconditions
- The AI Swissknife extension is active in VS Code.

## Scenario / Interaction Steps
1. The user runs Configure Enabled Assistants or edits aiSwissknife.enabledAssistants in VS Code settings.
2. getEnabledAdapters filters ALL_ADAPTERS according to the setting (defaulting missing keys to enabled).
3. The extension updates the aiSwissknife.enabled.<assistant-id> context keys on activation and configuration change, immediately showing or hiding the corresponding sidebar views and filtering assistant pickers.

## Automated Verification Command
```bash
node --test out/adapters/registry.test.js out/ui/ui.test.js
```

## Acceptance Criteria
- [ ] `ALL_ADAPTERS` and `ALL_SOURCE_RESOLVERS` provide single-source-of-truth registries with `displayName` and `iconId`/`iconThemeId` metadata.
- [ ] `getEnabledAdapters` reads `aiSwissknife.enabledAssistants` (defaulting to all five assistants enabled when unset or when individual boolean keys are omitted).
- [ ] `aiSwissknife.configureEnabledAssistants` updates the global configuration when confirmed in QuickPick and leaves configuration untouched when cancelled.

## AI Validation Log

