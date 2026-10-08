import type { ItemKind } from '../domain/types';
import { CliError } from './output';

export const CODE_KINDS: readonly ItemKind[] = ['hook', 'mcp-server'];

/**
 * Gate helper ensuring write mode is explicitly enabled.
 * Throws WRITE_NOT_ENABLED CliError if write is not truthy.
 */
export function requireWrite(write?: boolean): void {
  if (!write) {
    throw new CliError(
      'WRITE_NOT_ENABLED',
      'This command modifies files on disk and requires the --write flag'
    );
  }
}

/**
 * Gate helper refusing executable/code kinds (hook, mcp-server) unless allowed.
 * Throws KIND_NOT_ALLOWED CliError if code kinds are present and allowCodeKinds is false.
 */
export function refuseCodeKinds(
  kinds: ItemKind | Iterable<ItemKind>,
  allowCodeKinds?: boolean
): void {
  if (allowCodeKinds) return;
  const kindList = typeof kinds === 'string' ? [kinds] : Array.from(kinds);
  const found = kindList.filter((k) => CODE_KINDS.includes(k));
  if (found.length > 0) {
    const unique = Array.from(new Set(found));
    throw new CliError(
      'KIND_NOT_ALLOWED',
      `Executable/code kinds (${unique.join(', ')}) require the --allow-code-kinds flag`
    );
  }
}
