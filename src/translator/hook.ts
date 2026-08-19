import type { CanonicalHook } from '../adapters/types';
import type { AssistantId } from '../domain/types';
import type { TranslationResult, TranslationDiagnostic } from './skill';

export function translateHook(
  source: CanonicalHook,
  targetAssistant: AssistantId
): TranslationResult<CanonicalHook> {
  if (
    targetAssistant === 'claude-code' ||
    targetAssistant === 'kilo-code' ||
    targetAssistant === 'github-copilot'
  ) {
    return {
      value: {
        name: source.name,
        event: source.event,
        command: source.command,
        ...(source.timeout !== undefined ? { timeout: source.timeout } : {}),
        extraFields: { ...source.extraFields },
      },
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
      message: `Target assistant "${targetAssistant}" is not supported for hooks in Phase 2/4`,
    },
  ];

  return {
    value: {
      ...source,
      extraFields: { ...source.extraFields },
    },
    overall: 'unsupported',
    diagnostics,
  };
}
