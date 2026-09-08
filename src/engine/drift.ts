import * as fs from 'fs';
import type { ManagedInstallation, Source } from '../domain/types';
import type {
  CanonicalSkill,
  CanonicalAgent,
  CanonicalCommand,
  CanonicalMcpServer,
  CanonicalHook,
  CanonicalRule,
} from '../adapters/types';
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
import { resolveAndTranslate } from './plan';
import type { DriftReport } from './types';

function getAdapter(assistant: string, homeRoot?: string) {
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
 * Analyzes whether an installed item has drifted on the local disk relative to its recorded contentHash in state.json.
 */
export async function analyzeLocalDrift(
  installation: ManagedInstallation,
  homeRoot?: string
): Promise<DriftReport> {
  const adapter = getAdapter(installation.assistant, homeRoot);
  const loc = {
    scope: installation.scope,
    projectRoot: installation.projectPath,
  };

  let diskHash: string | undefined;

  if (installation.kind === 'skill') {
    if (!fs.existsSync(installation.path)) {
      return {
        installation,
        status: 'missing-on-disk',
        details: `Skill directory not found at ${installation.path}`,
      };
    }
    try {
      const skill = await readSkill(installation.path);
      diskHash = canonicalSkillHash(skill);
    } catch {
      return {
        installation,
        status: 'missing-on-disk',
        details: `Failed to read skill at ${installation.path}`,
      };
    }
  } else if (installation.kind === 'agent') {
    const agent = await adapter.readAgent(installation.name, loc);
    if (!agent) {
      return {
        installation,
        status: 'missing-on-disk',
        details: `Agent file not found for ${installation.name}`,
      };
    }
    diskHash = canonicalAgentHash(agent);
  } else if (installation.kind === 'command') {
    const cmd = await adapter.readCommand(installation.name, loc);
    if (!cmd) {
      return {
        installation,
        status: 'missing-on-disk',
        details: `Command file not found for ${installation.name}`,
      };
    }
    diskHash = canonicalCommandHash(cmd);
  } else if (installation.kind === 'mcp-server') {
    const mcp = await adapter.readMcpServer(installation.name, loc);
    if (!mcp) {
      return {
        installation,
        status: 'missing-on-disk',
        details: `MCP server config not found for ${installation.name}`,
      };
    }
    diskHash = canonicalMcpServerHash(mcp);
  } else if (installation.kind === 'hook') {
    const hook = await adapter.readHook(installation.name, loc);
    if (!hook) {
      return {
        installation,
        status: 'missing-on-disk',
        details: `Hook config not found for ${installation.name}`,
      };
    }
    diskHash = canonicalHookHash(hook);
  } else if (installation.kind === 'rule') {
    const rule = await adapter.readRule(loc);
    if (!rule) {
      return {
        installation,
        status: 'missing-on-disk',
        details: `Rule not found for scope ${installation.scope}`,
      };
    }
    diskHash = canonicalRuleHash(rule);
  }

  if (installation.contentHash && diskHash !== installation.contentHash) {
    return {
      installation,
      status: 'modified-locally',
      diskHash,
      details: 'Local content differs from installed version',
    };
  }

  return {
    installation,
    status: 'up-to-date',
    diskHash,
  };
}

/**
 * Checks whether an installed item has a newer version available from its upstream source.
 */
export async function checkForUpstreamUpdate(
  installation: ManagedInstallation,
  source: Source,
  homeRoot?: string
): Promise<DriftReport> {
  const localReport = await analyzeLocalDrift(installation, homeRoot);
  if (localReport.status === 'missing-on-disk') {
    return localReport;
  }

  let resolution;
  try {
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
    } else {
      return localReport;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ...localReport,
      details: `Failed to resolve upstream source: ${msg}`,
    };
  }

  // Find matching package & artifact in resolution
  let foundPkg;
  let foundArt;

  for (const pkg of resolution.packages) {
    for (const art of pkg.artifacts) {
      if (
        (installation.artifactId && art.id === installation.artifactId) ||
        (art.kind === installation.kind && art.name === installation.name)
      ) {
        foundPkg = pkg;
        foundArt = art;
        break;
      }
    }
    if (foundArt) break;
  }

  if (!foundPkg || !foundArt) {
    return localReport;
  }

  let sourceHash: string | undefined;
  try {
    const result = await resolveAndTranslate(source, foundPkg, foundArt, installation.assistant);

    if (foundArt.kind === 'skill') {
      sourceHash = canonicalSkillHash(result.translated as CanonicalSkill);
    } else if (foundArt.kind === 'agent') {
      sourceHash = canonicalAgentHash(result.translated as CanonicalAgent);
    } else if (foundArt.kind === 'command') {
      sourceHash = canonicalCommandHash(result.translated as CanonicalCommand);
    } else if (foundArt.kind === 'mcp-server') {
      sourceHash = canonicalMcpServerHash(result.translated as CanonicalMcpServer);
    } else if (foundArt.kind === 'hook') {
      sourceHash = canonicalHookHash(result.translated as CanonicalHook);
    } else if (foundArt.kind === 'rule') {
      sourceHash = canonicalRuleHash(result.translated as CanonicalRule);
    }
  } catch {
    return localReport;
  }

  if (sourceHash && installation.contentHash && sourceHash !== installation.contentHash) {
    if (localReport.status === 'modified-locally') {
      return {
        installation,
        status: 'modified-and-update-available',
        diskHash: localReport.diskHash,
        sourceHash,
        details: 'Local files were modified and upstream source has a newer version',
      };
    }
    return {
      installation,
      status: 'update-available',
      diskHash: localReport.diskHash,
      sourceHash,
      details: 'A newer version is available from upstream source',
    };
  }

  return {
    ...localReport,
    sourceHash,
  };
}
