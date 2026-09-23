# Spec — Adapter & source-resolver registries (no more scattered if/switch)

> **Status:** Draft / Accepted for implementation
> **Parent Spec:** [`SPEC.md`](../../SPEC.md) §4 (Canonical model per `ItemKind`)
> and §1 (`Source → Package → Artifact`)
> **Origin:** [`_inbox/analyzed/2026-09-08-refactor-frameworks.md`](../_inbox/analyzed/2026-09-08-refactor-frameworks.md)
> (raw note, verbatim)
> **Pre-requisite:** none functionally — this is an internal refactor of
> already-shipped code (initiatives 01-28), not new user-facing behavior
> beyond 29.4/29.5's config UI.

## 0. Why now

The raw note's complaint — "ora abbiamo la logica sparsa in un sacco di
punti" (the [assistant → adapter] logic is scattered across a lot of
places) — is not a vague impression; it is a real, quantifiable pattern
found by grepping the real code on 2026-09-08:

- The **exact same** `getAdapter(assistant, homeRoot?)` function — an
  `if`-chain picking a `new XAdapter(() => homeRoot)` when a `homeRoot` is
  given, else the module-level singleton — is copy-pasted **verbatim** in
  four files: `src/engine/discovery.ts:41-55`, `src/engine/drift.ts:33-46`,
  `src/engine/sync.ts:36-49`, and `src/ui/formEditor.ts` (same shape,
  confirmed at its `getAdapter` definition).
