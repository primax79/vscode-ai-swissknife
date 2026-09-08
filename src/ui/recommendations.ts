import * as vscode from 'vscode';
import type { Artifact, Package, Source, AssistantId, Scope, ItemKind, ManagedInstallation } from '../domain/types';
import { readManifest, writeManifest, readState, fromDesiredSource, type DesiredSource } from '../domain/registry';
import { getWorkspaceRoot } from './workspacePicker';
import { getSourceResolver } from '../sources/registry';
import { resolveRecommendations, SourceResolutionAttempt } from '../engine/recommendations';
import { getAdapter, getEnabledAdapters } from '../adapters/registry';
import { planInstall } from '../engine/plan';
import { applyInstall } from '../engine/apply';
import type { PreparedInstall } from '../engine/types';
import type { SourcesTreeDataProvider } from './sourcesView';
import type { SourceResolution } from '../sources/types';

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


async function resolveSourcePackages(source: Source): Promise<SourceResolution> {
  try {
    const resolver = getSourceResolver(source.type);
    return await resolver.resolve(source);
  } catch {
    return { packages: [], diagnostics: [] };
  }
}

async function ensureRecommendableSource(
  sourcesProvider: SourcesTreeDataProvider,
  projectRoot: string,
  itemName: string,
  itemKind: ItemKind,
  existingSourceId?: string,
  existingArtifactId?: string
): Promise<{ sourceId: string; artifactId: string } | undefined> {
  const projectManifest = await readManifest('project', projectRoot);
  const globalManifest = await readManifest('global');

  if (existingSourceId && existingArtifactId) {
    const alreadyPortable = projectManifest.sources.some((s) => s.id === existingSourceId);
    if (alreadyPortable) {
      return { sourceId: existingSourceId, artifactId: existingArtifactId };
    }

    const globalSource = globalManifest.sources.find((s) => s.id === existingSourceId);
    if (!globalSource) {
      // Unregistered anywhere findable — let the resolution engine report it as broken.
      return { sourceId: existingSourceId, artifactId: existingArtifactId };
    }

    const choice = await vscode.window.showInformationMessage(
      `Source "${existingSourceId}" is only registered globally on this machine. To make this recommendation work for anyone who opens the project, it also needs to be registered as a project source.`,
      { modal: true },
      'Add & Continue'
    );
    if (choice !== 'Add & Continue') return undefined;

    projectManifest.sources.push({ ...globalSource });
    await writeManifest('project', projectManifest, projectRoot);
    sourcesProvider.refresh();
    return { sourceId: existingSourceId, artifactId: existingArtifactId };
  }

  // Untracked item: let the user point at the source that actually provides it.
  const bySourceId = new Map<string, { desired: DesiredSource; scope: Scope }>();
  for (const s of globalManifest.sources) bySourceId.set(s.id, { desired: s, scope: 'global' });
  for (const s of projectManifest.sources) bySourceId.set(s.id, { desired: s, scope: 'project' });

  const ADD_NEW = '$(add) Register a new source...';
  const picked = await vscode.window.showQuickPick(
    [
      { label: ADD_NEW },
      ...Array.from(bySourceId.values()).map((sc) => ({
        label: sc.desired.name ?? sc.desired.id,
        description: `${sc.desired.type} (${sc.scope})`,
        sc,
      })),
    ],
    { placeHolder: `"${itemName}" isn't tracked to a source yet — select the one that provides it` }
  );
  if (!picked) return undefined;

  let runtimeSource: Source | undefined;
  if (picked.label === ADD_NEW) {
    runtimeSource = await sourcesProvider.addSource('project');
    if (!runtimeSource) return undefined;
  } else if ('sc' in picked) {
    const { desired, scope } = picked.sc;
    runtimeSource = fromDesiredSource(desired, scope === 'project' ? projectRoot : undefined);
    if (scope === 'global') {
      const freshProjectManifest = await readManifest('project', projectRoot);
      if (!freshProjectManifest.sources.some((s) => s.id === desired.id)) {
        freshProjectManifest.sources.push({ ...desired });
        await writeManifest('project', freshProjectManifest, projectRoot);
        sourcesProvider.refresh();
      }
    }
  } else {
    return undefined;
  }

  let resolution: SourceResolution;
  try {
    resolution = await resolveSourcePackages(runtimeSource);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Failed to resolve source "${runtimeSource.id}": ${msg}`);
    return undefined;
  }

  const candidates = resolution.packages.flatMap((pkg) =>
    pkg.artifacts.filter((a) => a.kind === itemKind).map((artifact) => ({ pkg, artifact }))
  );
  if (candidates.length === 0) {
    vscode.window.showWarningMessage(`No ${itemKind} artifacts found in source "${runtimeSource.id}".`);
    return undefined;
  }

  const artifactChoice = await vscode.window.showQuickPick(
    candidates.map((c) => ({ label: c.artifact.name, description: c.pkg.id, c })),
    { placeHolder: `Select the artifact matching "${itemName}"` }
  );
  if (!artifactChoice) return undefined;

  return { sourceId: runtimeSource.id, artifactId: artifactChoice.c.artifact.id };
}

export async function recommendAvailableArtifact(
  sourceId: string,
  scope: Scope,
  artifactId: string,
  projectRoot: string
): Promise<boolean> {
  if (scope !== 'project') {
    vscode.window.showWarningMessage(`Cannot recommend global-scope items.`);
    return false;
  }
  const assistantPick = await vscode.window.showQuickPick(
    getEnabledAdapters().map((a) => a.assistant),
    {
      placeHolder: 'Select target AI assistant for recommendation',
    }
  );
  if (!assistantPick) return false;

  const assistant = assistantPick as AssistantId;

  try {
    const manifest = await readManifest('project', projectRoot);
    const existingIndex = manifest.desiredInstallations.findIndex(
      (d) => d.sourceId === sourceId && d.artifactId === artifactId && d.assistant === assistant
    );
    if (existingIndex === -1) {
      manifest.desiredInstallations.push({
        sourceId,
        artifactId,
        assistant,
        scope: 'project',
      });
      await writeManifest('project', manifest, projectRoot);
      vscode.window.showInformationMessage(`Item recommended for workspace.`);
      return true;
    }
    return false;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Failed to recommend item: ${msg}`);
    return false;
  }
}

