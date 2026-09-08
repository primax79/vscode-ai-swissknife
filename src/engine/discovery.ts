import * as fs from 'fs';
import type {
  ManagedInstallation,
  ObservedArtifact,
  Scope,
  AssistantId,
  ItemKind,
  Source,
  ObservedSourceMatch,
} from '../domain/types';
import type {
  CanonicalSkill,
  CanonicalAgent,
  CanonicalCommand,
  CanonicalMcpServer,
  CanonicalHook,
  CanonicalRule,
} from '../adapters/types';
import { readState, writeState, readManifest, fromDesiredSource } from '../domain/registry';
import {
  canonicalSkillHash,
  canonicalAgentHash,
  canonicalCommandHash,
  canonicalMcpServerHash,
  canonicalHookHash,
  canonicalRuleHash,
  readSkill,
} from '../adapters/codec';
import { ClaudeAdapter, claudeAdapter } from '../adapters/claude';
import { KiloAdapter, kiloAdapter } from '../adapters/kilo';
import { CopilotAdapter, copilotAdapter } from '../adapters/copilot';
import { CodexAdapter, codexAdapter } from '../adapters/codex';
import { GeminiAdapter, geminiAdapter } from '../adapters/gemini';
import { resolveLocalFolder } from '../sources/localFolder';
import { resolveGitCustom } from '../sources/gitCustom';
import { resolveGitMarketplace } from '../sources/gitMarketplace';
import { resolveGitSingleItem } from '../sources/gitSingleItem';
import { resolveRemoteUrl } from '../sources/remoteUrl';
import type { SourceResolution } from '../sources/types';
import { resolveAndTranslate } from './plan';

function getAdapter(assistant: AssistantId, homeRoot?: string) {
  if (homeRoot) {
    if (assistant === 'claude-code') return new ClaudeAdapter(() => homeRoot);
    if (assistant === 'kilo-code') return new KiloAdapter(() => homeRoot);
    if (assistant === 'github-copilot') return new CopilotAdapter(() => homeRoot);
    if (assistant === 'codex-cli') return new CodexAdapter(() => homeRoot);
    if (assistant === 'gemini-cli') return new GeminiAdapter(() => homeRoot);
  }
  if (assistant === 'claude-code') return claudeAdapter;
  if (assistant === 'kilo-code') return kiloAdapter;
  if (assistant === 'github-copilot') return copilotAdapter;
  if (assistant === 'codex-cli') return codexAdapter;
  if (assistant === 'gemini-cli') return geminiAdapter;
  throw new Error(`Unsupported assistant: ${assistant}`);
}

/**
 * Scans the filesystem for all artifacts installed on the given scope,
 * distinguishing managed installations (recorded in state.json) from unmanaged observed artifacts,
 * and analyzing whether observed artifacts match registered source versions.
 */
