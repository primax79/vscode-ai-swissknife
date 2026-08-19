import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Source, ResolvedArtifact } from '../domain/types';
import type { CanonicalSkill, CanonicalAgent, CanonicalCommand, CanonicalMcpServer } from '../adapters/types';
import { resolveGitMarketplace, resolveArtifactContent } from './gitMarketplace';

function runGitSync(args: string[], cwd: string): string {
  return child_process
    .execFileSync('git', args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
      },
    })
    .toString();
}

function getFixturesRoot(): string {
  const candidateOut = path.join(__dirname, '__fixtures__');
  if (fs.existsSync(candidateOut)) return candidateOut;
  return path.resolve(__dirname, '../../src/sources/__fixtures__');
}

describe('gitMarketplace — resolveGitMarketplace', () => {
  let tempBase: string;
  let remoteRepoDir: string;
  let cacheBaseDir: string;
  let commitHash: string;

  const fixturesRoot = getFixturesRoot();

  before(async () => {
    tempBase = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'git-mkt-test-'));
    remoteRepoDir = path.join(tempBase, 'marketplace-repo');
    cacheBaseDir = path.join(tempBase, 'cache');

    await fs.promises.mkdir(remoteRepoDir, { recursive: true });
    await fs.promises.mkdir(cacheBaseDir, { recursive: true });

    runGitSync(['init', '-b', 'main'], remoteRepoDir);
    runGitSync(['config', 'user.name', 'Marketplace Engineer'], remoteRepoDir);
    runGitSync(['config', 'user.email', 'mkt@test.local'], remoteRepoDir);

    // Create plugin 1: developer-tools (contains skills and agents)
    const plugin1Dir = path.join(remoteRepoDir, 'plugins', 'developer-tools');
    await fs.promises.mkdir(path.join(plugin1Dir, 'skills', 'root-skill'), { recursive: true });
    await fs.promises.mkdir(path.join(plugin1Dir, 'agents'), { recursive: true });

    await fs.promises.cp(
      path.join(fixturesRoot, 'root-skill', 'SKILL.md'),
      path.join(plugin1Dir, 'skills', 'root-skill', 'SKILL.md')
    );
    await fs.promises.cp(
      path.join(fixturesRoot, 'agents', 'code-reviewer.md'),
      path.join(plugin1Dir, 'agents', 'code-reviewer.md')
    );

    // Create plugin 2: automation-tools (contains commands and mcps)
    const plugin2Dir = path.join(remoteRepoDir, 'plugins', 'automation-tools');
    await fs.promises.mkdir(path.join(plugin2Dir, 'commands'), { recursive: true });
    await fs.promises.cp(
      path.join(fixturesRoot, 'commands', 'review.md'),
      path.join(plugin2Dir, 'commands', 'review.md')
    );

    await fs.promises.writeFile(
      path.join(plugin2Dir, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          'db-service': {
            command: 'uvx',
            args: ['mcp-server-db'],
            description: 'Database MCP Server',
          },
        },
      }),
      'utf-8'
    );

    // Create .claude-plugin/marketplace.json manifest
    const manifestDir = path.join(remoteRepoDir, '.claude-plugin');
    await fs.promises.mkdir(manifestDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(manifestDir, 'marketplace.json'),
      JSON.stringify({
        plugins: [
          {
            name: 'developer-tools',
            description: 'Core developer skills and agents',
            source: 'plugins/developer-tools',
          },
          {
            name: 'automation-tools',
            description: 'Automation commands and MCPs',
            source: 'plugins/automation-tools',
          },
        ],
      }),
      'utf-8'
    );

    runGitSync(['add', '.'], remoteRepoDir);
    runGitSync(['commit', '-m', 'Add marketplace manifest and plugins'], remoteRepoDir);
    commitHash = runGitSync(['rev-parse', 'HEAD'], remoteRepoDir).trim();
    runGitSync(['tag', 'v1.0.0'], remoteRepoDir);
  });

  after(async () => {
    if (tempBase && fs.existsSync(tempBase)) {
      await fs.promises.rm(tempBase, { recursive: true, force: true });
    }
  });

  it('resolves marketplace manifest into packages with typed artifacts', async () => {
    const source: Source = {
      id: 'src-mkt',
      type: 'git-marketplace',
      scope: 'project',
      url: remoteRepoDir,
    };

    const resolution = await resolveGitMarketplace(source, { cacheDir: cacheBaseDir });
    assert.strictEqual(resolution.packages.length, 2); // 2 plugin packages
    assert.strictEqual(resolution.diagnostics.length, 0);

    const devPkg = resolution.packages.find((p) => p.id === 'src-mkt:developer-tools');
    assert.ok(devPkg);
    assert.strictEqual(devPkg.artifacts.length, 2);
    assert.strictEqual(devPkg.version?.commit, commitHash);
    const skillArt = devPkg.artifacts.find((a) => a.kind === 'skill');
    const agentArt = devPkg.artifacts.find((a) => a.kind === 'agent');
    assert.ok(skillArt);
    assert.strictEqual(skillArt.name, 'root-skill');
    assert.ok(agentArt);
    assert.strictEqual(agentArt.name, 'code-reviewer');

    const autoPkg = resolution.packages.find((p) => p.id === 'src-mkt:automation-tools');
    assert.ok(autoPkg);
    assert.strictEqual(autoPkg.artifacts.length, 2);
    const cmdArt = autoPkg.artifacts.find((a) => a.kind === 'command');
    const mcpArt = autoPkg.artifacts.find((a) => a.kind === 'mcp-server');
    assert.ok(cmdArt);
    assert.strictEqual(cmdArt.name, 'review');
    assert.ok(mcpArt);
    assert.strictEqual(mcpArt.name, 'db-service');
  });

  it('resolves content for all kinds of artifacts from marketplace repository', async () => {
    const source: Source = {
      id: 'src-mkt',
      type: 'git-marketplace',
      scope: 'project',
      url: remoteRepoDir,
      tag: 'v1.0.0',
    };

    const resolution = await resolveGitMarketplace(source, { cacheDir: cacheBaseDir });
    const devPkg = resolution.packages.find((p) => p.id === 'src-mkt:developer-tools')!;
    const skillArt = devPkg.artifacts.find((a) => a.kind === 'skill')!;
    const agentArt = devPkg.artifacts.find((a) => a.kind === 'agent')!;

    const skillContent = (await resolveArtifactContent(source, devPkg, skillArt, {
      cacheDir: cacheBaseDir,
    })) as ResolvedArtifact<CanonicalSkill>;
    assert.strictEqual(skillContent.content.name, 'root-skill');

    const agentContent = (await resolveArtifactContent(source, devPkg, agentArt, {
      cacheDir: cacheBaseDir,
    })) as ResolvedArtifact<CanonicalAgent>;
    assert.strictEqual(agentContent.content.name, 'code-reviewer');

    const autoPkg = resolution.packages.find((p) => p.id === 'src-mkt:automation-tools')!;
    const cmdArt = autoPkg.artifacts.find((a) => a.kind === 'command')!;
    const mcpArt = autoPkg.artifacts.find((a) => a.kind === 'mcp-server')!;

    const cmdContent = (await resolveArtifactContent(source, autoPkg, cmdArt, {
      cacheDir: cacheBaseDir,
    })) as ResolvedArtifact<CanonicalCommand>;
    assert.strictEqual(cmdContent.content.name, 'review');

    const mcpContent = (await resolveArtifactContent(source, autoPkg, mcpArt, {
      cacheDir: cacheBaseDir,
    })) as ResolvedArtifact<CanonicalMcpServer>;
    assert.strictEqual(mcpContent.content.id, 'db-service');
    assert.strictEqual(mcpContent.content.command, 'uvx');
  });
});
