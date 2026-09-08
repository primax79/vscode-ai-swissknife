import type { ItemKind } from '../domain/types';

/** Single source of truth for the per-kind codicon, shared by every tree view. */
export function getKindIconName(kind: ItemKind): string {
  switch (kind) {
    case 'skill':
      return 'lightbulb';
    case 'agent':
      return 'robot';
    case 'command':
      return 'terminal';
    case 'mcp-server':
      return 'plug';
    case 'hook':
      return 'zap';
    case 'rule':
      return 'book';
    default:
      return 'symbol-misc';
  }
}