export async function recommendInstalledArtifact(
  inst: ManagedInstallation,
  sourcesProvider: SourcesTreeDataProvider,
  projectRoot: string
): Promise<boolean> {
  const resolved = await ensureRecommendableSource(
    sourcesProvider,
    projectRoot,
    inst.name,
    inst.kind,
    inst.sourceId,
    inst.artifactId
  );
  if (!resolved) return false;

  const { sourceId, artifactId } = resolved;
  const assistant = inst.assistant;

  try {
    const manifest = await readManifest('project', projectRoot);
    const existingIndex = manifest.desiredInstallations.findIndex(
      (d) => d.sourceId === sourceId && d.artifactId === artifactId && d.assistant === assistant
    );
    if (existingIndex === -1) {
      manifest.desiredInstallations.push({
        sourceId,
        artifactId,
        assistant,
        scope: 'project',
      });
      await writeManifest('project', manifest, projectRoot);
      vscode.window.showInformationMessage(`Item recommended for workspace.`);
      return true;
    }
    return false;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Failed to recommend item: ${msg}`);
    return false;
  }
}

export async function unrecommendArtifactForWorkspace(
  sourceId: string,
  artifactId: string,
  assistant: AssistantId,
  projectRoot: string
): Promise<boolean> {
  try {
    const manifest = await readManifest('project', projectRoot);
    const existingIndex = manifest.desiredInstallations.findIndex(
      (d) => d.sourceId === sourceId && d.artifactId === artifactId && d.assistant === assistant
    );
    if (existingIndex !== -1) {
      manifest.desiredInstallations.splice(existingIndex, 1);
      await writeManifest('project', manifest, projectRoot);
      vscode.window.showInformationMessage(`Recommendation removed.`);
      return true;
    }
    return false;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Failed to unrecommend item: ${msg}`);
    return false;
  }
}

export async function unrecommendAvailableArtifact(
  sourceId: string,
  scope: Scope,
  artifactId: string,
  projectRoot: string
): Promise<boolean> {
  if (scope !== 'project') {
    vscode.window.showWarningMessage(`Cannot unrecommend global-scope items.`);
    return false;
  }
  const assistantPick = await vscode.window.showQuickPick(
    getEnabledAdapters().map((a) => a.assistant),
    {
      placeHolder: 'Select target AI assistant to remove recommendation',
    }
  );
  if (!assistantPick) return false;

  const assistant = assistantPick as AssistantId;

  try {
    const manifest = await readManifest('project', projectRoot);
    const existingIndex = manifest.desiredInstallations.findIndex(
      (d) => d.sourceId === sourceId && d.artifactId === artifactId && d.assistant === assistant
    );
    if (existingIndex !== -1) {
      manifest.desiredInstallations.splice(existingIndex, 1);
      await writeManifest('project', manifest, projectRoot);
      vscode.window.showInformationMessage(`Recommendation removed.`);
      return true;
    }
    return false;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Failed to unrecommend item: ${msg}`);
    return false;
  }
}

export async function unrecommendInstalledArtifact(
  inst: ManagedInstallation,
  projectRoot: string
): Promise<boolean> {
  if (!inst.sourceId || !inst.artifactId) {
    vscode.window.showWarningMessage("This item isn't tracked to a source and can't be unrecommended.");
    return false;
  }

  const { sourceId, artifactId, assistant } = inst;

  try {
    const manifest = await readManifest('project', projectRoot);
    const existingIndex = manifest.desiredInstallations.findIndex(
      (d) => d.sourceId === sourceId && d.artifactId === artifactId && d.assistant === assistant
    );
    if (existingIndex !== -1) {
      manifest.desiredInstallations.splice(existingIndex, 1);
      await writeManifest('project', manifest, projectRoot);
      vscode.window.showInformationMessage(`Recommendation removed.`);
      return true;
    }
    return false;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Failed to unrecommend item: ${msg}`);
    return false;
  }
}
