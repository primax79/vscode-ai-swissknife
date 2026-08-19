# Spec — AI Swissknife Phase 2: Expanding Kinds, Sources & Assistants

> **Status:** Draft / Accepted for implementation  
> **Parent Spec:** [`SPEC.md`](../../SPEC.md) · [`foundations.md`](foundations.md)  
> **Pre-requisite:** Phase 1 (Initiatives 01–07) completed and verified.

---

## 1. Goals & Scope of Phase 2

Phase 1 established the end-to-end foundation for **Skills** (`SKILL.md` + auxiliary files) across Claude Code and Kilo Code with git-custom/local-folder sources, immutable preview, atomic install swap, state persistence, and minimal tree UI.

Phase 2 widens the platform along three axes:
1. **Artifact Kinds**: Adding `agent`, `command`, and `mcp-server` alongside `skill`.
2. **Sources**: Adding `git-marketplace` (Claude marketplace and Kilo marketplace feeds), `remote-url`, and `git-single-item`.
3. **Adapters**: Adding **GitHub Copilot** (VS Code native Agent Customization) and dormant hook/rule alignment.

---

## 2. Canonical Models for New Kinds

### 2.1 Agent (`ItemKind = 'agent'`)

An agent defines an interactive persona or subagent with distinct tools, permissions, and instructions.

```ts
export interface CanonicalAgent {
  name: string;
  description: string;
  mode?: 'primary' | 'subagent' | 'all';
  tools: string[];
  permissions: Record<string, 'allow' | 'deny' | 'ask'>;
  model?: string;
  variant?: string;
  body: string; // Markdown system prompt
  extraFields: Record<string, unknown>;
}
```

#### Format Translation Matrix (Claude ↔ Kilo ↔ Copilot)
- **Claude Code**: Frontmatter `name`, `description`, `tools: string[]`, `model`.
- **Kilo Code**: Frontmatter `name`, `description`, `mode: primary|subagent|all`, `permission: { [tool]: 'allow' }`, `model`, `variant`.
  - Mapping: `tools` array translates to `permission` object keys (e.g. `bash` → `permission.bash: allow`, `edit` → `permission.edit: allow`, `read` → `permission.read: allow`).
- **GitHub Copilot**: `*.agent.md` in `.github/agents/`. Frontmatter `name`, `description`, `tools`, `model`, `user-invocable`.

### 2.2 Command (`ItemKind = 'command'`)

A command is a prompt template or slash command invocable in chat sessions.

```ts
export interface CanonicalCommand {
  name: string;
  description: string;
  agent?: string;
  model?: string;
  subtask?: boolean;
  body: string; // Prompt template text / body
  extraFields: Record<string, unknown>;
}
```

#### Format Rules
- **Claude Code**: Markdown file in `.claude/commands/<name>.md` or directory with `COMMAND.md`.
- **Kilo Code**: Markdown file in `.kilo/command/<name>.md` (project) or `~/.config/kilo/command/<name>.md` (global).
  - *Strict Parser Requirement*: Kilo accepts strictly `description`, `agent`, `model`, `subtask`. Unrecognized keys must be pruned from frontmatter into comments or diagnostics to avoid `ConfigInvalidError`.
- **GitHub Copilot**: Prompt files `*.prompt.md` in `.github/prompts/`.

### 2.3 MCP Server (`ItemKind = 'mcp-server'`)

An MCP server is a structured configuration (stdio or http/sse) declaring tools and resources for LLMs.

```ts
export interface CanonicalMcpServer {
  id: string;
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  extraFields?: Record<string, unknown>;
}
```

#### Format & Merge Rules
- Unlike skills/agents (which are discrete files/directories), MCP servers are merged into configuration files (`.mcp.json`, `kilo.jsonc`, `.vscode/mcp.json`).
- **Merge Contract**:
  - `planInstall` parses existing config file, detects if server ID is already configured.
  - `applyInstall` performs an atomic read-modify-write on the JSON/JSONC config file, preserving formatting and comments where possible, and recording the server in `state.json`.

---

## 3. Marketplace Source Resolvers (`git-marketplace`)

A `git-marketplace` source contains a formal catalog manifest pointing to multiple plugins or packages:

1. **Claude Plugin Marketplace**:
   - Location: `.claude-plugin/marketplace.json`
   - Manifest Schema: array of plugins, each with relative path to plugin folder containing `skills/`, `agents/`, `commands/`, or `.mcp.json`.
2. **Kilo Marketplace Feed**:
   - Location: `marketplace-skills.json`
   - Schema: entries with `id`, `description`, `githubUrl`, `content` (list of files or tarball URL).

---

## 4. Phase 2 Initiatives Breakdown

| Initiative | Title | Scope |
| --- | --- | --- |
| **08** | **Agent Artifact Support** | CanonicalAgent model, Claude/Kilo agent adapters, frontmatter translation, install engine & UI integration. |
| **09** | **Command Artifact Support** | CanonicalCommand model, Claude/Kilo command adapters, Kilo strict schema serializer, install engine & UI integration. |
| **10** | **MCP-Server Artifact Support** | CanonicalMcpServer model, JSON/JSONC config merge engine, Claude/Kilo/Copilot MCP adapters, state tracking. |
| **11** | **Marketplace Sources** | Resolver for `.claude-plugin/marketplace.json` and Kilo `marketplace-skills.json` feeds. |
| **12** | **GitHub Copilot Adapter** | Full adapter for `.github/skills/`, `.github/agents/`, `.github/prompts/`, `.vscode/mcp.json`. |
