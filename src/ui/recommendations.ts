import * as vscode from 'vscode';
import type { Artifact, Package, Source, AssistantId, Scope } from '../domain/types';
import { readManifest, readState, fromDesiredSource, type DesiredSource } from '../domain/registry';
import { getWorkspaceRoot } from './workspacePicker';
import { getSourceResolver } from '../sources/registry';
import { resolveRecommendations, SourceResolutionAttempt } from '../engine/recommendations';
import { getAdapter } from '../adapters/registry';
import { planInstall } from '../engine/plan';
import { applyInstall } from '../engine/apply';
import type { PreparedInstall } from '../engine/types';

export async function installResolvedArtifacts(
  items: { artifact: Artifact; pkg: Package; source: Source; targetAssistant: AssistantId; targetScope: Scope }[],
  projectRoot: string
) {
  const preparedList: PreparedInstall[] = [];
  let supportedCount = 0;
  let conflictCount = 0;

  for (const item of items) {
    const targetAdapter = getAdapter(item.targetAssistant);

    const prepared = await planInstall({
      source: item.source,
      pkg: item.pkg,
      artifact: item.artifact,
      targetAdapter,
      targetScope: item.targetScope,
      projectRoot,
    });
    
    preparedList.push(prepared);
    if (prepared.supported) {
      supportedCount++;
      if (prepared.plan.conflict) {
        conflictCount++;
      }
    }
  }

  if (supportedCount === 0) {
    vscode.window.showErrorMessage(`None of the ${items.length} item(s) could be planned for installation.`);
    return;
  }

  if (conflictCount > 0) {
    const conflictChoice = await vscode.window.showWarningMessage(
      `${conflictCount} of ${supportedCount} item(s) already exist at target. Overwrite existing installations?`,
      { modal: true },
      'Overwrite All'
    );
    if (conflictChoice !== 'Overwrite All') {
      return;
    }
  }

  let appliedCount = 0;
  const failedNames: string[] = [];

  for (const prepared of preparedList) {
    if (!prepared.supported) continue;
    const outcome = await applyInstall(prepared);
    const itemName = prepared.kind === 'mcp-server' ? prepared.content.id : prepared.content.name;
    if (outcome.status === 'applied') {
      appliedCount++;
    } else {
      failedNames.push(`${itemName} (${outcome.status})`);
    }
  }

  if (appliedCount > 0) {
    let msg = `Successfully installed ${appliedCount}/${supportedCount} recommended item(s).`;
    if (failedNames.length > 0) {
      msg += ` Failures: ${failedNames.join(', ')}`;
    }
    vscode.window.showInformationMessage(msg);
  } else {
    vscode.window.showErrorMessage(`Failed to install items. ${failedNames.join(', ')}`);
  }
}

export async function resolveRecommendedSources(
  distinctSourceIds: string[],
  desiredSources: DesiredSource[],
  projectRoot: string,
  progress?: { report: (value: { increment: number }) => void }
): Promise<Map<string, SourceResolutionAttempt>> {
  const resolutionAttempts = new Map<string, SourceResolutionAttempt>();
  const increment = 100 / (distinctSourceIds.length || 1);
  for (const sourceId of distinctSourceIds) {
    const desiredSource = desiredSources.find(s => s.id === sourceId);
    if (!desiredSource) {
      if (progress) progress.report({ increment });
      continue; 
    }
    
    const source = fromDesiredSource(desiredSource, projectRoot);
    
    try {
      const resolver = getSourceResolver(source.type);
      const packages: Package[] = (await resolver.resolve(source)).packages;
      
      resolutionAttempts.set(sourceId, { status: 'resolved', source, packages });
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      resolutionAttempts.set(sourceId, { status: 'failed', source, error });
    }
    if (progress) progress.report({ increment });
  }
  return resolutionAttempts;
}

export async function handleInstallRecommended(onInstalledCallback?: () => void) {
  const projectRoot = await getWorkspaceRoot();
  if (!projectRoot) {
    vscode.window.showErrorMessage('No workspace folder found.');
    return;
  }

  const manifest = await readManifest('project', projectRoot);
  const state = await readState('project', projectRoot);

  const desiredSources = manifest.sources;
  const desiredInstallations = manifest.desiredInstallations;
  
  if (desiredInstallations.length === 0) {
    vscode.window.showInformationMessage('No recommended items in this workspace.');
    return;
  }

  const distinctSourceIds = Array.from(new Set(desiredInstallations.map(d => d.sourceId)));
  let resolutionAttempts = new Map<string, SourceResolutionAttempt>();
  
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Resolving recommended sources...' },
    async (progress) => {
      resolutionAttempts = await resolveRecommendedSources(distinctSourceIds, desiredSources, projectRoot, progress);
    }
  );

  const resolved = resolveRecommendations(
    desiredInstallations,
    state.installations,
    desiredSources.map(ds => fromDesiredSource(ds, projectRoot)),
    resolutionAttempts
  );

  if (resolved.pending.length === 0 && resolved.broken.length === 0) {
    vscode.window.showInformationMessage('All recommended items are already installed.');
    return;
  }

  let previewMessage = `Found ${resolved.pending.length} actionable item(s) to install.\n`;
  if (resolved.broken.length > 0) {
    previewMessage += `\nThere are ${resolved.broken.length} broken recommendation(s):\n`;
    for (const b of resolved.broken) {
      const reasonText = b.reason.kind === 'source-not-registered' ? 'Source not registered' :
                         b.reason.kind === 'source-resolution-failed' ? `Resolution failed (${(b.reason as any).error})` :
                         'Artifact not found in source';
      previewMessage += `- ${b.desired.artifactId} (Source: ${b.desired.sourceId}): ${reasonText}\n`;
    }
  }

  if (resolved.pending.length === 0) {
    vscode.window.showWarningMessage(`No actionable recommendations.\n${previewMessage}`, { modal: true });
    return;
  }
  
  const confirm = await vscode.window.showInformationMessage(
    previewMessage + `\nDo you want to install the ${resolved.pending.length} actionable item(s)?`,
    { modal: true },
    'Install'
  );

  if (confirm !== 'Install') return;

  const freshState = await readState('project', projectRoot);
  const freshResolved = resolveRecommendations(
    desiredInstallations,
    freshState.installations,
    desiredSources.map(ds => fromDesiredSource(ds, projectRoot)),
    resolutionAttempts
  );

  if (freshResolved.pending.length === 0) {
    vscode.window.showInformationMessage('Items were installed in the interim.');
    return;
  }

  const itemsToInstall = freshResolved.pending.map(p => ({
    artifact: p.artifact,
    pkg: p.pkg,
    source: p.source,
    targetAssistant: p.desired.assistant,
    targetScope: p.desired.scope
  }));

  await installResolvedArtifacts(itemsToInstall, projectRoot);
  if (onInstalledCallback) onInstalledCallback();
}
