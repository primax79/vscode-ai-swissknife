# 09 — Command artifact support — Implementation plan

> **Derived from spec:** [`../specs/phase-2-spec.md`](../specs/phase-2-spec.md) · [`../../SPEC.md`](../../SPEC.md)

Tasks (each = one commit):

1. **[09.1 — CanonicalCommand model and Claude/Kilo command adapters](09.1-command-adapter.md)**: define `CanonicalCommand` in `src/adapters/types.ts`, implement `parseClaudeCommandMarkdown`, `serializeClaudeCommandMarkdown`, `parseKiloCommandMarkdown`, `serializeKiloCommandMarkdown` (strictly respecting Kilo's E77 schema), and command methods (`commandPath`, `readCommand`, `writeCommand`, `listCommands`) in `ClaudeAdapter` and `KiloAdapter`.
2. **[09.2 — Command translator & install engine](09.2-command-translator-engine.md)**: implement `translateCommand`, `canonicalCommandHash`, and extend `planInstall` and `applyInstall` to handle `kind: 'command'`.
3. **[09.3 — Command discovery & UI integration](09.3-command-ui.md)**: detect command markdown files in `localFolder` and `gitCustom` resolvers, display them in Available and Installed views with terminal icon (`terminal`), and enable single and batch installation.
