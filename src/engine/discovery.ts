import * as fs from 'fs';
import type {
  ManagedInstallation,
  ObservedArtifact,
  Scope,
  AssistantId,
  ItemKind,
} from '../domain/types';
import { readState, writeState } from '../domain/registry';
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
 * distinguishing managed installations (recorded in state.json) from unmanaged observed artifacts.
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

  const observed: ObservedArtifact[] = [];
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
          observed.push({
            assistant,
            scope,
            projectPath: projectRoot,
            kind: 'skill',
            name,
            path: adapter.skillDir(name, loc),
            discoveredAt: now,
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
          observed.push({
            assistant,
            scope,
            projectPath: projectRoot,
            kind: 'agent',
            name,
            path: adapter.agentPath(name, loc),
            discoveredAt: now,
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
          observed.push({
            assistant,
            scope,
            projectPath: projectRoot,
            kind: 'command',
            name,
            path: adapter.commandPath(name, loc),
            discoveredAt: now,
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
          observed.push({
            assistant,
            scope,
            projectPath: projectRoot,
            kind: 'mcp-server',
            name: id,
            path: adapter.mcpConfigPath(loc),
            discoveredAt: now,
          });
        }
      }
    } catch {
      // ignore
    }
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

  let contentHash: string | undefined;

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

  const installation: ManagedInstallation = {
    assistant: observed.assistant,
    scope: observed.scope,
    projectPath: observed.projectPath,
    kind: observed.kind as ItemKind,
    name: observed.name,
    path: observed.path,
    sourceId: sourceId ?? 'local-promotion',
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
