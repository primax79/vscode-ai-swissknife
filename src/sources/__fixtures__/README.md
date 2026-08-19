# Test Fixtures for Source Resolvers and Detection

This directory contains committed test fixtures used by unit and integration tests for source resolvers (`detect.test.ts`, `localFolder.test.ts`, `gitCustom.test.ts`).

## Provenance & Metadata

- **Origin**: Derived from real skills in the workspace (`agentic-coding-kit`, `cc-swiss-knife`).
- **Capture Date**: 2026-08-19.
- **License**: Apache-2.0 / MIT.
- **Review**: Reviewed for secrets, credentials, and personal paths; all paths and author names are generic.

## Structure

1. `root-skill/`: A standalone skill located at the root of the source directory (`SKILL.md`).
2. `nested-skills/`: A directory containing multiple sibling skills (`skill-a` and `skill-b`), where `skill-b` includes an auxiliary script (`scripts/helper.sh`).
3. `mixed/`: Contains a valid skill (`valid-skill`) beside a malformed candidate (`malformed-skill` with missing name in frontmatter) to verify diagnostic extraction and graceful partial resolution.
