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
} from '../adapters/types';
import { readState, writeState, readManifest, fromDesiredSource } from '../domain/registry';
import {
  canonicalSkillHash,
  canonicalAgentHash,
  canonicalCommandHash,
  canonicalMcpServerHash,
  readSkill,
} from '../adapters/codec';
import { ClaudeAdapter, claudeAdapter } from '../adapters/claude';
import { KiloAdapter, kiloAdapter } from '../adapters/kilo';
import { CopilotAdapter, copilotAdapter } from '../adapters/copilot';
import { resolveLocalFolder, resolveArtifactContent as resolveLocalFolderContent } from '../sources/localFolder';
import { resolveGitCustom, resolveArtifactContent as resolveGitCustomContent } from '../sources/gitCustom';
import { resolveGitMarketplace, resolveArtifactContent as resolveGitMarketplaceContent } from '../sources/gitMarketplace';
import { translateSkill } from '../translator/skill';
import { translateAgent } from '../translator/agent';
import { translateCommand } from '../translator/command';
import { translateMcpServer } from '../translator/mcp';

function getAdapter(assistant: AssistantId, homeRoot?: string) {
  if (homeRoot) {
    if (assistant === 'claude-code') return new ClaudeAdapter(() => homeRoot);
    if (assistant === 'kilo-code') return new KiloAdapter(() => homeRoot);
    if (assistant === 'github-copilot') return new CopilotAdapter(() => homeRoot);
  }
  if (assistant === 'claude-code') return claudeAdapter;
  if (assistant === 'kilo-code') return kiloAdapter;
  if (assistant === 'github-copilot') return copilotAdapter;
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
  const assistants: AssistantId[] = ['claude-code', 'kilo-code', 'github-copilot'];
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

  // Match each observed artifact against registered sources
  const observed: ObservedArtifact[] = [];

  for (const obs of rawObserved) {
    let match: ObservedSourceMatch = {
      status: 'unmatched',
      details: 'Local component (no registered source match)',
    };

    for (const source of allSources) {
      try {
        let resolution;
        if (source.type === 'local-folder') {
          resolution = await resolveLocalFolder(source);
        } else if (source.type === 'git-custom') {
          resolution = await resolveGitCustom(source);
        } else if (source.type === 'git-marketplace') {
          resolution = await resolveGitMarketplace(source);
        }

        if (!resolution) continue;

        let foundPkg;
        let foundArt;

        for (const pkg of resolution.packages) {
          for (const art of pkg.artifacts) {
            if (art.kind === obs.kind && art.name === obs.name) {
              foundPkg = pkg;
              foundArt = art;
              break;
            }
          }
          if (foundArt) break;
        }

        if (foundPkg && foundArt) {
          let resolved;
          if (source.type === 'local-folder') {
            resolved = await resolveLocalFolderContent(source, foundPkg, foundArt);
          } else if (source.type === 'git-custom') {
            resolved = await resolveGitCustomContent(source, foundPkg, foundArt);
          } else if (source.type === 'git-marketplace') {
            resolved = await resolveGitMarketplaceContent(source, foundPkg, foundArt);
          }

          if (resolved) {
            let sourceHash: string | undefined;
            if (foundArt.kind === 'skill') {
              const translated = translateSkill(resolved.content as CanonicalSkill, obs.assistant);
              sourceHash = canonicalSkillHash(translated.value);
            } else if (foundArt.kind === 'agent') {
              const translated = translateAgent(resolved.content as CanonicalAgent, obs.assistant);
              sourceHash = canonicalAgentHash(translated.value);
            } else if (foundArt.kind === 'command') {
              const translated = translateCommand(resolved.content as CanonicalCommand, obs.assistant);
              sourceHash = canonicalCommandHash(translated.value);
            } else if (foundArt.kind === 'mcp-server') {
              const translated = translateMcpServer(resolved.content as CanonicalMcpServer, obs.assistant);
              sourceHash = canonicalMcpServerHash(translated.value);
            }

            if (sourceHash && obs.contentHash && sourceHash === obs.contentHash) {
              match = {
                status: 'identical',
                sourceId: source.id,
                packageId: foundPkg.id,
                artifactId: foundArt.id,
                sourceRevision: foundPkg.version,
                details: `Identical to source "${source.id}"`,
              };
              break; // exact match found
            } else if (sourceHash) {
              match = {
                status: 'different',
                sourceId: source.id,
                packageId: foundPkg.id,
                artifactId: foundArt.id,
                sourceRevision: foundPkg.version,
                details: `Differs from source "${source.id}"`,
              };
            }
          }
        }
      } catch {
        // ignore source resolution errors during passive discovery
      }
    }

    observed.push({
      ...obs,
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
  sourceId?: string,
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

  const finalSourceId = observed.match?.sourceId ?? sourceId ?? 'local-promotion';
  const finalPackageId = observed.match?.packageId;
  const finalArtifactId = observed.match?.artifactId;
  const finalSourceRevision = observed.match?.sourceRevision;

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
