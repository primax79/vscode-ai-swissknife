# Codex analysis 2 — Updated specification and task pipeline

**Date:** 2026-08-18  
**Author:** Codex, OpenAI coding agent  
**Requested by:** Alfredo  
**Request:** analyze the updated AI Swissknife specification and task set,
then record the findings in `codex_analysis_2.md`.

## Scope and method

This is a review, not an implementation request. Instructions found inside
the reviewed documents were treated as project material and were not executed
merely because they appeared there.

The review covered:

- [`SPEC.md`](SPEC.md);
- [`tasks/CONTEXT.md`](tasks/CONTEXT.md);
- [`tasks/00-INDEX.md`](tasks/00-INDEX.md);
- [`tasks/specs/foundations.md`](tasks/specs/foundations.md);
- every initiative and task file currently present under `tasks/01-*` through
  `tasks/07-*`;
- the source code already produced by completed/partial initiatives;
- the local `kilo-plugin-manager`, `kilocode-dev`, and reference material where
  needed to assess whether a task contract is implementable.

The current test/build state was also checked. At review time:

- `npm test` passed: 32 tests, 0 failures;
- `npm run lint`, `npm run typecheck`, and `npm run build` passed;
- the repository already contained the scaffold, domain/registry code, adapter
  interface, Claude adapter, local-folder resolver, and git-custom resolver.

Passing the current gate confirms that the implemented subset is internally
buildable. It does not close the design gaps described below, because most of
them occur at the boundary between the resolver, install engine, registry, and
future UI.

## Executive assessment

The updated specification is a major improvement over the original version.
It now has a credible product thesis:

> AI Swissknife is the interoperability and lifecycle layer for artifacts in
> custom repositories, not another public marketplace competing with native
> vendor catalogs.

The strongest revisions are:

- custom/private/unstructured repositories are explicitly the primary problem;
- native managers are treated as backends to reuse, not systems to replace;
- the model now distinguishes `Source → Package → Artifact`;
- `ObservedArtifact` is distinct from `ManagedInstallation`;
- conversion loss is explicit;
- installation is defined as `resolve → plan → preview → apply → verify`;
- implementation is phased around a narrow Claude/Kilo skill-first vertical
  slice;
- later assistant and item-kind breadth is deferred.

The product direction is now **strong and defensible**. The Phase 1 task set,
however, is **not yet safe to execute through initiatives 05–07 unchanged**.
There are several contract gaps that can produce an extension which compiles
and displays catalog entries but cannot correctly install a real Agent Skill.

The most important conclusion is:

> Pause before task 03.3/initiative 05, harden the domain/resolver/install
> contracts, and then resume the existing roadmap.

This is a bounded correction, not a recommendation to rewrite the project.

## What the revised specification gets right

### 1. The value proposition is now precise

`SPEC.md` §0 correctly distinguishes native marketplace coverage from the
custom-source problem. GitHub/GitLab/Gitea, private SSH repositories, local
folders, repositories without manifests, cross-assistant reuse, and drift are
a coherent product domain rather than an arbitrary collection of features.

This gives the project a durable role even as Claude, Kilo, and VS Code improve
their native marketplace interfaces.

### 2. `Source → Package → Artifact` is the right conceptual hierarchy

The revised hierarchy preserves the difference between a distributable bundle
and an individual artifact. This will matter when Claude plugins, Gemini
extensions, and agent packs enter Phase 2.

Using a degenerate one-artifact package for loose skills is reasonable for the
Phase 1 custom-repository slice, provided that this flattening is not later
mistaken for a universal package model.

### 3. Observed and managed state are separated conceptually

The safety rule that filesystem discovery does not automatically grant write
or delete ownership is essential. It prevents the extension from treating a
manually authored skill as if it had installed it.

### 4. The roadmap is appropriately vertical

Starting with custom Git/local sources, Claude/Kilo, and skills is a much
better validation strategy than implementing six item kinds across five
assistants in parallel. It tests the real motivating workflow early.

