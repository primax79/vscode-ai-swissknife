import type { AssistantId } from '../domain/types';
import { ClaudeAdapter, claudeAdapter } from './claude';
import { CodexAdapter, codexAdapter } from './codex';
import { CopilotAdapter, copilotAdapter } from './copilot';
import { GeminiAdapter, geminiAdapter } from './gemini';
import { KiloAdapter, kiloAdapter } from './kilo';
import type { Adapter } from './types';

export const ALL_ADAPTERS: readonly Adapter[] = [
  claudeAdapter,
  kiloAdapter,
  copilotAdapter,
  codexAdapter,
  geminiAdapter,
];

export function getAdapter(id: AssistantId): Adapter {
  const found = ALL_ADAPTERS.find((a) => a.assistant === id);
  if (!found) {
    throw new Error(`Unsupported assistant: ${id}`);
  }
  return found;
}

export function getAdapterWithHomeRoot(id: AssistantId, homeRoot: string): Adapter {
  switch (id) {
    case 'claude-code':
      return new ClaudeAdapter(() => homeRoot);
    case 'kilo-code':
      return new KiloAdapter(() => homeRoot);
    case 'github-copilot':
      return new CopilotAdapter(() => homeRoot);
    case 'codex-cli':
      return new CodexAdapter(() => homeRoot);
    case 'gemini-cli':
      return new GeminiAdapter(() => homeRoot);
    default:
      throw new Error(`Unsupported assistant: ${id}`);
  }
}
