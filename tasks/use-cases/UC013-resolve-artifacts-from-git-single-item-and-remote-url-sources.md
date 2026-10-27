# UC013 - Resolve artifacts from git-single-item and remote-url sources

- id: UC013
- title: Resolve artifacts from git-single-item and remote-url sources
- actor: User
- status: draft
- priority: P2
- linked-tasks: 20, 44
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: Resolve single-item and URL sources

## Description & Business Value
Allows registering a Git repository whose root is a single standalone artifact (git-single-item) or a raw HTTP(S) file URL (remote-url) and resolving it into the standard Package/Artifact pipeline. Source: tasks/specs/phase-4-spec.md §6

## Preconditions
- A single-artifact Git repository or raw artifact URL is available.

## Scenario / Interaction Steps
1. The user registers a git-single-item or remote-url source.
2. gitSingleItem clones/checks out the repository with input validation and detects the root artifact kind via detect.ts helpers.
3. remoteUrl fetches and caches the remote file by content hash and exposes the artifact for installation.

## Automated Verification Command
```bash
node --test out/sources/gitSingleItem.test.js out/sources/sources.test.js
```

## Acceptance Criteria
- [ ] `resolveGitSingleItem` treats the repository root as a single artifact, reuses `KeyedMutex`, and validates URLs, refs, and source IDs before invoking `git`.
- [ ] `resolveRemoteUrl` fetches and caches a standalone artifact over HTTP(S) and exposes it as a single-item `Package`.
- [ ] Both resolvers conform to the `SourceResolver` interface and integrate with discovery and install flows.

## AI Validation Log