export async function scanInstalledInventory(
  scope: Scope,
  projectRoot?: string,
  homeRoot?: string
): Promise<{ managed: ManagedInstallation[]; observed: ObservedArtifact[] }> {
  const state = await readState(scope, projectRoot, homeRoot);
  const managed = state.installations;

  const managedSet = new Set<string>();
  for (const m of managed) {
    managedSet.add(`${m.assistant}:${m.scope}:${m.kind}:${m.name}`);
  }

  const rawObserved: ObservedArtifact[] = [];
  const assistants: AssistantId[] = ['claude-code', 'kilo-code', 'github-copilot', 'codex-cli', 'gemini-cli'];
  const loc = { scope, projectRoot };
  const now = new Date().toISOString();

  for (const assistant of assistants) {
    const adapter = getAdapter(assistant, homeRoot);

    // Skills
    try {
      const skills = await adapter.listSkills(loc);
      for (const name of skills) {
        if (!managedSet.has(`${assistant}:${scope}:skill:${name}`)) {
          const itemPath = adapter.skillDir(name, loc);
          let contentHash: string | undefined;
          try {
            const skill = await readSkill(itemPath);
            contentHash = canonicalSkillHash(skill);
          } catch {
            // ignore
          }
          rawObserved.push({
            assistant,
            scope,
            projectPath: projectRoot,
            kind: 'skill',
            name,
            path: itemPath,
            discoveredAt: now,
            contentHash,
          });
        }
      }
    } catch {
      // ignore
    }

    // Agents
    try {
      const agents = await adapter.listAgents(loc);
      for (const name of agents) {
        if (!managedSet.has(`${assistant}:${scope}:agent:${name}`)) {
          const itemPath = adapter.agentPath(name, loc);
          let contentHash: string | undefined;
          try {
            const agent = await adapter.readAgent(name, loc);
            if (agent) contentHash = canonicalAgentHash(agent);
          } catch {
            // ignore
          }
          rawObserved.push({
            assistant,
            scope,
            projectPath: projectRoot,
            kind: 'agent',
            name,
            path: itemPath,
            discoveredAt: now,
            contentHash,
          });
        }
      }
    } catch {
      // ignore
    }

    // Commands
    try {
      const commands = await adapter.listCommands(loc);
      for (const name of commands) {
        if (!managedSet.has(`${assistant}:${scope}:command:${name}`)) {
          const itemPath = adapter.commandPath(name, loc);
          let contentHash: string | undefined;
          try {
            const cmd = await adapter.readCommand(name, loc);
            if (cmd) contentHash = canonicalCommandHash(cmd);
          } catch {
            // ignore
          }
          rawObserved.push({
            assistant,
            scope,
            projectPath: projectRoot,
            kind: 'command',
            name,
            path: itemPath,
            discoveredAt: now,
            contentHash,
          });
        }
      }
    } catch {
      // ignore
    }

    // MCP Servers
    try {
      const mcps = await adapter.listMcpServers(loc);
      for (const id of mcps) {
        if (!managedSet.has(`${assistant}:${scope}:mcp-server:${id}`)) {
          const itemPath = adapter.mcpConfigPath(loc);
          let contentHash: string | undefined;
          try {
            const mcp = await adapter.readMcpServer(id, loc);
            if (mcp) contentHash = canonicalMcpServerHash(mcp);
          } catch {
            // ignore
          }
          rawObserved.push({
            assistant,
            scope,
            projectPath: projectRoot,
            kind: 'mcp-server',
            name: id,
            path: itemPath,
            discoveredAt: now,
            contentHash,
          });
        }
      }
    } catch {
      // ignore
    }
  }

  // Load all registered sources for cross-matching
  const allSources: Source[] = [];
  try {
    const gManifest = await readManifest('global', undefined, homeRoot);
    allSources.push(...gManifest.sources.map((d) => fromDesiredSource(d, undefined, homeRoot)));
  } catch {
    // ignore
  }

  if (projectRoot) {
    try {
      const pManifest = await readManifest('project', projectRoot, homeRoot);
      allSources.push(...pManifest.sources.map((d) => fromDesiredSource(d, projectRoot, homeRoot)));
    } catch {
      // ignore
    }
  }

  // Resolve each registered source at most once per scan. Resolution can involve a
  // `git fetch` or a network request, so it must not be repeated per observed artifact
  // (that previously made this loop O(observed × sources) network calls).
  const resolvedSources: { source: Source; resolution: SourceResolution }[] = [];
  for (const source of allSources) {
    try {
      let resolution;
      if (source.type === 'local-folder') {
        resolution = await resolveLocalFolder(source);
      } else if (source.type === 'git-custom') {
        resolution = await resolveGitCustom(source);
      } else if (source.type === 'git-marketplace') {
        resolution = await resolveGitMarketplace(source);
      } else if (source.type === 'git-single-item') {
        resolution = await resolveGitSingleItem(source);
      } else if (source.type === 'remote-url') {
        resolution = await resolveRemoteUrl(source);
      }

      if (resolution) {
        resolvedSources.push({ source, resolution });
      }
    } catch {
      // ignore source resolution errors during passive discovery
    }
  }

  // Match each observed artifact against the already-resolved sources
  const observed: ObservedArtifact[] = [];

  for (const obs of rawObserved) {
    const candidates: ObservedSourceMatch[] = [];

    for (const { source, resolution } of resolvedSources) {
      for (const pkg of resolution.packages) {
        for (const art of pkg.artifacts) {
          if (art.kind === obs.kind && art.name === obs.name) {
            try {
              const result = await resolveAndTranslate(source, pkg, art, obs.assistant);
              let sourceHash: string | undefined;
              if (art.kind === 'skill') {
                sourceHash = canonicalSkillHash(result.translated as CanonicalSkill);
              } else if (art.kind === 'agent') {
                sourceHash = canonicalAgentHash(result.translated as CanonicalAgent);
              } else if (art.kind === 'command') {
                sourceHash = canonicalCommandHash(result.translated as CanonicalCommand);
              } else if (art.kind === 'mcp-server') {
                sourceHash = canonicalMcpServerHash(result.translated as CanonicalMcpServer);
              } else if (art.kind === 'hook') {
                sourceHash = canonicalHookHash(result.translated as CanonicalHook);
              } else if (art.kind === 'rule') {
                sourceHash = canonicalRuleHash(result.translated as CanonicalRule);
              }

              if (sourceHash && obs.contentHash && sourceHash === obs.contentHash) {
                candidates.push({
                  status: 'identical',
                  sourceId: source.id,
                  packageId: pkg.id,
                  artifactId: art.id,
                  sourceRevision: pkg.version,
                  details: `Identical to source "${source.id}"`,
                });
              } else if (sourceHash) {
                candidates.push({
                  status: 'different',
                  sourceId: source.id,
                  packageId: pkg.id,
                  artifactId: art.id,
                  sourceRevision: pkg.version,
                  details: `Differs from source "${source.id}"`,
                });
              }
            } catch {
              // ignore
            }
          }
        }
      }
    }

    let match: ObservedSourceMatch = {
      status: 'unmatched',
      details: 'Local component (no registered source match)',
    };

    if (candidates.length > 0) {
      match = candidates.find((c) => c.status === 'identical') || candidates[0];
    }

    observed.push({
      ...obs,
      candidates,
      match,
    });
  }

  return { managed, observed };
}

