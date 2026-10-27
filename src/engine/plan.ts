import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  CanonicalSkill,
  CanonicalAgent,
  CanonicalCommand,
  CanonicalMcpServer,
  CanonicalHook,
  CanonicalRule,
} from '../adapters/types';
import {
  toInstallationSourceIdentity,
  type ResolvedArtifact,
  type ResolvedRevision,
  type Source,
  type Package,
  type Artifact,
  type AssistantId,
} from '../domain/types';
import {
  serializeSkillMarkdown,
  serializeClaudeAgentMarkdown,
  serializeClaudeCommandMarkdown,
} from '../adapters/claude';
import {
  serializeKiloAgentMarkdown,
  serializeKiloCommandMarkdown,
} from '../adapters/kilo';
import {
  canonicalSkillHash,
  canonicalAgentHash,
  canonicalCommandHash,
  canonicalMcpServerHash,
  canonicalHookHash,
  canonicalRuleHash,
} from '../adapters/codec';
import { resolveArtifactContent as resolveLocalFolderContent } from '../sources/localFolder';
import { resolveArtifactContent as resolveGitCustomContent, gitCustomMutex } from '../sources/gitCustom';
import { resolveArtifactContent as resolveGitMarketplaceContent, gitMarketplaceMutex } from '../sources/gitMarketplace';
import { resolveArtifactContent as resolveGitSingleItemContent, gitSingleItemMutex } from '../sources/gitSingleItem';
import { resolveArtifactContent as resolveRemoteUrlContent } from '../sources/remoteUrl';
import {
  runGit,
  validateGitUrl,
  validateGitRef,
  resolveAndValidateCacheDir,
} from '../sources/gitProcess';
import { translateSkill } from '../translator/skill';
import { translateAgent } from '../translator/agent';
import { translateCommand } from '../translator/command';
import { translateMcpServer } from '../translator/mcp';
import { translateHook } from '../translator/hook';
import { translateRule } from '../translator/rule';
import type {
  PreparedInstall,
  PlanInstallParams,
  ExistingFile,
  ProposedFile,
} from './types';

