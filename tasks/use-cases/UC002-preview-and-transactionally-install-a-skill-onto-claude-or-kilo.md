# UC002 - Preview and transactionally install a skill onto Claude or Kilo

- id: UC002
- title: Preview and transactionally install a skill onto Claude or Kilo
- actor: User
- approval: proposed
- priority: P1
- linked-tasks: 03.1, 03.2, 03.3, 03.4, 05.1, 05.2, 06.1, 06.2, 07.1, 07.2, 07.3
- verification-type: automated-probe
- last-tested: -
- last-verdict: -
- short: Install skill transactionally

## Description & Business Value
Enables a developer to plan, preview, and transactionally install a resolved skill onto Claude Code or Kilo Code at global or project scope, with atomic directory staging, rollback safety, and SHA-256 provenance tracking in state.json. Source: tasks/specs/foundations.md §Goal

## Preconditions
- A registered source contains at least one resolved skill artifact.

## Scenario / Interaction Steps
1. The user selects a skill and chooses target assistant (Claude Code or Kilo Code) and scope (global or project).
2. The engine computes a read-only install plan with proposed target files, translation diagnostics, and conflict detection without mutating disk.
3. Upon user confirmation, applyInstall stages the skill directory, verifies SHA-256 hashes and target-tree snapshot, swaps it into place (.claude/skills/<name> or .kilo/skills/<name>), and records the ManagedInstallation in state.json.

## Automated Verification Command
```bash
node --test out/engine/install.test.js out/translator/skill.test.js
```

## Acceptance Criteria
- [ ] `planInstall` is read-only and produces proposed file paths, conflict flags, and canonical content hash without mutating target assistant directories.
- [ ] `applyInstall` refuses execution if the content hash or target directory snapshot changed after the preview plan was computed, or if the target is a symlink.
- [ ] Skills install to `.claude/skills/<name>/SKILL.md` (`~/.claude/skills/<name>/SKILL.md` globally) for Claude Code and `.kilo/skills/<name>/SKILL.md` (`~/.kilo/skills/<name>/SKILL.md` globally) for Kilo Code.
- [ ] A verified installation records a `ManagedInstallation` entry in `state.json` with `contentHash` and `sourceRevision`; failed verifications roll back and never record state.

## AI Validation Log

