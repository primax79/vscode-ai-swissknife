import type { CanonicalMcpServer } from '../adapters/types';
import type { AssistantId } from '../domain/types';
import type { TranslationResult, TranslationDiagnostic } from './skill';

const SUPPORTED_ASSISTANTS: AssistantId[] = [
  'claude-code',
  'kilo-code',
  'github-copilot',
  'codex-cli',
  'gemini-cli',
];

export function translateMcpServer(
  source: CanonicalMcpServer,
  targetAssistant: AssistantId
): TranslationResult<CanonicalMcpServer> {
  if (SUPPORTED_ASSISTANTS.includes(targetAssistant)) {
    return {
      value: {
        id: source.id,
        type: source.type,
        ...(source.command ? { command: source.command } : {}),
        ...(source.args ? { args: [...source.args] } : {}),
        ...(source.url ? { url: source.url } : {}),
        ...(source.env ? { env: { ...source.env } } : {}),
        ...(source.headers ? { headers: { ...source.headers } } : {}),
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
      message: `Target assistant "${targetAssistant}" is not supported for MCP servers`,
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
