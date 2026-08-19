import type { CanonicalRule } from '../adapters/types';
import type { AssistantId } from '../domain/types';
import type { TranslationResult, TranslationDiagnostic } from './skill';

const SUPPORTED_ASSISTANTS: AssistantId[] = [
  'claude-code',
  'kilo-code',
  'github-copilot',
  'codex-cli',
  'gemini-cli',
];

export function translateRule(
  source: CanonicalRule,
  targetAssistant: AssistantId
): TranslationResult<CanonicalRule> {
  if (SUPPORTED_ASSISTANTS.includes(targetAssistant)) {
    return {
      value: { content: source.content },
      overall: 'lossless',
      diagnostics: [],
    };
  }

  const diagnostics: TranslationDiagnostic[] = [
    {
      code: 'unsupported-target',
      severity: 'error',
      field: 'target',
      impact: 'unsupported',
      message: `Target assistant "${targetAssistant}" is not supported for rules`,
    },
  ];

  return {
    value: { content: source.content },
    overall: 'unsupported',
    diagnostics,
  };
}