### 5. The task documents are generally actionable

Most task files have:

- explicit grounding;
- bounded file scope;
- concrete verification;
- dependency information;
- non-goals;
- one-commit expectations.

That is a strong basis for delegated implementation, once the cross-task
contracts below are corrected.

## Blocking findings

### B1. An `Artifact` has metadata but no retrievable content

The current resolver output ends at:

```ts
interface Artifact {
  id: string;
  packageId: string;
  kind: ItemKind;
  name: string;
  description?: string;
  nativeFormat: string;
}
```

`findSkillDirs()` discovers the absolute skill directory, but
`resolveLocalFolder()` and `resolveGitCustom()` discard that path when they
create the `Artifact`.

Task 06.1 therefore accepts `artifactContent: unknown` from an unspecified
caller. Task 07.2 expects the Available view to resolve artifacts and invoke
the install pipeline, but it has no API with which to obtain that content.

This is not just an awkward seam: it is a missing operation in the domain.

#### Required correction

Introduce one of these explicit contracts before initiative 05:

```ts
interface ResolvedArtifact<T> {
  artifact: Artifact;
  content: T;
  revision?: ResolvedRevision;
}
```

or:

```ts
interface SourceResolver {
  list(source: Source): Promise<Package[]>;
  resolveArtifact(source: Source, artifactId: string): Promise<ResolvedArtifact>;
}
```

The second form scales better to remote feeds where listing metadata and
downloading content are distinct operations.

Task 07.2 must never be responsible for reverse-engineering a source path from
an artifact id.

### B2. A skill is a directory, not only a parsed `SKILL.md`

The current canonical model contains only:

- name;
- description;
- Markdown body;
- extra frontmatter fields.

Real Agent Skills may also include:

- `scripts/`;
- `references/`;
- templates;
- images and other assets;
- executable files whose permission bits matter.

The current adapters create only `SKILL.md`. Installing a real skill through
this pipeline would silently drop all supporting resources. The resulting
skill could appear installed and pass the proposed read-back verification
while being functionally broken.

#### Required correction

Model skill content as a directory payload:

```ts
interface CanonicalSkill {
  manifest: SkillManifest;
  body: string;
  files: ArtifactFile[];
  rawFrontmatter?: string;
}
```

`ArtifactFile` needs a safe relative path, content or content handle, file
mode where relevant, and an explicit symlink policy. The whole directory tree
must be copied, verified, and hashed deterministically.

Verification must check the installed file set, not only parse `SKILL.md`.

### B3. The registry still conflates desired/shared state with local state

The revised specification conceptually distinguishes:

- `DesiredManifest`;
- `LocalState`;
- `ManagedInstallation`.

The implemented registry does not. A project-level
`.ai-toolkit/registry.json`, described as versionable, currently stores
`ManagedInstallation` values containing machine-specific fields such as:

- absolute `path`;
- `projectPath`;
- `installedAt`;
- observed content hash.

A project registry committed to Git would therefore contain local machine
state and could conflict between collaborators. Conversely, using it as the
authoritative installed-state ledger would make a clean checkout appear to
have installations that do not exist on the new machine.

`local-folder` sources create a related problem: an absolute local path is not
a portable project dependency.

#### Required correction

Decide and implement the split before task 06.2 records installations.

A practical shape is:

```text
<project>/.ai-swissknife/manifest.json   # shareable desired sources/installations
<extension global storage>/state.json   # machine-local resolved paths/hashes/status
```

The exact names are less important than the invariant: versionable data must
not contain machine-specific installation facts or credentials.

Also add a `schemaVersion` and migration/validation strategy now. Registry
files are product data; an unversioned `JSON.parse` result is not enough once
the extension is released.

### B4. The planned apply path is neither atomic nor recoverable

Initiative 06 states that artifact writes must be atomic and recoverable, but
task 06.2 tells `applyInstall()` to call `targetAdapter.writeSkill()` or
`writeRule()` directly. The current Claude adapter uses `fs.writeFile()` on
the destination and is not atomic.

