# 19 — `hook` kind + active `rule` merge — Implementation plan

> **Derived from spec:** [`../specs/phase-4-spec.md`](../specs/phase-4-spec.md) §5 · [`../../SPEC.md`](../../SPEC.md) §1, §5

Tasks (each = one commit):

1. **[19.1 — Hook path verification spike](19.1-hook-path-verification.md)**: **no adapter code** — close `SPEC.md` §5's contradicted-sources risk for Claude Code and GitHub Copilot hook paths by direct verification, and record the finding as a locked-in decision in `CONTEXT.md` before any later task in this initiative starts.
2. **[19.2 — `CanonicalHook` model & Claude/Copilot adapters](19.2-hook-adapter.md)**: implement the canonical model and parse/serialize functions at the paths 19.1 confirmed.
3. **[19.3 — Non-destructive `rule` merge policy](19.3-rule-merge-policy.md)**: implement the demarcated-block merge policy for installing/syncing a `rule`, wire it into the install engine (`rule` becomes an actual install/sync target, no longer dormant).
4. **[19.4 — UI integration for hook & rule](19.4-hook-rule-ui.md)**: expose both kinds in Available/Installed views and verify end-to-end.

**Task 19.1 gates 19.2**: do not start 19.2 until 19.1's findings are recorded — this mirrors the same discipline already applied to the Phase-1 hardening gate (`CONTEXT.md`).
