# AI Swissknife (VS Code Extension)

**AI Swissknife** is a cross-assistant package manager and marketplace extension for AI coding tools (**Claude Code**, **Kilo Code**, and **GitHub Copilot**). It allows you to register custom skill/agent/command/MCP repositories (Git, Marketplace feeds, or local folders), browse available components, translate them losslessly between assistants, install them transactionally with full rollback safety, track local drift/updates, and manage unmanaged artifacts via a dedicated Dashboard.

---

## Supported Artifacts & Formats

| Kind | Claude Code (`claude-code`) | Kilo Code (`kilo-code`) | GitHub Copilot (`github-copilot`) |
| --- | --- | --- | --- |
| **Skills** | `.claude/skills/<name>/SKILL.md` | `.kilo/skills/<name>/SKILL.md` | `.github/skills/<name>/SKILL.md` |
| **Agents** | `.claude/agents/<name>.md` (`tools: [...]`) | `.kilo/agents/<name>.md` (`permission: {...}`) | `.github/agents/<name>.agent.md` |
| **Commands** | `.claude/commands/<name>.md` | `.kilo/command/<name>.md` (Strict E77 schema) | `.github/prompts/<name>.prompt.md` |
| **MCP Servers** | `.mcp.json` / `~/.claude/settings.json` | `.kilo/mcp.json` / `~/.config/kilo/mcp.json` | `.vscode/mcp.json` / `~/.copilot/mcp.json` |
| **Rules** | `CLAUDE.md` / `~/.claude/CLAUDE.md` | `CLAUDE.md` / `~/.config/kilo/AGENTS.md` | `.github/copilot-instructions.md` |

---

## Supported Source Types

1. **`local-folder`**: Local directory containing skills, agents, commands, or MCP servers.
2. **`git-custom`**: Arbitrary Git repository with branch, tag, or commit pins.
3. **`git-marketplace`**: Plugin marketplace repositories parsing `.claude-plugin/marketplace.json` or `marketplace-skills.json`.

---

## Extension Views & Architecture

The extension adds an **AI Swissknife** container to the Activity Bar (`resources/icon.svg`) containing three Tree Views and a Dashboard Webview:

```text
AI Swissknife (Activity Bar)
├── 📁 Sources      (Manage global & project source manifests)
├── 📦 Available    (Browse detected artifacts with folder hierarchy & batch install)
├── ✅ Installed    (View installed items, drift badges, and unmanaged items)
└── 📊 Dashboard    (Open visual management dashboard with search and bulk actions)
```

### Advanced Management Features (Phase 3)

- **Drift & Update Detection**: Compares installed items against live disk state and remote sources (`up-to-date`, `modified-locally`, `update-available`, `modified-and-update-available`, `missing-on-disk`).
- **Inventory Discovery & Promotion**: Automatically discovers unmanaged artifacts created manually in assistant folders and allows 1-click promotion to managed installations.
- **Debounced File Watchers**: Reacts in real time when files in assistant directories are added, modified, or deleted externally.
- **Management Dashboard**: Visual Webview panel with metrics, search bar, kind filters, drift badges, and action triggers.

### Persistence Layout

- **Manifest** (`.ai-swissknife/manifest.json`): Shared, version-controllable intent listing desired sources and requested installations. All local paths are stored relative to workspace/home.
- **State** (`.ai-swissknife/state.json`): Machine-local record of applied `ManagedInstallation` entries with content hashes (`contentHash`) and Git revision provenance (`sourceRevision`).
- **Cache** (`~/.ai-swissknife/cache/sources/<sourceId>/`): Local Git cache directories managed with per-directory mutexes (`KeyedMutex`).

---

## Development & Verification

### Commands

```bash
# Run linter
npm run lint

# Run type checker
npm run typecheck

# Run full test suite (127 tests covering all adapters, translators, engine, sources, and UI)
npm test

# Build extension bundle with esbuild (emits dist/extension.js)
npm run build

# Package extension as VSIX
npx @vscode/vsce package --no-dependencies
```