function sha256(data: Uint8Array | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function computePlanSourceRevision(source: Source, pkg: Package) {
  if (!pkg.version) return undefined;
  if (source.type === 'local-folder' && !source.readWorkingTree && pkg.version.dirty) {
    return { ...pkg.version, dirty: false };
  }
  return pkg.version;
}

async function getDefaultBranchForClone(cwd: string): Promise<string> {
  try {
    const { stdout } = await runGit(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], cwd);
    return stdout.trim().replace(/^origin\//, '');
  } catch {
    // fallback
  }

  try {
    const { stdout } = await runGit(['branch', '--show-current'], cwd);
    const current = stdout.trim();
    if (current) {
      return current;
    }
  } catch {
    // fallback
  }

  return 'main';
}

/**
 * Resolves a git source's requested ref at install time (spec §3 rule 4),
 * fetching/cloning and checking out/resetting to the requested ref rather than
 * trusting a potentially stale `pkg.version.commit` from when the catalog loaded.
 */
async function resolveGitSourceRefAtInstallTime(
  source: Source,
  opts?: { cacheDir?: string; homeRoot?: string }
): Promise<ResolvedRevision> {
  validateGitUrl(source.type, source.url, source.id);
  if (source.commit) validateGitRef('commit', source.commit);
  if (source.tag) validateGitRef('tag', source.tag);
  if (source.branch) validateGitRef('branch', source.branch);

  const baseCacheDir =
    opts?.cacheDir ?? path.join(opts?.homeRoot ?? os.homedir(), '.ai-swissknife', 'cache', 'sources');
  const { targetDir } = resolveAndValidateCacheDir(baseCacheDir, source.id, source.url);

  const mutex =
    source.type === 'git-marketplace'
      ? gitMarketplaceMutex
      : source.type === 'git-single-item'
      ? gitSingleItemMutex
      : gitCustomMutex;

  return mutex.runExclusive(targetDir, async () => {
    if (fs.existsSync(targetDir) && !fs.existsSync(path.join(targetDir, '.git'))) {
      const resolvedTarget = path.resolve(targetDir);
      const resolvedBase = path.resolve(baseCacheDir);
      if (!resolvedTarget.startsWith(resolvedBase + path.sep)) {
        throw new Error(`Refusing to remove directory outside cache base: "${resolvedTarget}"`);
      }
      await fs.promises.rm(targetDir, { recursive: true, force: true });
    }

    const isExistingRepo = fs.existsSync(path.join(targetDir, '.git'));
    if (isExistingRepo) {
      await runGit(['fetch', '--all', '--tags', '--prune'], targetDir);
    } else {
      await fs.promises.mkdir(path.dirname(targetDir), { recursive: true });
      await runGit(['clone', '--', source.url!, targetDir]);
    }

    let requestedRef: string | undefined;
    if (source.commit) {
      requestedRef = source.commit;
      await runGit(['checkout', source.commit, '--'], targetDir);
    } else if (source.tag) {
      requestedRef = source.tag;
      await runGit(['checkout', source.tag, '--'], targetDir);
    } else if (source.branch) {
      requestedRef = source.branch;
      await runGit(['checkout', source.branch, '--'], targetDir);
      try {
        await runGit(['reset', '--hard', `origin/${source.branch}`], targetDir);
      } catch {
        // ignore
      }
    } else {
      const defaultBranch = await getDefaultBranchForClone(targetDir);
      await runGit(['checkout', defaultBranch, '--'], targetDir);
      try {
        await runGit(['reset', '--hard', `origin/${defaultBranch}`], targetDir);
      } catch {
        // ignore
      }
    }

    const { stdout: commitSha } = await runGit(['rev-parse', 'HEAD'], targetDir);
    const commit = commitSha.trim();
    return {
      commit,
      ...(requestedRef ? { requestedRef } : {}),
    };
  });
}

async function resolveContentFromSource(
  source: Source,
  pkg: Package,
  artifact: Artifact,
  resolverOpts?: { cacheDir?: string; homeRoot?: string }
): Promise<ResolvedArtifact<CanonicalSkill | CanonicalAgent | CanonicalCommand | CanonicalMcpServer | CanonicalHook | CanonicalRule>> {
  if (source.type === 'local-folder') {
    return await resolveLocalFolderContent(source, pkg, artifact);
  }
  if (source.type === 'git-custom') {
    return await resolveGitCustomContent(source, pkg, artifact, resolverOpts);
  }
  if (source.type === 'git-marketplace') {
    return await resolveGitMarketplaceContent(source, pkg, artifact, resolverOpts);
  }
  if (source.type === 'git-single-item') {
    return await resolveGitSingleItemContent(source, pkg, artifact, resolverOpts);
  }
  if (source.type === 'remote-url') {
    return await resolveRemoteUrlContent(source, pkg, artifact, resolverOpts);
  }
  throw new Error(`Unsupported source type: ${source.type}`);
}


export async function resolveAndTranslate(
  source: Source,
  pkg: Package,
  artifact: Artifact,
  targetAssistant: AssistantId,
  resolverOpts?: { cacheDir?: string; homeRoot?: string }
) {
  if (artifact.kind === 'rule') {
    const resolved = (await resolveContentFromSource(source, pkg, artifact, resolverOpts)) as ResolvedArtifact<CanonicalRule>;
    const translation = translateRule(resolved.content, targetAssistant);
    return { translated: translation.value, diagnostic: translation.overall, diagnostics: translation.diagnostics };
  }
  if (artifact.kind === 'hook') {
    const resolved = (await resolveContentFromSource(source, pkg, artifact, resolverOpts)) as ResolvedArtifact<CanonicalHook>;
    const translation = translateHook(resolved.content, targetAssistant);
    return { translated: translation.value, diagnostic: translation.overall, diagnostics: translation.diagnostics };
  }
  if (artifact.kind === 'mcp-server') {
    const resolved = (await resolveContentFromSource(source, pkg, artifact, resolverOpts)) as ResolvedArtifact<CanonicalMcpServer>;
    const translation = translateMcpServer(resolved.content, targetAssistant);
    return { translated: translation.value, diagnostic: translation.overall, diagnostics: translation.diagnostics };
  }
  if (artifact.kind === 'command') {
    const resolved = (await resolveContentFromSource(source, pkg, artifact, resolverOpts)) as ResolvedArtifact<CanonicalCommand>;
    const translation = translateCommand(resolved.content, targetAssistant);
    return { translated: translation.value, diagnostic: translation.overall, diagnostics: translation.diagnostics };
  }
  if (artifact.kind === 'agent') {
    const resolved = (await resolveContentFromSource(source, pkg, artifact, resolverOpts)) as ResolvedArtifact<CanonicalAgent>;
    const translation = translateAgent(resolved.content, targetAssistant);
    return { translated: translation.value, diagnostic: translation.overall, diagnostics: translation.diagnostics };
  }
  if (artifact.kind === 'skill') {
    const resolved = (await resolveContentFromSource(source, pkg, artifact, resolverOpts)) as ResolvedArtifact<CanonicalSkill>;
    const translation = translateSkill(resolved.content, targetAssistant);
    return { translated: translation.value, diagnostic: translation.overall, diagnostics: translation.diagnostics };
  }
  throw new Error(`Unsupported artifact kind: ${artifact.kind}`);
}

export async function planInstall(params: PlanInstallParams): Promise<PreparedInstall> {
  const { source, pkg: inputPkg, artifact, targetAdapter, targetScope } = params;
  const resolverOpts = { ...params.resolverOpts, homeRoot: params.homeRoot ?? params.resolverOpts?.homeRoot };
  const projectRoot = targetScope === 'project' ? params.projectRoot : undefined;
  const sourceIdentity = toInstallationSourceIdentity(source);

  if (
    artifact.kind !== 'skill' &&
    artifact.kind !== 'agent' &&
    artifact.kind !== 'command' &&
    artifact.kind !== 'mcp-server' &&
    artifact.kind !== 'hook' &&
    artifact.kind !== 'rule'
  ) {
    return {
      supported: false,
      plan: {
        supported: false,
        sourceId: source.id,
        packageId: inputPkg.id,
        artifactId: artifact.id,
        reason: `Artifact kind "${artifact.kind}" is not supported`,
      },
    };
  }

  let pkg: Package = inputPkg;
  if (
    !params.skipGitRefresh &&
    (source.type === 'git-custom' ||
      source.type === 'git-marketplace' ||
      source.type === 'git-single-item') &&
    source.url
  ) {
    try {
      const installTimeRevision = await resolveGitSourceRefAtInstallTime(source, resolverOpts);
      pkg = {
        ...inputPkg,
        version: installTimeRevision,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: inputPkg.id,
          artifactId: artifact.id,
          reason: `Git source resolution failed: ${msg}`,
        },
      };
    }
  }

  // --- RULE KIND ---
  if (artifact.kind === 'rule') {
    let contentResult;
    try {
      contentResult = await resolveAndTranslate(source, pkg, artifact, targetAdapter.assistant, resolverOpts);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Rule content resolution failed: ${msg}`,
        },
      };
    }

    if (contentResult.diagnostic === 'unsupported') {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Target assistant "${targetAdapter.assistant}" is not supported for rules`,
          diagnostics: contentResult.diagnostics,
        },
      };
    }

    const translatedRule = contentResult.translated as CanonicalRule;
    if (!targetAdapter.rulePath) {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Target adapter for "${targetAdapter.assistant}" does not support rule installation`,
          diagnostics: contentResult.diagnostics,
        },
      };
    }

    const targetFilePath = targetAdapter.rulePath({
      scope: targetScope,
      projectRoot,
    });

    const existingFiles: ExistingFile[] = [];
    try {
      const data = await fs.promises.readFile(targetFilePath);
      existingFiles.push({
        path: path.basename(targetFilePath),
        contentHash: sha256(data),
      });
    } catch {
      // ignore
    }

    const contentHash = canonicalRuleHash(translatedRule);
    const proposedFiles: ProposedFile[] = [
      {
        path: path.basename(targetFilePath),
        contentHash,
      },
    ];

    return {
      supported: true,
      kind: 'rule',
      plan: {
        supported: true,
        source: sourceIdentity,
        sourceId: source.id,
        packageId: pkg.id,
        artifactId: artifact.id,
        targetAssistant: targetAdapter.assistant,
        targetScope,
        targetDir: targetFilePath,
        projectRoot,
        sourceRevision: computePlanSourceRevision(source, pkg),
        sourceContentHash: contentHash,
        conflict: existingFiles.length > 0,
        existingFiles,
        proposedFiles,
        diagnostics: contentResult.diagnostics,
      },
      content: translatedRule,
      contentHash,
      sourceContentHash: contentHash,
    };
  }

  // --- HOOK KIND ---
  if (artifact.kind === 'hook') {
    let contentResult;
    try {
      contentResult = await resolveAndTranslate(source, pkg, artifact, targetAdapter.assistant, resolverOpts);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Hook content resolution failed: ${msg}`,
        },
      };
    }

    if (contentResult.diagnostic === 'unsupported') {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Target assistant "${targetAdapter.assistant}" is not supported for hooks`,
          diagnostics: contentResult.diagnostics,
        },
      };
    }

    const translatedHook = contentResult.translated as CanonicalHook;
    if (!targetAdapter.hookPath) {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Target adapter for "${targetAdapter.assistant}" does not support hook installation`,
          diagnostics: contentResult.diagnostics,
        },
      };
    }

    const targetFilePath = targetAdapter.hookPath(translatedHook.name, {
      scope: targetScope,
      projectRoot,
    });

    const existingFiles: ExistingFile[] = [];
    try {
      const data = await fs.promises.readFile(targetFilePath);
      existingFiles.push({
        path: path.basename(targetFilePath),
        contentHash: sha256(data),
      });
    } catch {
      // ignore
    }

    const contentHash = canonicalHookHash(translatedHook);
    const proposedFiles: ProposedFile[] = [
      {
        path: path.basename(targetFilePath),
        contentHash,
      },
    ];

    return {
      supported: true,
      kind: 'hook',
      plan: {
        supported: true,
        source: sourceIdentity,
        sourceId: source.id,
        packageId: pkg.id,
        artifactId: artifact.id,
        targetAssistant: targetAdapter.assistant,
        targetScope,
        targetDir: targetFilePath,
        projectRoot,
        sourceRevision: computePlanSourceRevision(source, pkg),
        sourceContentHash: contentHash,
        conflict: existingFiles.length > 0,
        existingFiles,
        proposedFiles,
        diagnostics: contentResult.diagnostics,
      },
      content: translatedHook,
      contentHash,
      sourceContentHash: contentHash,
    };
  }

  // --- MCP-SERVER KIND ---
  if (artifact.kind === 'mcp-server') {
    let contentResult;
    try {
      contentResult = await resolveAndTranslate(source, pkg, artifact, targetAdapter.assistant, resolverOpts);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `MCP content resolution failed: ${msg}`,
        },
      };
    }

    if (contentResult.diagnostic === 'unsupported') {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Target assistant "${targetAdapter.assistant}" is not supported for MCP servers`,
          diagnostics: contentResult.diagnostics,
        },
      };
    }

    const translatedMcp = contentResult.translated as CanonicalMcpServer;
    if (!targetAdapter.mcpConfigPath) {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Target adapter for "${targetAdapter.assistant}" does not support MCP installation`,
          diagnostics: contentResult.diagnostics,
        },
      };
    }

    const targetFilePath = targetAdapter.mcpConfigPath({
      scope: targetScope,
      projectRoot,
    });

    let conflict = false;
    const existingFiles: ExistingFile[] = [];

    if (targetAdapter.readMcpServer) {
      try {
        const existing = await targetAdapter.readMcpServer(translatedMcp.id, {
          scope: targetScope,
          projectRoot,
        });
        if (existing) {
          conflict = true;
          existingFiles.push({
            path: path.basename(targetFilePath),
            contentHash: canonicalMcpServerHash(existing),
          });
        }
      } catch {
        // ignore
      }
    }

    const contentHash = canonicalMcpServerHash(translatedMcp);
    const proposedFiles: ProposedFile[] = [
      {
        path: path.basename(targetFilePath),
        contentHash,
      },
    ];

    return {
      supported: true,
      kind: 'mcp-server',
      plan: {
        supported: true,
        source: sourceIdentity,
        sourceId: source.id,
        packageId: pkg.id,
        artifactId: artifact.id,
        targetAssistant: targetAdapter.assistant,
        targetScope,
        targetDir: targetFilePath,
        projectRoot,
        sourceRevision: computePlanSourceRevision(source, pkg),
        sourceContentHash: contentHash,
        conflict,
        existingFiles,
        proposedFiles,
        diagnostics: contentResult.diagnostics,
      },
      content: translatedMcp,
      contentHash,
      sourceContentHash: contentHash,
    };
  }

  // --- COMMAND KIND ---
  if (artifact.kind === 'command') {
    let contentResult;
    try {
      contentResult = await resolveAndTranslate(source, pkg, artifact, targetAdapter.assistant, resolverOpts);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Command content resolution failed: ${msg}`,
        },
      };
    }

    if (contentResult.diagnostic === 'unsupported') {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Target assistant "${targetAdapter.assistant}" is not supported for commands`,
          diagnostics: contentResult.diagnostics,
        },
      };
    }

    const translatedCmd = contentResult.translated as CanonicalCommand;
    if (!targetAdapter.commandPath) {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Target adapter for "${targetAdapter.assistant}" does not support command installation`,
          diagnostics: contentResult.diagnostics,
        },
      };
    }

    const targetFilePath = targetAdapter.commandPath(translatedCmd.name, {
      scope: targetScope,
      projectRoot,
    });

    const existingFiles: ExistingFile[] = [];
    try {
      const stat = await fs.promises.lstat(targetFilePath);
      if (stat.isSymbolicLink() || stat.isDirectory()) {
        return {
          supported: false,
          plan: {
            supported: false,
            sourceId: source.id,
            packageId: pkg.id,
            artifactId: artifact.id,
            reason: `Target command path "${targetFilePath}" is a directory or symlink and will not be overwritten`,
            diagnostics: contentResult.diagnostics,
          },
        };
      }
      const data = await fs.promises.readFile(targetFilePath);
      existingFiles.push({
        path: path.basename(targetFilePath),
        contentHash: sha256(data),
      });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          supported: false,
          plan: {
            supported: false,
            sourceId: source.id,
            packageId: pkg.id,
            artifactId: artifact.id,
            reason: `Error inspecting target command file: ${msg}`,
            diagnostics: contentResult.diagnostics,
          },
        };
      }
    }

    const serialized =
      targetAdapter.assistant === 'kilo-code'
        ? serializeKiloCommandMarkdown(translatedCmd)
        : serializeClaudeCommandMarkdown(translatedCmd);

    const proposedFiles: ProposedFile[] = [
      {
        path: path.basename(targetFilePath),
        contentHash: sha256(Buffer.from(serialized, 'utf-8')),
      },
    ];

    const conflict = existingFiles.length > 0;
    const contentHash = canonicalCommandHash(translatedCmd);

    return {
      supported: true,
      kind: 'command',
      plan: {
        supported: true,
        source: sourceIdentity,
        sourceId: source.id,
        packageId: pkg.id,
        artifactId: artifact.id,
        targetAssistant: targetAdapter.assistant,
        targetScope,
        targetDir: targetFilePath,
        projectRoot,
        sourceRevision: computePlanSourceRevision(source, pkg),
        sourceContentHash: contentHash,
        conflict,
        existingFiles,
        proposedFiles,
        diagnostics: contentResult.diagnostics,
      },
      content: translatedCmd,
      contentHash,
      sourceContentHash: contentHash,
    };
  }

  // --- AGENT KIND ---
  if (artifact.kind === 'agent') {
    let contentResult;
    try {
      contentResult = await resolveAndTranslate(source, pkg, artifact, targetAdapter.assistant, resolverOpts);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Agent content resolution failed: ${msg}`,
        },
      };
    }

    if (contentResult.diagnostic === 'unsupported') {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Target assistant "${targetAdapter.assistant}" is not supported for agents`,
          diagnostics: contentResult.diagnostics,
        },
      };
    }

    const translatedAgent = contentResult.translated as CanonicalAgent;
    if (!targetAdapter.agentPath) {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Target adapter for "${targetAdapter.assistant}" does not support agent installation`,
          diagnostics: contentResult.diagnostics,
        },
      };
    }

    const targetFilePath = targetAdapter.agentPath(translatedAgent.name, {
      scope: targetScope,
      projectRoot,
    });

    const existingFiles: ExistingFile[] = [];
    try {
      const stat = await fs.promises.lstat(targetFilePath);
      if (stat.isSymbolicLink() || stat.isDirectory()) {
        return {
          supported: false,
          plan: {
            supported: false,
            sourceId: source.id,
            packageId: pkg.id,
            artifactId: artifact.id,
            reason: `Target agent path "${targetFilePath}" is a directory or symlink and will not be overwritten`,
            diagnostics: contentResult.diagnostics,
          },
        };
      }
      const data = await fs.promises.readFile(targetFilePath);
      existingFiles.push({
        path: path.basename(targetFilePath),
        contentHash: sha256(data),
      });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          supported: false,
          plan: {
            supported: false,
            sourceId: source.id,
            packageId: pkg.id,
            artifactId: artifact.id,
            reason: `Error inspecting target agent file: ${msg}`,
            diagnostics: contentResult.diagnostics,
          },
        };
      }
    }

    const serialized =
      targetAdapter.assistant === 'kilo-code'
        ? serializeKiloAgentMarkdown(translatedAgent)
        : serializeClaudeAgentMarkdown(translatedAgent);

    const proposedFiles: ProposedFile[] = [
      {
        path: path.basename(targetFilePath),
        contentHash: sha256(Buffer.from(serialized, 'utf-8')),
      },
    ];

    const conflict = existingFiles.length > 0;
    const contentHash = canonicalAgentHash(translatedAgent);

    return {
      supported: true,
      kind: 'agent',
      plan: {
        supported: true,
        source: sourceIdentity,
        sourceId: source.id,
        packageId: pkg.id,
        artifactId: artifact.id,
        targetAssistant: targetAdapter.assistant,
        targetScope,
        targetDir: targetFilePath,
        projectRoot,
        sourceRevision: computePlanSourceRevision(source, pkg),
        sourceContentHash: contentHash,
        conflict,
        existingFiles,
        proposedFiles,
        diagnostics: contentResult.diagnostics,
      },
      content: translatedAgent,
      contentHash,
      sourceContentHash: contentHash,
    };
  }

  // --- SKILL KIND ---
  let contentResult;
  try {
    contentResult = await resolveAndTranslate(source, pkg, artifact, targetAdapter.assistant, resolverOpts);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      supported: false,
      plan: {
        supported: false,
        sourceId: source.id,
        packageId: pkg.id,
        artifactId: artifact.id,
        reason: `Content resolution failed: ${msg}`,
      },
    };
  }

  if (contentResult.diagnostic === 'unsupported') {
    return {
      supported: false,
      plan: {
        supported: false,
        sourceId: source.id,
        packageId: pkg.id,
        artifactId: artifact.id,
        reason: `Target assistant "${targetAdapter.assistant}" is not supported in Phase 1`,
        diagnostics: contentResult.diagnostics,
      },
    };
  }

  const translatedSkill = contentResult.translated as CanonicalSkill;

  let targetDir: string;
  try {
    targetDir = targetAdapter.skillDir(translatedSkill.name, {
      scope: targetScope,
      projectRoot,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      supported: false,
      plan: {
        supported: false,
        sourceId: source.id,
        packageId: pkg.id,
        artifactId: artifact.id,
        reason: `Failed to resolve target directory: ${msg}`,
        diagnostics: contentResult.diagnostics,
      },
    };
  }

  const existingFiles: ExistingFile[] = [];
  try {
    const targetStat = await fs.promises.lstat(targetDir);

    if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Target path "${targetDir}" is a ${targetStat.isSymbolicLink() ? 'symlink' : 'non-directory file'} and will not be followed or overwritten`,
          diagnostics: contentResult.diagnostics,
        },
      };
    }

    const walk = async (currentDir: string, relativeRoot: string): Promise<boolean> => {
      const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.name === '.git' ||
          entry.name === 'node_modules' ||
          entry.name === 'index.json' ||
          entry.name === 'local.patch' ||
          entry.name.endsWith('.patch') ||
          entry.name === '.DS_Store' ||
          entry.name === 'Thumbs.db'
        ) {
          continue;
        }
        const fullPath = path.join(currentDir, entry.name);
        const relPath = relativeRoot === '' ? entry.name : path.posix.join(relativeRoot, entry.name);

        const stat = await fs.promises.lstat(fullPath);
        if (stat.isSymbolicLink() || stat.isSocket() || stat.isFIFO() || stat.isBlockDevice() || stat.isCharacterDevice()) {
          return false;
        }

        if (stat.isDirectory()) {
          const ok = await walk(fullPath, relPath);
          if (!ok) return false;
        } else if (stat.isFile()) {
          try {
            const data = await fs.promises.readFile(fullPath);
            existingFiles.push({
              path: path.posix.normalize(relPath),
              contentHash: sha256(data),
            });
          } catch {
            return false;
          }
        }
      }
      return true;
    };

    const walkOk = await walk(targetDir, '');
    if (!walkOk) {
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Target directory "${targetDir}" contains symlinks, special files, or unreadable entries`,
          diagnostics: contentResult.diagnostics,
        },
      };
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        supported: false,
        plan: {
          supported: false,
          sourceId: source.id,
          packageId: pkg.id,
          artifactId: artifact.id,
          reason: `Error inspecting target directory: ${msg}`,
          diagnostics: contentResult.diagnostics,
        },
      };
    }
  }

  const proposedFiles: ProposedFile[] = [];
  const skillMdContent = serializeSkillMarkdown(translatedSkill);
  proposedFiles.push({
    path: 'SKILL.md',
    contentHash: sha256(Buffer.from(skillMdContent, 'utf-8')),
  });

  for (const f of translatedSkill.files) {
    proposedFiles.push({
      path: path.posix.normalize(f.path.split(path.sep).join('/')),
      contentHash: sha256(f.content),
      ...(f.mode !== undefined ? { mode: f.mode } : {}),
    });
  }

  const conflict = existingFiles.length > 0;
  const contentHash = canonicalSkillHash(translatedSkill);

  return {
    supported: true,
    kind: 'skill',
    plan: {
      supported: true,
      source: sourceIdentity,
      sourceId: source.id,
      packageId: pkg.id,
      artifactId: artifact.id,
      targetAssistant: targetAdapter.assistant,
      targetScope,
      targetDir: targetDir,
      projectRoot,
      sourceRevision: computePlanSourceRevision(source, pkg),
      sourceContentHash: contentHash,
      conflict,
      existingFiles,
      proposedFiles,
      diagnostics: contentResult.diagnostics,
    },
    content: translatedSkill,
    contentHash,
    sourceContentHash: contentHash,
  };
}
