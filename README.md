# AI Swissknife (VS Code Extension)

**AI Swissknife** is a universal cross-assistant package manager, marketplace, and editor extension for AI coding tools (**Claude Code**, **Kilo Code**, **GitHub Copilot**, **OpenAI Codex CLI**, and **Google Gemini CLI**). It allows you to register custom repositories, browse available components, translate them losslessly between assistants, install them transactionally with full rollback safety, create/edit them via a structured Form Editor, sync them across environments, track local drift/updates, and monitor everything via a visual Dashboard.

---

## Supported Artifacts & Formats

| Kind | Claude Code (`claude-code`) | Kilo Code (`kilo-code`) | GitHub Copilot (`github-copilot`) | Codex CLI (`codex-cli`) | Gemini CLI (`gemini-cli`) |
| --- | --- | --- | --- | --- | --- |
| **Skills** | `.claude/skills/<name>/SKILL.md` | `.kilo/skills/<name>/SKILL.md` | `.github/skills/<name>/SKILL.md` | `.codex/skills/<name>/SKILL.md` | `.gemini/skills/<name>/SKILL.md` |
| **Agents** | `.claude/agents/<name>.md` (`tools: [...]`) | `.kilo/agents/<name>.md` (`permission: {...}`) | `.github/agents/<name>.agent.md` | `.codex/agents/<name>.toml` | `.gemini/agents/<name>.md` |
| **Commands** | `.claude/commands/<name>.md` | `.kilo/command/<name>.md` (Strict E77 schema) | `.github/prompts/<name>.prompt.md` | `.codex/prompts/<name>.md` (import) | `.gemini/commands/<name>.toml` |
| **MCP Servers** | `.mcp.json` / `~/.claude/settings.json` | `.kilo/mcp.json` / `~/.config/kilo/mcp.json` | `.vscode/mcp.json` / `~/.copilot/mcp.json` | `.codex/config.json` | `.gemini/settings.json` |
| **Hooks** | `.claude/hooks/<name>.json` | `.kilo/hooks/<name>.json` | `.github/hooks/<name>.json` | `.codex/hooks/<name>.json` | `.gemini/hooks/<name>.json` |
| **Rules** | `CLAUDE.md` / `~/.claude/CLAUDE.md` | `CLAUDE.md` / `~/.config/kilo/AGENTS.md` | `.github/copilot-instructions.md` | `AGENTS.md` | `GEMINI.md` |

---

## Supported Source Types

1. **`local-folder`**: Local directories containing skills, agents, commands, MCP servers, hooks, or rules.
2. **`git-custom`**: Arbitrary Git repositories (HTTPS/SSH) with branch, tag, or commit pins.
3. **`git-marketplace`**: Plugin marketplace repositories parsing `.claude-plugin/marketplace.json` or `marketplace-skills.json`.
4. **`git-single-item`**: Repositories where the root itself is a standalone component.
5. **`remote-url`**: Raw HTTP(S) URLs (e.g. gists or individual raw component files).

---

## Extension Views & Features

The extension adds an **AI Swissknife** container to the Activity Bar (`resources/icon.svg`) containing three Tree Views, a Dashboard, and a Form Editor:

```text
AI Swissknife (Activity Bar)
├── 📁 Sources      (Manage global & project source manifests)
├── 📦 Available    (Browse detected artifacts with folder hierarchy & batch install)
├── ✅ Installed    (View installed items, drift badges, unmanaged items, sync & edit)
├── 📊 Dashboard    (Open visual management dashboard with search, metrics & bulk actions)
└── 📝 Form Editor  (Structured visual creation and editing for any component kind)
```

### Key Capabilities

- **Transactional Install Engine**: `resolve → plan → preview → apply → verify` with atomic directory staging, backup, proven rollback, and SHA-256 integrity verification.
- **Cross-Assistant Translation**: Lossless format translation between Claude, Kilo, Copilot, Codex, and Gemini with explicit diagnostic reporting.
- **Structured Form Editor**: Visual UI for editing and authoring skills, agents (mode, tools, permissions, model), commands, and MCP servers without writing raw YAML/TOML frontmatter.
- **Cross-Assistant Sync**: 1-click duplication and translation of components between different assistants and scopes (`global` ↔ `project`).
- **Non-Destructive Demarcated Rule Merge**: Safely injects managed instructions into `CLAUDE.md`/`AGENTS.md` using `<!-- ai-swissknife:managed -->` markers without destroying existing user rules.
- **Drift & Upstream Update Detection**: Tracks whether installed files have been modified locally or if a newer version is available upstream.
- **Unmanaged Discovery & Promotion**: Discovers manually created files and provides 1-click promotion to managed status with source matching feedback (`identical`, `differs`, `local only`).
- **Debounced File Watchers**: Reacts automatically to filesystem changes in all assistant directories in real time.

---

## Persistence Layout

- **Manifest** (`.vscode/ai-swissknife/manifest.json` for project, `~/.ai-swissknife/manifest.json` for global): Shared, version-controllable intent listing desired sources and requested installations. All local paths are stored relative to workspace/home.
- **State** (`.vscode/ai-swissknife/state.json` for project, `~/.ai-swissknife/state.json` for global): Machine-local record of applied `ManagedInstallation` entries with content hashes (`contentHash`) and Git revision provenance (`sourceRevision`).
- **Cache** (`~/.ai-swissknife/cache/sources/<sourceId>/`): Local Git cache directories managed with per-directory mutexes (`KeyedMutex`).

---

## Development & Verification

### Commands

```bash
# Run linter
npm run lint

# Run type checker
npm run typecheck

# Run full test suite (152 tests covering all adapters, translators, engine, sources, and UI)
npm test

# Build extension bundle with esbuild (emits dist/extension.js)
npm run build

# Package extension as VSIX
npx @vscode/vsce package --no-dependencies
```
