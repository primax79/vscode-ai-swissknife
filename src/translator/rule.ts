import type { CanonicalRule } from '../adapters/types';
import type { SupportedAssistant, TranslationResult } from './skill';

export function translateRule(
  source: CanonicalRule,
  fromAssistant: SupportedAssistant,
  toAssistant: SupportedAssistant
): TranslationResult<CanonicalRule> {
  // 1. Same-assistant translation short-circuits to lossless
  if (fromAssistant === toAssistant) {
    return {
      value: { content: source.content },
      diagnostic: 'lossless',
      notes: [],
    };
  }

  // 2. Cross-assistant translation
  // Claude Code and Kilo Code read the exact same rule markdown content (CLAUDE.md / AGENTS.md)
  // with zero adaptation (SPEC.md §1, §5).
  return {
    value: { content: source.content },
    diagnostic: 'lossless',
    notes: [],
  };
}
