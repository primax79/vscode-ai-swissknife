import type { CanonicalSkill } from '../adapters/types';
import type { ConversionDiagnostic } from '../domain/types';

export interface TranslationResult<T> {
  value: T;
  diagnostic: ConversionDiagnostic;
  notes: string[]; // human-readable, empty when diagnostic is 'lossless'
}

export type SupportedAssistant = 'claude-code' | 'kilo-code';

interface TargetSkillConstraints {
  maxNameLength?: number;
  maxDescriptionLength?: number;
  namePattern?: RegExp;
}

/**
 * Known constraints for target assistants.
 * Note: Copilot in Phase 2 caps name at 64 chars (lowercase-hyphen) and description at 1024 (SPEC.md §1).
 * Claude Code and Kilo Code CLI impose no length caps beyond being required (SPEC.md §1, §4).
 */
const TARGET_SKILL_CONSTRAINTS: Record<SupportedAssistant, TargetSkillConstraints> = {
  'claude-code': {},
  'kilo-code': {},
};

export function translateSkill(
  source: CanonicalSkill,
  fromAssistant: SupportedAssistant,
  toAssistant: SupportedAssistant
): TranslationResult<CanonicalSkill> {
  // 1. Same-assistant translation short-circuits to lossless
  if (fromAssistant === toAssistant) {
    return {
      value: {
        name: source.name,
        description: source.description,
        body: source.body,
        extraFields: { ...source.extraFields },
      },
      diagnostic: 'lossless',
      notes: [],
    };
  }

  // 2. Cross-assistant inspection & target constraint validation
  const targetConstraints = TARGET_SKILL_CONSTRAINTS[toAssistant];
  const notes: string[] = [];
  let diagnostic: ConversionDiagnostic = 'lossless';

  if (targetConstraints.maxNameLength !== undefined && source.name.length > targetConstraints.maxNameLength) {
    notes.push(
      `Skill name "${source.name}" exceeds maximum allowed length of ${targetConstraints.maxNameLength} characters for ${toAssistant}.`
    );
    diagnostic = 'adapted-with-warning';
  }

  if (targetConstraints.namePattern !== undefined && !targetConstraints.namePattern.test(source.name)) {
    notes.push(
      `Skill name "${source.name}" does not match required naming pattern ${targetConstraints.namePattern} for ${toAssistant}.`
    );
    diagnostic = 'adapted-with-warning';
  }

  if (
    targetConstraints.maxDescriptionLength !== undefined &&
    source.description.length > targetConstraints.maxDescriptionLength
  ) {
    notes.push(
      `Skill description exceeds maximum allowed length of ${targetConstraints.maxDescriptionLength} characters for ${toAssistant}.`
    );
    diagnostic = 'adapted-with-warning';
  }

  // For Claude Code <-> Kilo Code, skill format is 1:1 identical (SPEC.md §1, §4)
  // Unrecognized / extra frontmatter fields are preserved verbatim
  return {
    value: {
      name: source.name,
      description: source.description,
      body: source.body,
      extraFields: { ...source.extraFields },
    },
    diagnostic,
    notes,
  };
}
