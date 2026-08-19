import type { CanonicalCommand } from '../adapters/types';
import type { AssistantId } from '../domain/types';
import type { TranslationResult, TranslationDiagnostic } from './skill';

export function translateCommand(
  source: CanonicalCommand,
  targetAssistant: AssistantId
): TranslationResult<CanonicalCommand> {
  if (targetAssistant === 'claude-code' || targetAssistant === 'kilo-code') {
    return {
      value: {
        name: source.name,
        description: source.description,
        ...(source.agent ? { agent: source.agent } : {}),
        ...(source.model ? { model: source.model } : {}),
        ...(source.subtask !== undefined ? { subtask: source.subtask } : {}),
        body: source.body,
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
      message: `Target assistant "${targetAssistant}" is not supported for commands in Phase 2`,
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
