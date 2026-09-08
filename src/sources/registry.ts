import type { SourceType } from '../domain/types';
import type { SourceResolver } from './types';
import { localFolderResolver } from './localFolder';
import { gitCustomResolver } from './gitCustom';
import { gitMarketplaceResolver } from './gitMarketplace';
import { gitSingleItemResolver } from './gitSingleItem';
import { remoteUrlResolver } from './remoteUrl';

export const ALL_SOURCE_RESOLVERS: readonly SourceResolver[] = [
  localFolderResolver,
  gitCustomResolver,
  gitMarketplaceResolver,
  gitSingleItemResolver,
  remoteUrlResolver,
];

export function getSourceResolver(type: SourceType): SourceResolver {
  const resolver = ALL_SOURCE_RESOLVERS.find((r) => r.type === type);
  if (!resolver) {
    throw new Error(`Unsupported source type: ${type}`);
  }
  return resolver;
}