/**
 * Promotes an ObservedArtifact to a ManagedInstallation, computing its current disk hash and saving it in state.json.
 */
export async function promoteObservedArtifact(
  observed: ObservedArtifact,
  provenance: Pick<ObservedSourceMatch, 'sourceId' | 'packageId' | 'artifactId' | 'sourceRevision'>,
  homeRoot?: string
): Promise<ManagedInstallation> {
  const adapter = getAdapter(observed.assistant, homeRoot);
  const loc = { scope: observed.scope, projectRoot: observed.projectPath };

  let contentHash = observed.contentHash;

  if (!contentHash) {
    if (observed.kind === 'skill') {
      if (!fs.existsSync(observed.path)) {
        throw new Error(`Cannot promote skill "${observed.name}": directory missing at ${observed.path}`);
      }
      const skill = await readSkill(observed.path);
      contentHash = canonicalSkillHash(skill);
    } else if (observed.kind === 'agent') {
      const agent = await adapter.readAgent(observed.name, loc);
      if (!agent) {
        throw new Error(`Cannot promote agent "${observed.name}": file missing`);
      }
      contentHash = canonicalAgentHash(agent);
    } else if (observed.kind === 'command') {
      const cmd = await adapter.readCommand(observed.name, loc);
      if (!cmd) {
        throw new Error(`Cannot promote command "${observed.name}": file missing`);
      }
      contentHash = canonicalCommandHash(cmd);
    } else if (observed.kind === 'mcp-server') {
      const mcp = await adapter.readMcpServer(observed.name, loc);
      if (!mcp) {
        throw new Error(`Cannot promote MCP server "${observed.name}": not found in config`);
      }
      contentHash = canonicalMcpServerHash(mcp);
    }
  }

  const finalSourceId = provenance.sourceId;
  if (!finalSourceId) {
    throw new Error('Explicit source provenance is required to promote an artifact.');
  }
  const finalPackageId = provenance.packageId;
  const finalArtifactId = provenance.artifactId;
  const finalSourceRevision = provenance.sourceRevision;

  const installation: ManagedInstallation = {
    assistant: observed.assistant,
    scope: observed.scope,
    projectPath: observed.projectPath,
    kind: observed.kind as ItemKind,
    name: observed.name,
    path: observed.path,
    sourceId: finalSourceId,
    ...(finalPackageId ? { packageId: finalPackageId } : {}),
    ...(finalArtifactId ? { artifactId: finalArtifactId } : {}),
    ...(finalSourceRevision ? { sourceRevision: finalSourceRevision } : {}),
    installedAt: new Date().toISOString(),
    contentHash,
  };

  const state = await readState(observed.scope, observed.projectPath, homeRoot);
  const filtered = state.installations.filter(
    (i) =>
      !(
        i.assistant === observed.assistant &&
        i.scope === observed.scope &&
        i.projectPath === observed.projectPath &&
        i.kind === observed.kind &&
        i.name === observed.name
      )
  );
  filtered.push(installation);

  await writeState(
    observed.scope,
    {
      schemaVersion: state.schemaVersion,
      installations: filtered,
    },
    observed.projectPath,
    homeRoot
  );

  return installation;
}