- A second shape — a 5-way ternary picking an adapter **without** a
  `homeRoot** branch — is independently hand-written in at least four more
  places: `src/ui/installedView.ts` (`removeManagedInstallation`),
  `src/ui/availableView.ts` (two call sites, `installArtifact`'s target and
  origin adapters), `src/ui/recommendations.ts:34-40` (which additionally
  constructs **fresh** `new KiloAdapter()`/`new CopilotAdapter()`/etc.
  instances instead of reusing the existing singletons), and
  `src/engine/apply.ts:338-347`.
- The literal array `['claude-code', 'kilo-code', 'github-copilot',
  'codex-cli', 'gemini-cli']` (as a plain array or `as const` for a
  `showQuickPick`) is duplicated **nine times**, confirmed via
  `grep -rn "'claude-code', 'kilo-code', 'github-copilot', 'codex-cli', 'gemini-cli'" src --include="*.ts"`:
  `src/extension.ts:186,263,463`, `src/ui/installedView.ts:575,712`,
  `src/ui/availableView.ts:578,743`, `src/engine/discovery.ts:77`.
- No file aggregates the five adapter singletons
  (`claudeAdapter`/`kiloAdapter`/`copilotAdapter`/`codexAdapter`/
  `geminiAdapter`, each exported from its own `src/adapters/*.ts`) into one
  list — there is no `src/adapters/index.ts` at all
  (`ls src/adapters/` has no `index.ts`).
- Icon lookup is a fifth, independent switch: `src/ui/assistantIcons.ts`'s
  `getAssistantIconPath` (SVG-`Uri`-based, used for `QuickPickItem.iconPath`
  today).
- The same shape exists on the `Source` side: `src/ui/sourcesView.ts`'s
  `getSourceTypeIcon(type: Source['type'])` is its own standalone
  `switch`, and the "which resolver function for this `source.type`"
  `if`/`else-if` chain (`resolveLocalFolder` / `resolveGitCustom` /
  `resolveGitMarketplace` / `resolveGitSingleItem` / `resolveRemoteUrl`) is
  duplicated at minimum in `src/engine/discovery.ts:225-236` and
  `src/ui/availableView.ts` (its own catalog-refresh resolution loop) —
  confirmed via `grep -n "resolveLocalFolder\|resolveGitCustom\|resolveGitMarketplace\|resolveGitSingleItem\|resolveRemoteUrl" src/ui/availableView.ts`.

None of this is a hypothetical "might get messy" — it is nine duplicated
literal arrays, four verbatim-duplicated functions, and five independently
hand-written ternaries/switches, all encoding the exact same two mappings
(`AssistantId → Adapter` and `SourceType → resolver`) today. Every time a
6th assistant or 6th source type is added, all of these must be
hand-updated in lockstep, with no compiler error if one is missed (a typo'd
literal array silently omits an assistant everywhere that code path is
exercised).

**What already exists and does *not* need to be invented:** the `Adapter`
interface (`src/adapters/types.ts:69-100+`) already **is** the "framework
provides name/icon/patching logic/folders" abstraction the note describes
— `skillDir`/`agentPath`/`commandPath`/`mcpConfigPath` already take a
`LocationRef { scope, projectRoot }` and return the right global-vs-project
path per assistant, and `readonly assistant: AssistantId` is already on
every one of the five classes. The gap is not the abstraction — it's that
nothing aggregates the five implementations into one iterable registry, and
the interface doesn't yet carry the two purely descriptive fields (display
name, icon) every UI call site currently re-derives ad hoc.

## 1. Goals & scope

1. **One registry to iterate, not a hand-written literal per call site.**
   `src/adapters/registry.ts` exports `ALL_ADAPTERS: readonly Adapter[]`
   (built once from the five existing singletons) and lookup helpers; every
   current duplicate collapses into a call against this one module.
2. **`Adapter` gains the two fields every call site currently re-derives
   separately:** `displayName: string` and `iconId: string` (the icon-font
   id already declared in `package.json`'s `contributes.icons` — see
   Locked-in decisions).
3. **Adding a 6th assistant becomes: implement `Adapter`, add it to
   `ALL_ADAPTERS`, add its `package.json` view/icon entries.** Not: hunt
   down and update nine literal arrays and five hand-written
   switches/ternaries across `src/engine/` and `src/ui/`.
4. **A user-facing "which assistants are active" config**, surfaced as a
   native VS Code setting (see Locked-in decisions) plus a small dedicated
   command for discoverability, gating the corresponding sidebar view's
   visibility.
5. **The same treatment for `Source.type`**: a `SourceResolver` object per
   type (`type`, `displayName`, `iconThemeId`, `resolve`,
   `resolveArtifactContent`), aggregated into `src/sources/registry.ts`'s
   `ALL_SOURCE_RESOLVERS`, replacing the `if`/`else-if` dispatch chains and
   `sourcesView.ts`'s icon `switch`.

## 2. Non-goals (explicit, to prevent scope creep)

- **`package.json`'s static `contributes.*` declarations still enumerate
  each assistant by id.** VS Code's extension manifest is plain JSON
  evaluated by the Extension Host before any of this extension's code
  runs — there is no way to generate `contributes.views`/`commands`/`menus`
  entries from a runtime array. Adding a 6th assistant will still require
  adding its view/icon-font entries to `package.json` by hand; what this
  refactor eliminates is everything *downstream* of that — the ~15
  TypeScript call sites that currently re-derive the same 5-id list or
  id→adapter mapping in code.
- **No rewrite of any adapter's actual read/write/list logic.**
  `ClaudeAdapter`/`KiloAdapter`/`CopilotAdapter`/`CodexAdapter`/
  `GeminiAdapter`'s existing methods (`skillDir`, `readSkill`, etc.) are
  untouched — this refactor only adds two new fields to the interface/
  classes and centralizes *lookup*, never changes what an adapter does
  once you have one.
- **No change to the install/translate pipeline's method signatures.**
  `planInstall`/`applyInstall`/`planSync` (`src/engine/`) keep taking an
  `Adapter` exactly as they do today; only *how that `Adapter` instance is
  obtained* at each call site changes (via the registry instead of a local
  ternary).
- **No per-workspace override of enabled assistants.** The setting is a
  single VS Code configuration key; whether it ends up resolvable at
  `workspace`-scope in addition to `user`-scope is a `package.json` detail
  decided in task 29.4, but there is no *separate* per-project enable list
  layered on top the way `Source`/`ManagedInstallation` have global+project
  scope — that model is deliberately not reused here (see Locked-in
  decisions).
- **No removal of the SVG icon files (`resources/claude.svg`,
  `resources/kilocode-light.svg`, etc.) or `getAssistantIconPath` in this
  pass**, even though 29.1/29.5 make them redundant for the call sites this
  spec touches. Confirming there is no other consumer and deleting dead
  assets is a trivial, separate follow-up — bundling it here would let an
  unrelated "is this really unused everywhere" check block the actual
  registry work.
- **No equivalent enable/disable config for source types.** The note's
  "stesso approccio" (same approach) for sources refers to the *registry*
  pattern (one object per type, iterate instead of branch), not the config
  UI — there is no product reason given to let a user disable, say,
  `remote-url` sources, and inventing one is out of scope here.

## 3. Locked-in decisions

- **"Framework" and "Adapter" are the same entity — enrich `Adapter` in
  place, do not introduce a parallel wrapping class.** *Why:* explicit user
  decision when asked to choose between (a) a new `Framework` class
  composing an existing `Adapter` instance as a field, vs. (b) merging
  `Adapter`'s methods into a new class entirely: *"io ho chiamato
  framework, ma se preferisci chiama adapter. Comunque credo sia la stessa
  entità"* (I called it framework, but call it adapter if you prefer —
  either way I think it's the same entity). This also keeps the blast
  radius to additive interface fields, never touching the five adapter
  classes' existing methods or any of their current consumers in the
  hardening-gated install/translate pipeline (`src/engine/apply.ts`,
  `plan.ts`, `sync.ts`, `drift.ts` — all already through two hardening
  review rounds per `tasks/CONTEXT.md`).
- **The "enabled assistants" list lives in a native VS Code setting
  (`contributes.configuration`), not the shared git-tracked
  `manifest.json`.** *Why:* explicit user choice between the two — a
  native setting gets the Settings-UI editor for free, and matches VS
  Code's own user/workspace scope distinction; the manifest alternative
  would put a personal "which of my 5 assistants do I even have installed"
  preference inside the file `Source`/`ManagedInstallation` deliberately
  share with a team via git (`tasks/CONTEXT.md`'s locked-in
  global+project-scope model), risking one teammate's choice silently
  overwriting another's. This will be the **first**
  `contributes.configuration` this extension declares — confirmed via
  `grep -n '"configuration"' package.json` returning nothing before this
  initiative.
- **`iconId` is the existing custom icon-font id, not a new asset.**
  `package.json`'s `contributes.icons` already declares
  `ai-swissknife-claude-code` / `-kilo-code` / `-github-copilot` /
  `-codex-cli` / `-gemini-cli` (`fontPath: resources/icon-font/ai-swissknife-icons.woff`).
  `Adapter.iconId` is exactly this string, consumed via
  `new vscode.ThemeIcon(iconId)`. *Why:* this exact mechanism is already
  confirmed working for `TreeItem.iconPath` in production (fixed and
  verified 2026-09-08, see `tasks/_reviews/` history or `git log` around
  that date for "fix broken codicon-in-text") — unlike `$(icon-id)` typed
  directly into a `TreeItem.label`/`description` string, which does
  **not** render (VS Code only expands that syntax in `QuickPickItem`
  fields, `StatusBarItem.text`, and a `MarkdownString` with
  `supportThemeIcons`). `QuickPickItem.iconPath` also accepts a
  `ThemeIcon` (not only a `Uri`/`{light,dark}` pair), so the same `iconId`
  covers every current consumer (`TreeItem`s and the assistant-picker
  `QuickPick`s) without needing two representations.
- **`displayName` values match the existing sidebar view names verbatim**
  (`Claude Code`, `Kilo Code`, `GitHub Copilot`, `Codex CLI`, `Gemini
  CLI` — `package.json`'s `contributes.views` under `aiSwissknife`). *Why:*
  these are already the names the user sees in the sidebar section
  headers; introducing a second, slightly-different wording for the same
  assistant in a QuickPick or a settings description would be a needless
  inconsistency.
- **Package.json's per-assistant `contributes.views` entries gain a
  `"when"** clause keyed to a context key this extension sets itself**
  (e.g. `"when": "aiSwissknife.enabled.claude-code"`), not conditional
  registration in `extension.ts`.** *Why:* `contributes.views` is
  evaluated by VS Code before extension code runs — there is no API to
  register/unregister a view contribution point at runtime. The one
  runtime lever VS Code exposes over a declarative `when` clause is a
  context key, set via `vscode.commands.executeCommand('setContext', key,
  value)`; `extension.ts` sets one such key per assistant at activation
  (from the config) and again on `vscode.workspace.onDidChangeConfiguration`
  for the setting, so unchecking an assistant hides its sidebar section
  without a window reload.
- **Task 30 (source-resolver registry) proceeds independently of task 29**
  — same pattern, no code dependency between them (adapters and source
  resolvers are unrelated modules). *Why:* lets either be delegated/started
  first without blocking the other; listed as two initiatives instead of
  one purely for independent verification, per this project's own "task
  granularity = one independently-verifiable unit" rule
  (`tasks/AGENTS.md`).

## 4. Design

### 4.1 `Adapter` interface additions (`src/adapters/types.ts`)

```ts
export interface Adapter {
  readonly assistant: AssistantId;
  readonly displayName: string; // NEW
  readonly iconId: string;      // NEW — package.json contributes.icons id
  // ...existing skillDir/readSkill/... methods, unchanged
}
```

### 4.2 `src/adapters/registry.ts` (new file)

```ts
import { claudeAdapter, ClaudeAdapter } from './claude';
import { kiloAdapter, KiloAdapter } from './kilo';
import { copilotAdapter, CopilotAdapter } from './copilot';
import { codexAdapter, CodexAdapter } from './codex';
import { geminiAdapter, GeminiAdapter } from './gemini';
import type { Adapter } from './types';
import type { AssistantId } from '../domain/types';

export const ALL_ADAPTERS: readonly Adapter[] = [
  claudeAdapter, kiloAdapter, copilotAdapter, codexAdapter, geminiAdapter,
];

export function getAdapter(id: AssistantId): Adapter {
  const found = ALL_ADAPTERS.find((a) => a.assistant === id);
  if (!found) throw new Error(`Unsupported assistant: ${id}`);
  return found;
}

// Replaces the four verbatim-duplicated getAdapter(assistant, homeRoot?)
// functions that construct a fresh instance when homeRoot is supplied
// (src/engine/discovery.ts, drift.ts, sync.ts, src/ui/formEditor.ts).
export function getAdapterWithHomeRoot(id: AssistantId, homeRoot: string): Adapter {
  const ctor = { 'claude-code': ClaudeAdapter, 'kilo-code': KiloAdapter,
    'github-copilot': CopilotAdapter, 'codex-cli': CodexAdapter,
    'gemini-cli': GeminiAdapter }[id];
  return new ctor(() => homeRoot);
}
```

Exact shape of `getAdapterWithHomeRoot` (a lookup table of constructors vs.
an `if`-chain of `new`) is an implementation detail for 29.2 to settle by
matching each adapter class's real constructor signature — confirmed
identical across the four duplicated copies today
(`(homeRootFn: () => string)`), but 29.2 must re-verify against the actual
files before assuming the table approach type-checks cleanly.

### 4.3 `src/sources/types.ts` — `SourceResolver` (new interface)

```ts
export interface SourceResolver {
  readonly type: SourceType;
  readonly displayName: string;
  readonly iconThemeId: string; // vscode.ThemeIcon id, e.g. 'repo', 'link'
  resolve(source: Source, opts?: { cacheDir?: string }): Promise<SourceResolution>;
  resolveArtifactContent(
    source: Source,
    pkg: Package,
    artifact: Artifact,
    opts?: { cacheDir?: string }
  ): Promise<ResolvedArtifact<CanonicalSkill | CanonicalAgent | CanonicalCommand | CanonicalMcpServer | CanonicalHook | CanonicalRule>>;
}
```

Confirmed 2026-09-08 (`grep -n "^export async function resolve" src/sources/*.ts`
then reading each signature): all five `resolveArtifactContent` exports
already take `(source, pkg, artifact, opts?)` and return the same
`Promise<ResolvedArtifact<...>>` union — `gitCustom.ts`'s
`GitCustomResolveOptions` and `gitMarketplace.ts`'s
`GitMarketplaceResolveOptions` are both structurally just `{cacheDir?:
string}`, identical to `gitSingleItem.ts`/`remoteUrl.ts`'s inline type;
`localFolder.ts`'s omits `opts` entirely, which is a strict subtype (a
3-param function is assignable to a 4-optional-param type). Likewise every
`resolveXxx(source, opts?)` main resolver — `resolveLocalFolder` just omits
the always-optional `opts`. No signature reconciliation is needed; task
30.2 wraps the existing exports as-is.

`iconThemeId` reuses the *existing* built-in `ThemeIcon` ids already chosen
in `sourcesView.ts`'s `getSourceTypeIcon` (`folder`, `repo`, `extensions`,
`git-commit`, `link`) — these are stock VS Code codicons, not the custom
`ai-swissknife-*` font, so no `package.json` change is needed on this side.

### 4.4 `src/sources/registry.ts` (new file)

Same shape as `adapters/registry.ts`: `ALL_SOURCE_RESOLVERS:
readonly SourceResolver[]` wrapping the five existing modules'
`resolveXxx`/`resolveArtifactContent` exports (kept exported as-is —
additive wrapper objects, not a rename), plus `getSourceResolver(type):
SourceResolver`.

### 4.5 Enabled-assistants config

- `package.json` → `contributes.configuration`:
  ```json
  {
    "title": "AI Swissknife",
    "properties": {
      "aiSwissknife.enabledAssistants": {
        "type": "array",
        "items": { "type": "string", "enum": ["claude-code", "kilo-code", "github-copilot", "codex-cli", "gemini-cli"] },
        "default": ["claude-code", "kilo-code", "github-copilot", "codex-cli", "gemini-cli"],
        "description": "Which AI assistants show their own sidebar section and appear in assistant pickers."
      }
    }
  }
  ```
- `getEnabledAdapters(): Adapter[]` (in `src/adapters/registry.ts`) reads
  `vscode.workspace.getConfiguration('aiSwissknife').get<AssistantId[]>('enabledAssistants')`
  and filters `ALL_ADAPTERS`.
- `extension.ts`'s `activate()` builds the five
  `AssistantTreeDataProvider`/view registrations by iterating
  `ALL_ADAPTERS` (not five hand-written `const xProvider = new
  AssistantTreeDataProvider(...)` lines) and sets one `aiSwissknife.enabled.<id>`
  context key per adapter from `getEnabledAdapters()`, refreshed on
  `vscode.workspace.onDidChangeConfiguration`.
- Each `contributes.views` entry for
  `aiSwissknife.installed.<assistant-id>` gains `"when":
  "aiSwissknife.enabled.<assistant-id>"`.
- New command `aiSwissknife.configureEnabledAssistants`: a
  `showQuickPick(ALL_ADAPTERS.map(a => ({ label: a.displayName, picked:
  enabled.includes(a.assistant) })), { canPickMany: true })`, writing the
  selection back via `vscode.workspace.getConfiguration('aiSwissknife').update('enabledAssistants', ids, vscode.ConfigurationTarget.Global)`.

## 5. Grounding references

- Verbatim-duplicated `getAdapter(assistant, homeRoot?)`:
  `src/engine/discovery.ts:41-55`, `src/engine/drift.ts:33-46`,
  `src/engine/sync.ts:36-49`, `src/ui/formEditor.ts` (same
  `getAdapter` shape, confirmed 2026-09-08).
- Independent 5-way adapter ternaries: `src/ui/installedView.ts`
  (`removeManagedInstallation`), `src/ui/availableView.ts` (`installArtifact`,
  two call sites), `src/ui/recommendations.ts:25-40` (constructs fresh
  adapter instances rather than reusing singletons), `src/engine/apply.ts:338-347`.
- Nine duplicated literal 5-id arrays: `grep -rn "'claude-code', 'kilo-code', 'github-copilot', 'codex-cli', 'gemini-cli'" src --include="*.ts"`
  → `src/extension.ts:186,263,463`, `src/ui/installedView.ts:575,712`,
  `src/ui/availableView.ts:578,743`, `src/engine/discovery.ts:77`.
- No adapter barrel file: `ls src/adapters/` (no `index.ts`); five separate
  singleton exports confirmed via
  `grep -n "^export const" src/adapters/*.ts`.
- `Adapter` interface: `src/adapters/types.ts:69-100+`. Five classes'
  `readonly assistant` + singleton export line numbers: `claude.ts:352,768`,
  `kilo.ts:240,704`, `copilot.ts:24,428`, `codex.ts:19,432`, `gemini.ts:19,404`.
- Existing icon-font contribution: `package.json`'s `contributes.icons`
  (`ai-swissknife-claude-code`/`-kilo-code`/`-github-copilot`/`-codex-cli`/
  `-gemini-cli`, `fontPath: resources/icon-font/ai-swissknife-icons.woff`).
  No `contributes.configuration` exists yet: `grep -n '"configuration"' package.json` → no match.
- `getAssistantIconPath` (SVG-`Uri`-based, still used for `QuickPickItem.iconPath`
  today): `src/ui/assistantIcons.ts`.
- `$(icon-id)` does not render in `TreeItem.label`/`description` (only
  `QuickPickItem` fields, `StatusBarItem.text`, and a codicon-aware
  `MarkdownString`); `new vscode.ThemeIcon('ai-swissknife-<id>')` on
  `TreeItem.iconPath` is the confirmed-working mechanism — verified via
  hands-on `.vsix` testing 2026-09-08 after an inline-label attempt showed
  the literal `$(...)` text on screen.
- `Source.type` dispatch duplication: `src/engine/discovery.ts:225-236`
  (`if (source.type === 'local-folder') ... else if ...`),
  `src/ui/availableView.ts` (own catalog-resolution loop, confirmed via
  `grep -n "resolveLocalFolder\|resolveGitCustom\|resolveGitMarketplace\|resolveGitSingleItem\|resolveRemoteUrl" src/ui/availableView.ts`).
- `getSourceTypeIcon` switch: `src/ui/sourcesView.ts` (`folder`, `repo`,
  `extensions`, `git-commit`, `link`, default `source-control`).
- Five resolver modules' exports (`resolveXxx` + `resolveArtifactContent`
  each): `src/sources/localFolder.ts`, `gitCustom.ts`, `gitMarketplace.ts`,
  `gitSingleItem.ts`, `remoteUrl.ts` (`grep -n "^export async function resolve" src/sources/*.ts`).
- Test harness precedent for VS Code-API-touching code:
  `src/ui/ui.test.ts` (hand-rolled `vscode` module mock injected via
  `Module.prototype.require`, `npm test` = `tsc && node --test out`).

## 6. Drives

- Initiative [29 — Adapter registry & config](../29-adapter-registry/plan.md)
- Initiative [30 — Source-resolver registry](../30-source-resolver-registry/plan.md)
