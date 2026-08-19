import type { CanonicalSkill } from '../adapters/types';
import type { AssistantId, ConversionDiagnostic } from '../domain/types';

export interface TranslationDiagnostic {
  code: string;
  severity: 'info' | 'warning' | 'error';
  field?: 'name' | 'description' | 'body' | 'extraFields' | 'files' | 'target';
  path?: string;
  impact: 'none' | 'adapted' | 'lost' | 'unsupported';
  message: string;
}

export interface TranslationResult<T> {
  value: T;
  overall: ConversionDiagnostic;
  diagnostics: TranslationDiagnostic[];
}

const SUPPORTED_ASSISTANTS: AssistantId[] = [
  'claude-code',
  'kilo-code',
  'github-copilot',
  'codex-cli',
  'gemini-cli',
];

export function translateSkill(
  source: CanonicalSkill,
  targetAssistant: AssistantId
): TranslationResult<CanonicalSkill> {
  if (SUPPORTED_ASSISTANTS.includes(targetAssistant)) {
    return {
      value: {
        name: source.name,
        description: source.description,
        body: source.body,
        extraFields: { ...source.extraFields },
        files: source.files.map((f) => ({
          path: f.path,
          content: new Uint8Array(f.content),
          ...(f.mode !== undefined ? { mode: f.mode } : {}),
        })),
      },
      overall: 'lossless',
      diagnostics: [],
    };
  }

  return {
    value: {
      name: source.name,
      description: source.description,
      body: source.body,
      extraFields: { ...source.extraFields },
      files: source.files.map((f) => ({
        path: f.path,
        content: new Uint8Array(f.content),
        ...(f.mode !== undefined ? { mode: f.mode } : {}),
      })),
    },
    overall: 'unsupported',
    diagnostics: [
      {
        code: 'unsupported-target',
        severity: 'error',
        field: 'target',
        impact: 'unsupported',
        message: `Target assistant "${targetAssistant}" is not supported`,
      },
    ],
  };
}
