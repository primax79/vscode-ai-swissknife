# 19 — `hook` kind + active `rule` merge — Implementation plan

> **Derived from spec:** [`../specs/phase-4-spec.md`](../specs/phase-4-spec.md) §5 · [`../../SPEC.md`](../../SPEC.md) §1, §5

Tasks (each = one commit):

## Tasks

### 19.1 - Hook path verification spike

- **Status:** `delivered` (merged bbc313c 2026-08-19; commit b15de5a; paths recorded in summary.md and SPEC.md 6f3b6cc) · **Short:** Hook path verification spike · **Size:** S · **Kind:** investigation · **Depends on:** 03, 12 · **Spec:** [19.1-hook-path-verification.md](19.1-hook-path-verification.md)
- **Goal:** Verify Claude Code, Kilo Code, and GitHub Copilot hook file paths before implementing the hook adapters.

### 19.2 - `CanonicalHook` model & Claude/Copilot adapters

- **Status:** `delivered` (merged bbc313c 2026-08-19; commit b15de5a) · **Short:** CanonicalHook and hook adapters · **Size:** M · **Depends on:** 19.1 · **Spec:** [19.2-hook-adapter.md](19.2-hook-adapter.md)
- **Goal:** Implement `CanonicalHook` (`name`, `event`, `command`, `timeout`, `extraFields`), `translateHook`, and hook read/write/list in Claude, Kilo, and Copilot adapters.

### 19.3 - Non-destructive `rule` merge policy

- **Status:** `delivered` (merged bbc313c 2026-08-19; commit b15de5a) · **Short:** Demarcated rule merge policy · **Size:** M · **Depends on:** 03, 06, 12 · **Spec:** [19.3-rule-merge-policy.md](19.3-rule-merge-policy.md)
- **Goal:** Implement non-destructive demarcated-block (`<!-- ai-swissknife:managed:${sourceId} -->`) rule merging in the install engine so installing or syncing a `rule` never overwrites surrounding user instructions.

### 19.4 - UI integration for hook & rule

- **Status:** `delivered` (merged bbc313c 2026-08-19; commit b15de5a) · **Short:** Hook and rule UI integration · **Size:** S · **Depends on:** 19.2, 19.3 · **Spec:** [19.4-hook-rule-ui.md](19.4-hook-rule-ui.md)
- **Goal:** Detect `hook` and `rule` files in source resolvers and expose both kinds in Available, Installed, and Dashboard views.

## Gating

**Task 19.1 gates 19.2**: do not start 19.2 until 19.1's findings are recorded — this mirrors the same discipline already applied to the Phase-1 hardening gate (`CONTEXT.md`).
