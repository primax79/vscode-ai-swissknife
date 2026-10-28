# UC012 - Install hooks and merge demarcated rules non-destructively

- id: UC012
- title: Install hooks and merge demarcated rules non-destructively
- actor: User
- approval: proposed
- priority: P1
- linked-tasks: 19.1, 19.2, 19.3, 19.4
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: Install hooks and merge rules

## Description & Business Value
Supports installing hook definitions and merging rule artifacts into shared instruction files (CLAUDE.md, AGENTS.md, copilot-instructions.md, GEMINI.md) using demarcated ai-swissknife:managed markers so hand-written user rules are never overwritten. Source: tasks/specs/phase-4-spec.md §5

## Preconditions
- A source provides a hook or rule artifact; the target workspace or global scope may already have a hand-written rule file.

## Scenario / Interaction Steps
1. The user plans and applies a hook or rule installation for a target assistant and scope.
2. For a hook, the engine writes the hook JSON file to the verified assistant hook directory.
3. For a rule, the engine wraps the contributed content in <!-- ai-swissknife:managed:<sourceId> --> markers, appending the block or replacing it in place while preserving all surrounding user content.

## Automated Verification Command
```bash
node --test out/engine/install.test.js out/translator/rule.test.js
```

## Acceptance Criteria
- [ ] Installing a `hook` writes the hook JSON file to the target assistant's hook directory and records it in `state.json`.
- [ ] Installing a `rule` wraps contributed instructions in `<!-- ai-swissknife:managed:<sourceId> -->` ... `<!-- /ai-swissknife:managed -->` markers without altering pre-existing user instructions.
- [ ] Re-installing or updating a `rule` from the same source replaces its demarcated block in place without duplicating content.

## AI Validation Log