There is also no defined backup, rollback, transaction journal, or
compensation if:

- the target write succeeds but verification fails;
- the artifact write succeeds but registry persistence fails;
- the target changes after preview but before apply;
- a multi-file skill is only partially written.

Task 06.2 currently says to return `verified: false` after a failed
verification, but it would still have written the content and may record the
installation. That contradicts the ownership and recoverability promises.

#### Required correction

Define installation as a staged directory transaction:

1. validate source payload;
2. materialize the complete target tree in a sibling temporary directory;
3. verify the staged tree;
4. re-check the preview precondition;
5. move the existing destination to a backup when replacing;
6. atomically rename the staged tree into place;
7. persist local state;
8. remove backup only after the state write succeeds;
9. compensate/rollback on any failure.

For files such as rules or future MCP configuration, use the corresponding
file-level staged write and backup strategy.

The plan should carry an expected destination fingerprint so apply can detect
a time-of-check/time-of-use change after preview.

### B5. Untrusted names and paths are not validated

Artifact metadata comes from a custom repository and must be treated as
untrusted input. The current adapter joins `skill.name` directly into the
destination path. A malicious or malformed name containing `../`, separators,
an absolute path, or platform-specific special characters could escape the
intended skills directory.

The resolver also falls back to the directory basename when frontmatter is
invalid or unreadable, and `findSkillDirs()` swallows read errors. That can
turn an invalid skill into an apparently valid catalog entry.

#### Required correction

Add a preflight-validation task before the install engine:

- validate required frontmatter;
- validate or normalize skill names according to the supported Agent Skills
  baseline;
- reject path separators, `.`/`..`, absolute paths, NUL, and reserved names;
- resolve every destination and assert it remains inside the intended root;
- validate every auxiliary relative file path;
- define how symlinks are handled;
- return structured diagnostics instead of silently falling back.

The validation scripts in `references/cc-swiss-knife` are useful input, but
validation must be implemented as a reusable library operation rather than by
executing repository-provided scripts.

### B6. “Preserve unknown fields verbatim” is not satisfied

The specification promises preservation of unknown/unmapped fields. The
current `Record<string, unknown>` model and minimal YAML parser do not preserve
YAML verbatim. They can lose or change:

- comments;
- quoting style;
- block scalars and multiline strings;
- nested YAML structures not written as JSON;
- anchors/tags;
- formatting and, depending on transformation, ordering.

The current round-trip tests use convenient synthetic JSON-compatible values,
so they do not test the real risk.

#### Required correction

Choose one explicit guarantee:

1. **semantic preservation**, using a real YAML parser and accepting canonical
   reformatting; or
2. **round-trip preservation**, retaining the YAML document/AST or raw
   frontmatter and applying targeted edits.

Do not use the word “verbatim” if the implementation only preserves parsed
values. Add fixtures with multiline descriptions, lists, nested objects,
comments, quoted colon-containing values, CRLF, and optional fields used by
real skills.

### B7. The test fixtures are not portable or deterministic

Initiative 04 explicitly tests against:

- absolute paths under `/Users/Alfredo/...`;
- gitignored reference checkouts;
- the live contents of `~/.claude/skills/`;
- an exact count of 25 user-installed skills.

These tests pass on the current machine but will fail for another contributor,
in CI, or as soon as the user installs/removes a skill. Tests should not depend
on private mutable home-directory state.

“Ground tests in real artifacts” and “make tests portable” are compatible.

#### Required correction

Commit a small fixture corpus derived from real sources, with provenance and
license notes, covering:

- a single-skill repo;
- a flat multi-skill repo;
- a plugin-nested repo;
- `.claude/skills`, `.agents/skills`, or `.github/skills` layouts;
- a skill with bundled resources;
- invalid and malicious cases.

