import type { CanonicalMcpServer } from '../adapters/types';
import type { AssistantId } from '../domain/types';
import type { TranslationResult, TranslationDiagnostic } from './skill';

export function translateMcpServer(
  source: CanonicalMcpServer,
  targetAssistant: AssistantId
): TranslationResult<CanonicalMcpServer> {
  if (targetAssistant === 'claude-code' || targetAssistant === 'kilo-code') {
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
      message: `Target assistant "${targetAssistant}" is not supported for MCP servers in Phase 2`,
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
