# UC006 - Resolve multi-plugin catalogs from git-marketplace sources

- id: UC006
- title: Resolve multi-plugin catalogs from git-marketplace sources
- actor: User
- approval: proposed
- priority: P1
- linked-tasks: 11.1, 11.2, 11.3
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: Resolve marketplace catalog

## Description & Business Value
Enables a developer to register a git-marketplace repository (.claude-plugin/marketplace.json or marketplace-skills.json) and browse its multi-plugin packages and typed artifacts (skills, agents, commands, MCP servers). Source: tasks/specs/phase-2-spec.md §3

## Preconditions
- A Git repository containing .claude-plugin/marketplace.json or marketplace-skills.json is registered as a git-marketplace source.

## Scenario / Interaction Steps
1. The user registers or refreshes a git-marketplace source.
2. The resolver parses the marketplace manifest and enumerates each plugin package and its contained skills, agents, commands, and MCP servers.
3. The user browses the resolved packages and installs any artifact through the standard install pipeline.

## Automated Verification Command
```bash
node --test out/sources/gitMarketplace.test.js
```

## Acceptance Criteria
- [ ] `resolveGitMarketplace` parses `.claude-plugin/marketplace.json` and `marketplace-skills.json` feeds into typed `Package` and `Artifact` structures.
- [ ] `resolveArtifactContent` resolves full canonical content for skills, agents, commands, and MCP servers declared inside marketplace plugins.
- [ ] Missing or malformed plugin paths produce structured resolver diagnostics rather than crashing catalog resolution.

## AI Validation Log

