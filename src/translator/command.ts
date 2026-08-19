import type { CanonicalCommand } from '../adapters/types';
import type { AssistantId } from '../domain/types';
import type { TranslationResult, TranslationDiagnostic } from './skill';

const SUPPORTED_ASSISTANTS: AssistantId[] = [
  'claude-code',
  'kilo-code',
  'github-copilot',
  'codex-cli',
  'gemini-cli',
];

export function translateCommand(
  source: CanonicalCommand,
  targetAssistant: AssistantId
): TranslationResult<CanonicalCommand> {
  const extraFields = { ...source.extraFields };
  delete extraFields.name;
  delete extraFields.description;
  delete extraFields.agent;
  delete extraFields.model;
  delete extraFields.subtask;

  if (SUPPORTED_ASSISTANTS.includes(targetAssistant)) {
    return {
      value: {
        name: source.name,
        description: source.description,
        ...(source.agent ? { agent: source.agent } : {}),
        ...(source.model ? { model: source.model } : {}),
        ...(source.subtask !== undefined ? { subtask: source.subtask } : {}),
        body: source.body,
        extraFields: targetAssistant === 'kilo-code' || targetAssistant === 'gemini-cli' ? {} : extraFields,
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
      message: `Target assistant "${targetAssistant}" is not supported for commands`,
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
