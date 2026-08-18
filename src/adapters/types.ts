import type { AssistantId, Scope } from '../domain/types';

export interface CanonicalSkill {
  name: string;
  description: string;
  body: string; // the markdown content after the frontmatter
  extraFields: Record<string, unknown>; // unrecognized frontmatter fields, preserved verbatim (SPEC.md §4 "canonical model")
}

export interface CanonicalRule {
  content: string; // raw file content, no frontmatter parsing — CLAUDE.md/AGENTS.md are plain markdown (SPEC.md §1)
}

export interface LocationRef {
  scope: Scope;
  projectRoot?: string; // required when scope === 'project'
}

export interface Adapter {
  readonly assistant: AssistantId;

  skillPath(name: string, loc: LocationRef): string;
  readSkill(name: string, loc: LocationRef): Promise<CanonicalSkill | null>; // null if not found, not an error
  writeSkill(skill: CanonicalSkill, loc: LocationRef): Promise<void>;
  listSkills(loc: LocationRef): Promise<string[]>; // names only

  rulePath(loc: LocationRef): string;
  readRule(loc: LocationRef): Promise<CanonicalRule | null>;
  writeRule(rule: CanonicalRule, loc: LocationRef): Promise<void>;
}
