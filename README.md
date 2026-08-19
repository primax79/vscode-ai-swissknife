# AI Swissknife (VS Code Extension)

**AI Swissknife** is a cross-assistant package manager and marketplace extension for AI coding tools (Claude Code, Kilo Code, and upcoming assistants). It allows you to register custom skill/agent repositories (Git or local folders), browse available components, translate them losslessly between assistants, and install them transactionally with full rollback safety.

---

## Current Status (Phase 1)

Phase 1 provides the core end-to-end functionality for **Skills**:

| Component | Capabilities |
| --- | --- |
| **Sources** | `local-folder` and `git-custom` (with branch, tag, or commit pins and concurrency locking). |
| **Adapters** | `claude-code` (`~/.claude/skills/`, `<workspace>/.claude/skills/`) and `kilo-code` (`~/.kilo/skills/`, `<workspace>/.kilo/skills/`). |
| **Artifacts** | `skill` — full canonical directories with `SKILL.md`, nested auxiliary files, scripts, and POSIX file modes (e.g. `chmod 0755`). |
| **Translator** | Lossless translation between Claude Code and Kilo Code; structured per-field diagnostics (`TranslationDiagnostic`). |
| **Install Engine** | Pipeline (`resolve → plan → preview → apply → verify`): pre-flight target inspection (`lstat`, symlink refusal), immutable preview, atomic staged swap, rollback verification, and state tracking. |
| **UI** | Dedicated Activity Bar view container with 3 tree views: **Sources**, **Available**, and **Installed**. |

---

## Extension Views & Architecture

The extension adds an **AI Swissknife** container to the Activity Bar (`resources/icon.svg`) containing three Tree Views:

```text
AI Swissknife (Activity Bar)
├── 📁 Sources      (Manage global & project source manifests)
├── 📦 Available    (Browse detected skills, view diagnostics, install)
└── ✅ Installed    (View installed skills grouped by Assistant × Scope)
```

### Persistence Layout

- **Manifest** (`.ai-swissknife/manifest.json`): Shared, version-controllable intent listing desired sources and requested installations. All local paths are stored relative to workspace/home.
- **State** (`.ai-swissknife/state.json`): Machine-local record of applied `ManagedInstallation` entries with content hashes (`contentHash`) and Git revision provenance (`sourceRevision`).
- **Cache** (`~/.ai-swissknife/cache/sources/<sourceId>/`): Local Git cache directories managed with per-directory mutexes (`KeyedMutex`).

---

## How to Use

### 1. Register a Source

You can add sources via the Command Palette or the Sources view:

- **Command**: `AI Swissknife: Add Source`
- **Supported Types**:
  - `local-folder`: Point to a local directory containing one or more skills.
  - `git-custom`: Provide a Git repository URL (HTTPS/SSH) with optional branch/tag pinning.
- **Scope**:
  - `global`: Stored in `~/.ai-swissknife/manifest.json`.
  - `project`: Stored in `<workspace>/.ai-swissknife/manifest.json` (portable relative path).

### 2. Browse Available Skills & Diagnostics

- Open the **Available** view.
- Click **Refresh Available Catalog** (`aiSwissknife.refreshCatalog`) to fetch latest changes from Git and scan local directories.
- Any malformed frontmatter or unreadable directories are surfaced cleanly as **Diagnostics** in the tree with warning/error icons.

### 3. Install a Skill

1. Click on any skill item in the **Available** view or run `AI Swissknife: Install Skill`.
2. Select the target assistant: **Claude Code** or **Kilo Code**.
3. Select the target scope: **Project** (current workspace) or **Global** (user home).
4. Review the **Preview Modal**: Displays the target directory path, number of proposed files, and any diagnostics.
5. If the skill already exists, choose the conflict policy (**Overwrite** or **Cancel**).
6. Click **Install**:
   - The engine stages files in a temporary directory.
   - Verifies the staged canonical hash.
   - Atomically swaps the target directory (backing up the existing install).
   - Verifies the final directory on disk.
   - Persists the record to `state.json`.
   - Cleans up temporary backup directories.

### 4. Inspect Installed Skills

- The **Installed** view lists all active installations grouped by `Assistant (Scope)` (e.g. `kilo-code (project)`).
- Hover over any item to see the installation timestamp, target path, and commit SHA.

### 5. Remove a Source

- In the **Sources** view, run `AI Swissknife: Remove Source`.
- If active installations or desired entries reference the source, a warning dialog prompts for confirmation (`Remove Anyway`).
- Removing a source cleans the manifest but leaves installed files and state intact to prevent accidental loss.

---

## Development & Verification

### Prerequisites

- Node.js `20.x` or higher
- npm

### Commands

```bash
# Install dependencies
npm install

# Run linter
npm run lint

# Run type checker
npm run typecheck

# Run test suite (69 tests covering adapters, domain, engine, sources, and UI)
npm test

# Build extension bundle with esbuild (emits dist/extension.js)
npm run build
```

### Running in VS Code / Kilo Code

1. Open this repository in VS Code / Kilo Code.
2. Press `F5` to start a new **Extension Development Host** window.
3. In the new window, open the **AI Swissknife** view container in the Activity Bar.

### Packaging as `.vsix`

```bash
npx @vscode/vsce package --no-dependencies
```

This generates `ai-swissknife-0.0.1.vsix` ready to be installed via `Extensions: Install from VSIX...`.
