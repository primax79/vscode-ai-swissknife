import type { CanonicalHook } from '../adapters/types';
import type { AssistantId } from '../domain/types';
import type { TranslationResult, TranslationDiagnostic } from './skill';

const SUPPORTED_ASSISTANTS: AssistantId[] = [
  'claude-code',
  'kilo-code',
  'github-copilot',
  'codex-cli',
  'gemini-cli',
];

export function translateHook(
  source: CanonicalHook,
  targetAssistant: AssistantId
): TranslationResult<CanonicalHook> {
  if (SUPPORTED_ASSISTANTS.includes(targetAssistant)) {
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
      message: `Target assistant "${targetAssistant}" is not supported for hooks`,
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
