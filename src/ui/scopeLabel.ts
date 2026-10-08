export function getScopeLabel(scope: string): string {
  return scope === 'project' ? 'Workspace' : 'Global';
}
