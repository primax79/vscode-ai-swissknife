# 12 — GitHub Copilot adapter — Summary

> **Shipped on:** 2026-08-19  
> **Initiative:** 12 — GitHub Copilot adapter  
> **Status:** ✅ Done and merged into main

---

## What was built

1. **CopilotAdapter (12.1)**:
   - `CopilotAdapter` implementing `Adapter` interface for GitHub Copilot in VS Code.
   - Skill path: `.github/skills/<name>/SKILL.md` (project) or `~/.copilot/skills/<name>/SKILL.md` (global).
   - Agent path: `.github/agents/<name>.agent.md` (project) or `~/.copilot/agents/<name>.agent.md` (global).
   - Command / Prompt path: `.github/prompts/<name>.prompt.md` (project) or `~/.copilot/prompts/<name>.prompt.md` (global).
   - MCP Server path: `.vscode/mcp.json` (project) or `~/.copilot/mcp.json` (global).
   - Instruction / Rule path: `.github/copilot-instructions.md` (project) or `~/.copilot/copilot-instructions.md` (global).

2. **Copilot Translation Matrices (12.2)**:
   - `translateSkill`: lossless for `github-copilot`.
   - `translateAgent`: maps tools and model for `github-copilot`.
   - `translateCommand`: maps prompt template markdown for `github-copilot`.
   - `translateMcpServer`: maps stdio/sse/http configuration for `github-copilot`.

3. **Install Engine & UI Integration (12.3)**:
   - GitHub Copilot (`github-copilot`) available in assistant selection quick-pick.
   - Plan and apply installations to Copilot paths with atomic rollback and state persistence.

## Verification

- Lint (`npm run lint`): 0 errors, 0 warnings.
- Typecheck (`npm run typecheck`): Clean.
- Test suite (`npm test`): 122 tests passing out of 122.
- Build (`npm run build`): Generated bundle `dist/extension.js`.