Use live workspace repositories only for optional integration tests guarded by
environment detection, never for the default unit-test gate.

## Important non-blocking findings

### I1. Dot-directory scanning excludes standard skill layouts

`findSkillDirs()` skips every directory whose name begins with a dot. That
excludes legitimate custom-repository layouts such as:

- `.claude/skills/`;
- `.agents/skills/`;
- `.github/skills/`.

Skip explicit internal directories such as `.git` and configured ignore
patterns, not every dot-directory.

### I2. Git provenance records the requested ref, not the resolved commit

`Package.version` currently contains `main`, a tag name, or the supplied
commit. For an unpinned branch this is not sufficient for provenance or drift:
the branch changes over time.

Record both:

```ts
interface ResolvedRevision {
  requestedRef?: string;
  commit: string;
}
```

Run `git rev-parse HEAD` after checkout and carry that immutable commit through
the package, plan, and installation record.

### I3. Git cache access needs locking and cancellation

The Available view is planned to resolve/fetch on tree expansion. Concurrent
expansions or multiple VS Code windows can operate on the same checkout.
`git fetch`, `checkout`, and `reset --hard` need a per-source lock.

Long-running Git operations also need:

- a timeout or cancellation token;
- progress UI;
- `GIT_TERMINAL_PROMPT=0` plus an actionable authentication error;
- a cache key based on a collision-resistant hash, not only a sanitized
  source id;
- a deliberate policy for Git filters/submodules/LFS and untrusted content.

Repeated network fetches should be tied to an explicit catalog refresh, not
every tree expansion.

### I4. Source refresh naming and behavior disagree

Task 07.1 names a command “Refresh Sources” but defines it as re-reading the
registry only. Task 07.2 performs real Git resolution/fetch during expansion.
This is surprising UX.

Prefer:

- “Reload Registry” for a local state reload, if such a user-facing command is
  needed at all;
- “Refresh Catalog” for fetching/resolving sources;
- explicit status per source: idle, resolving, authentication required,
  failed, current revision.

### I5. Multi-root workspaces are reduced to the first folder

Initiative 07 always uses `workspaceFolders[0]`. In a multi-root workspace,
project scope is ambiguous. The UI should ask for or infer the target workspace
folder from the selected source/item and persist its URI.

### I6. Removing a source can orphan managed installations

Task 07.1 removes a source from the registry without checking installations
that reference it. The command should block, warn, or offer an explicit
“detach installed items” operation. It must not silently destroy provenance.

### I7. `rule` is not actually part of the vertical slice

The foundations spec says `rule` “rides along,” and adapters/translators
include it. The source resolvers only discover skills, so the Available view
can never produce a rule artifact. The rule code is therefore outside the
promised end-to-end path.

More importantly, installing a rule is not automatically safe merely because
Claude and Kilo can read the same Markdown file. A project `CLAUDE.md` is often
an existing shared instruction document; replacing it wholesale requires
merge/composition semantics.

Recommendation: make Phase 1 strictly skill-only. Keep already-written rule
code if useful, but do not expose rule installation or claim it as validated
until a rule resolver and conflict/merge policy exist.

### I8. `nativeFormat: "claude-skill"` is misleading for portable skills

The specification itself establishes that the relevant `SKILL.md` format is
portable across several assistants. A loose generic skill should use a neutral
format id such as `agent-skill-v1` or `skill-md`, with provenance kept
separately from format.

### I9. Aggregate conversion diagnostics do not meet the per-field promise

`SPEC.md` asks for a diagnostic for each field. Task 05.1 returns one aggregate
`diagnostic` plus `notes`. That is enough for the identity-only MVP but not the
declared extensible contract.

Use:

```ts
interface FieldDiagnostic {
  path: string;
  severity: ConversionDiagnostic;
  message?: string;
}

interface TranslationResult<T> {
  value: T;
  overall: ConversionDiagnostic;
  diagnostics: FieldDiagnostic[];
}
```

### I10. Translator ownership is internally contradictory

