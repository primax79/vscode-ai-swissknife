import type { CanonicalRule } from '../adapters/types';
import type { AssistantId } from '../domain/types';
import type { TranslationResult } from './skill';

export function translateRule(
  source: CanonicalRule,
  targetAssistant: AssistantId
): TranslationResult<CanonicalRule> {
  if (targetAssistant === 'claude-code' || targetAssistant === 'kilo-code') {
    return {
      value: { content: source.content },
      overall: 'lossless',
      diagnostics: [],
    };
  }

  return {
    value: { content: source.content },
    overall: 'unsupported',
    diagnostics: [
      {
        code: 'unsupported-target',
        severity: 'error',
        field: 'target',
        impact: 'unsupported',
        message: `Target assistant "${targetAssistant}" is not supported for rules in Phase 1`,
      },
    ],
  };
}
