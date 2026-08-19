# 08 — Agent artifact support — Implementation plan

> **Derived from spec:** [`../specs/phase-2-spec.md`](../specs/phase-2-spec.md) · [`../../SPEC.md`](../../SPEC.md)

Tasks (each = one commit):

1. **[08.1 — CanonicalAgent model and Claude/Kilo agent adapters](08.1-agent-adapter.md)**: define `CanonicalAgent` in `src/adapters/types.ts`, implement `parseAgentMarkdown` / `serializeAgentMarkdown` / `readAgent` / `writeAgent` / `listAgents` in Claude and Kilo adapters, with verified paths (`.claude/agents/<name>.md`, `.kilo/agents/<name>.md` and `.kilo/agent/<name>.md`).
2. **[08.2 — Agent translator & install engine](08.2-agent-translator-engine.md)**: implement `translateAgent(source: CanonicalAgent, target: AssistantId): TranslationResult<CanonicalAgent>` with tool-permission mapping, extend `planInstall` and `applyInstall` to handle `kind: 'agent'`.
3. **[08.3 — Agent detection & UI integration](08.3-agent-ui.md)**: detect agent files in `localFolder` and `gitCustom` resolvers, display agents in Available and Installed views with distinct icons, and enable direct / batch installation.
