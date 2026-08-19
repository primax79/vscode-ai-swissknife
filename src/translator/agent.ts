import type { CanonicalAgent } from '../adapters/types';
import type { AssistantId } from '../domain/types';
import type { TranslationResult, TranslationDiagnostic } from './skill';

export function translateAgent(
  source: CanonicalAgent,
  targetAssistant: AssistantId
): TranslationResult<CanonicalAgent> {
  if (targetAssistant === 'claude-code') {
    const tools = [...source.tools];
    if (tools.length === 0 && Object.keys(source.permissions).length > 0) {
      for (const [permKey, permVal] of Object.entries(source.permissions)) {
        if (permVal === 'allow' || permVal === 'ask') {
          tools.push(permKey);
        }
      }
    }

    return {
      value: {
        name: source.name,
        description: source.description,
        tools,
        permissions: {},
        ...(source.model ? { model: source.model } : {}),
        body: source.body,
        extraFields: { ...source.extraFields },
      },
      overall: 'lossless',
      diagnostics: [],
    };
  }

  if (targetAssistant === 'kilo-code') {
    const permissions: Record<string, 'allow' | 'deny' | 'ask'> = { ...source.permissions };
    if (Object.keys(permissions).length === 0 && source.tools.length > 0) {
      for (const tool of source.tools) {
        permissions[tool] = 'allow';
      }
    }

    return {
      value: {
        name: source.name,
        description: source.description,
        mode: source.mode ?? 'primary',
        tools: [],
        permissions,
        ...(source.model ? { model: source.model } : {}),
        ...(source.variant ? { variant: source.variant } : {}),
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
      message: `Target assistant "${targetAssistant}" is not supported for agents in Phase 2`,
    },
  ];

  return {
    value: {
      ...source,
      tools: [...source.tools],
      permissions: { ...source.permissions },
      extraFields: { ...source.extraFields },
    },
    overall: 'unsupported',
    diagnostics,
  };
}