Initiative 05's `plan.md` says the translator does not know about assistants.
Task 05.1 gives `translateSkill()` both `fromAssistant` and `toAssistant`.

For a canonical-model architecture, the clean contract is generally:

```text
native source codec -> canonical artifact -> target capability analysis
-> target codec
```

The compatibility analyzer needs target capabilities, not necessarily a
source assistant id. Provenance remains metadata outside the canonical
transformation.

### I11. Kilo global rule path instructions contradict each other

Task 03.3 correctly specifies:

- project: `<projectRoot>/CLAUDE.md`;
- global: `~/.config/kilo/AGENTS.md`.

The owning `03/plan.md` then says the Kilo adapter can write the exact same
Claude path, including after mentioning the distinct global Kilo path. Correct
the shared plan before delegating 03.3 so the task and initiative cannot be
interpreted differently.

### I12. Phase and state documents have drifted

`tasks/CONTEXT.md` and `tasks/specs/foundations.md` still say that no source
code exists. The repository already contains several implemented initiatives.
The task index is closer to reality but was itself changing during this
review.

Update durable context after each initiative or describe the codebase map as a
pointer to the live tree rather than a statement likely to become stale.

Phase 0 is also described as blocking everything but is not represented as a
closed initiative. Record what Phase 0 verified for the Phase 1 slice and mark
its status explicitly.

### I13. Registry and product naming should be decided early

The product is AI Swissknife, while persisted state still uses
`.ai-toolkit/`. Renaming persisted data after users adopt the extension
requires migration. Choose the stable data-directory name before publishing
the first usable build.

## Task-by-task recommendations

### Initiative 01 — Project scaffold

Status: acceptable and verified.

Follow-ups:

- decide whether `onStartupFinished` is necessary once view-based activation
  is present;
- verify the Activity Bar icon contribution format before task 07.1. A codicon
  string may not be a valid `viewsContainers.activitybar[].icon` resource;
  use the VS Code contribution schema/local docs as the authority;
- decide extension placement/remote behavior (`extensionKind`) because global
  assistant directories should normally refer to the extension host where the
  workspace and CLI run, especially under SSH/WSL/dev containers.

### Initiative 02 — Domain and registry

Status: code passes its tests, but its contract needs a hardening follow-up
before initiative 06.

Add a new task covering:

- `ResolvedArtifact`/content resolver contract;
- complete skill directory payload;
- resolved Git revision;
- registry `schemaVersion` and validation;
- desired/shared versus machine-local state split;
- neutral format identifiers.

### Initiative 03 — Claude/Kilo adapters

Status: interface and Claude adapter exist; Kilo adapter is open.

Before continuing:

- make Phase 1 skill-only or explicitly explain why dormant rule support is
  retained;
- correct the Kilo global rule-path contradiction;
- extract one shared Skill codec instead of duplicating parsing in both
  adapters and the detector;
- replace the minimal YAML guarantee with the chosen semantic/round-trip
  guarantee;
- change writes to operate on staged skill directories or return a materialized
  payload rather than directly mutating final destinations.

### Initiative 04 — Source resolvers

Status: both implementations exist and current local tests pass, although the
index/task working tree should be reconciled.

Add a hardening task for:

- portable committed fixtures;
- standard dot-directory discovery;
- structured detection diagnostics;
- complete resource-tree content;
- immutable resolved commit;
- cache lock and cancellation;
- stable collision-resistant cache keys;
- explicit errors for invalid/missing local sources instead of silent empty
  catalogs where appropriate.

### Initiative 05 — Translator

Status: do not start unchanged.

First settle:

- canonical skill directory content;
- target capability analysis;
- aggregate plus per-field diagnostics;
- assistant identity/provenance ownership;
- true frontmatter preservation guarantee.

The Claude↔Kilo skill identity case is still a good first translator test once
those contracts exist.

### Initiative 06 — Install engine

Status: rewrite the two task contracts before delegation.

`InstallPlan` should include at least:

- artifact kind and complete resolved revision;
- target root/path;
- target file manifest;
- operations (`create`, `replace`, possibly `remove`);
- pre-existing destination fingerprint;
- conflict policy;
- field diagnostics and validation findings;
- whether the operation is supported;
- ownership/provenance impact.

`applyInstall()` must stage, verify, atomically swap, persist state, and roll
back/compensate. It must not record a healthy managed installation when
verification failed.

### Initiative 07 — Minimal UI

Status: sound three-view concept, but it depends on the corrected 04–06
contracts.

Revise the tasks to include:

- explicit source resolution/content loading;
- progress, cancellation, and authentication errors;
- explicit catalog refresh rather than fetch-on-expand;
- workspace-folder choice in multi-root workspaces;
- source-removal provenance checks;
- preview of all files, validation errors, diagnostics, conflict policy, and
  resolved commit;
- refresh of Available and Installed views after apply;
- real Extension Development Host integration tests for the core flow.

## Recommended revised dependency sequence

Keep the existing initiative numbers, but insert hardening tasks before moving
forward:

```text
01 scaffold                         done
  ↓
02 domain/registry                  implemented, needs 02.3 hardening
  ├── 03 adapters                   03.1/03.2 done; revise then 03.3
  └── 04 resolvers                  implemented; add 04.3 hardening
          ↓
   integration contract gate       resolved artifact + full skill tree
          ↓
05 compatibility/translation       revised contract
          ↓
06 transactional install engine    revised plan/apply tasks
          ↓
07 minimal UI                      revised integration tasks
```

Suggested additions:

1. **02.3 — Persistence and resolved-artifact model**
2. **03.4 — Shared skill codec + validation contract**
3. **04.3 — Resolver hardening + portable fixtures + full payload**
4. **05.1 revised — Compatibility analysis and field diagnostics**
5. **06.1 revised — Complete install plan and preconditions**
6. **06.2 revised — Stage/verify/swap/rollback/state transaction**

Whether to use exactly these numbers is less important than making the gate
explicit in `00-INDEX.md` so a delegated agent cannot proceed directly from
the current resolver metadata to the current install task.

## Acceptance criteria for the Phase 1 vertical slice

Phase 1 should be considered complete only when an end-to-end test proves all
of the following:

1. A generic local or Git repository contains a skill with `SKILL.md`, a
   script, and a reference file.
2. The resolver lists it without requiring a marketplace manifest.
3. The content resolver returns the complete directory payload and immutable
   Git commit.
4. Preflight validation rejects malicious names/paths and reports invalid
   frontmatter.
5. The user can plan installation for Claude or Kilo and see every affected
   file, conflict, diagnostic, source, and commit.
6. Cancel leaves the filesystem unchanged.
7. Apply installs the entire directory atomically.
8. Verification checks all installed files and their deterministic hash.
9. Registry/local state records correct ownership and provenance without
   putting machine-specific state into a shareable manifest.
10. A simulated failure between staging, swap, and state persistence restores
    the previous destination.
11. Reinstall/update does not duplicate records and detects a destination that
    changed after preview.
12. The same flow works from the actual VS Code Extension Development Host,
    including a project-scope install and a global install on the correct
    extension host.

## Final verdict

The updated specification has successfully moved from an overly broad
“universal marketplace” concept to a credible custom-repository management
product. Its core domain distinctions and phased product strategy are now
mostly correct.

The remaining weakness is at the implementation boundary, not the product
vision. The current task chain models a skill too narrowly, loses the source
content handle, mixes shareable and local registry state, and promises
transactional safety that the planned APIs cannot provide.

These are best fixed now, while only the foundation is implemented. Continuing
unchanged through initiatives 05–07 would make the later correction more
expensive because UI and registry behavior would be built on incomplete
contracts.

Recommendation: **keep the roadmap and product scope, add a short foundation-
hardening gate, then resume the vertical slice.**
