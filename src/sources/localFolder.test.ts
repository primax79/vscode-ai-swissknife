import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Source, ResolvedArtifact } from '../domain/types';
import type { CanonicalSkill, CanonicalCommand, CanonicalMcpServer } from '../adapters/types';
import type { SourceResolution } from './types';
import { resolveLocalFolder, resolveArtifactContent, localFolderResolver } from './localFolder';

function getFixturesRoot(): string {
  const candidateOut = path.join(__dirname, '__fixtures__');
  if (fs.existsSync(candidateOut)) return candidateOut;
  return path.resolve(__dirname, '../../src/sources/__fixtures__');
}

describe('localFolder — resolveLocalFolder with committed fixtures', () => {
  const fixturesRoot = getFixturesRoot();
  const rootSkillPath = path.join(fixturesRoot, 'root-skill');
  const nestedSkillsPath = path.join(fixturesRoot, 'nested-skills');
  const mixedPath = path.join(fixturesRoot, 'mixed');

  it('resolves root-skill fixture to 1 package with 0 diagnostics', async () => {
    const source: Source = {
      id: 'src-root',
      type: 'local-folder',
      scope: 'project',
      localPath: rootSkillPath,
    };

    const resolution: SourceResolution = await resolveLocalFolder(source);
    assert.strictEqual(resolution.packages.length, 1);
    assert.strictEqual(resolution.diagnostics.length, 0);

    const pkg = resolution.packages[0];
    assert.strictEqual(pkg.sourceId, 'src-root');
    assert.strictEqual(pkg.nativeFormat, 'claude-skill');
    assert.strictEqual(pkg.artifacts.length, 1);

    const artifact = pkg.artifacts[0];
    assert.strictEqual(artifact.kind, 'skill');
    assert.strictEqual(artifact.name, 'root-skill');
    assert.strictEqual(artifact.packageId, pkg.id);
  });

  it('resolves nested-skills fixture to 2 packages deterministically', async () => {
    const source: Source = {
      id: 'src-nested',
      type: 'local-folder',
      scope: 'project',
      localPath: nestedSkillsPath,
    };

    const resolution1 = await resolveLocalFolder(source);
    const resolution2 = await resolveLocalFolder(source);

    assert.strictEqual(resolution1.packages.length, 2);
    assert.strictEqual(resolution2.packages.length, 2);
    assert.strictEqual(resolution1.diagnostics.length, 0);

    for (let i = 0; i < resolution1.packages.length; i++) {
      assert.strictEqual(resolution1.packages[i].id, resolution2.packages[i].id);
      assert.strictEqual(
        resolution1.packages[i].artifacts[0].id,
        resolution2.packages[i].artifacts[0].id
      );
    }
  });

  it('resolves mixed fixture including a skill with no explicit name in frontmatter', async () => {
    const source: Source = {
      id: 'src-mixed',
      type: 'local-folder',
      scope: 'project',
      localPath: mixedPath,
    };

    const resolution = await resolveLocalFolder(source);
    assert.strictEqual(resolution.packages.length, 2);
    // The mixed fixture's "malformed-skill" only omits `name` in frontmatter,
    // which falls back to the directory name — not diagnostic-worthy.
    assert.strictEqual(resolution.diagnostics.length, 0);
  });

  it('resolves fixtures root containing skills, agents, and commands', async () => {
    const source: Source = {
      id: 'src-all',
      type: 'local-folder',
      scope: 'project',
      localPath: fixturesRoot,
    };

    const resolution = await resolveLocalFolder(source);
    const agentPkg = resolution.packages.find((p) => p.artifacts[0].kind === 'agent');
    assert.ok(agentPkg);
    assert.strictEqual(agentPkg.artifacts[0].name, 'code-reviewer');

    const cmdPkg = resolution.packages.find((p) => p.artifacts[0].kind === 'command');
    assert.ok(cmdPkg);
    assert.strictEqual(cmdPkg.artifacts[0].name, 'review');

    const resolved = (await resolveArtifactContent(
      source,
      cmdPkg,
      cmdPkg.artifacts[0]
    )) as ResolvedArtifact<CanonicalCommand>;

    assert.strictEqual(resolved.content.name, 'review');
    assert.strictEqual(resolved.content.agent, 'code-reviewer');
  });

  it('resolves MCP server from mcp.json in local folder', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'local-mcp-'));
    try {
      await fs.promises.writeFile(
        path.join(tempDir, 'mcp.json'),
        JSON.stringify({
          mcpServers: {
            'github-mcp': {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-github'],
              description: 'GitHub MCP Server',
            },
          },
        }),
        'utf-8'
      );

      const source: Source = {
        id: 'src-local-mcp',
        type: 'local-folder',
        scope: 'project',
        localPath: tempDir,
      };

      const resolution = await resolveLocalFolder(source);
      assert.strictEqual(resolution.packages.length, 1);
      const pkg = resolution.packages[0];
      assert.strictEqual(pkg.artifacts[0].kind, 'mcp-server');
      assert.strictEqual(pkg.artifacts[0].name, 'github-mcp');

      const resolved = (await resolveArtifactContent(
        source,
        pkg,
        pkg.artifacts[0]
      )) as ResolvedArtifact<CanonicalMcpServer>;

      assert.strictEqual(resolved.content.id, 'github-mcp');
      assert.strictEqual(resolved.content.command, 'npx');
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('returns empty packages and diagnostics when source has no localPath or path does not exist', async () => {
    const emptySource: Source = {
      id: 'src-empty',
      type: 'local-folder',
      scope: 'global',
    };
    const resEmpty = await resolveLocalFolder(emptySource);
    assert.deepStrictEqual(resEmpty, { packages: [], diagnostics: [] });

    const nonExistentSource: Source = {
      id: 'src-nonexistent',
      type: 'local-folder',
      scope: 'global',
      localPath: path.join(fixturesRoot, 'nonexistent-' + Date.now()),
    };
    const resNonExistent = await resolveLocalFolder(nonExistentSource);
    assert.deepStrictEqual(resNonExistent, { packages: [], diagnostics: [] });
  });

  it('resolveArtifactContent resolves CanonicalSkill with auxiliary files without casts', async () => {
    const source: Source = {
      id: 'src-nested',
      type: 'local-folder',
      scope: 'project',
      localPath: nestedSkillsPath,
    };

    const resolution = await resolveLocalFolder(source);
    const skillBPkg = resolution.packages.find((p) => p.artifacts[0].name === 'nested-skill-b');
    assert.ok(skillBPkg);
    const artifact = skillBPkg.artifacts[0];

    const resolved = (await resolveArtifactContent(
      source,
      skillBPkg,
      artifact
    )) as ResolvedArtifact<CanonicalSkill>;
    assert.strictEqual(resolved.artifact.id, artifact.id);
    assert.strictEqual(resolved.content.name, 'nested-skill-b');
    assert.strictEqual(resolved.content.description, 'Second nested skill fixture with auxiliary script');
    assert.strictEqual(resolved.content.files.length, 1);
    assert.strictEqual(resolved.content.files[0].path, 'scripts/helper.sh');
  });

  it('exposes localFolderResolver conforming to SourceResolver', () => {
    assert.strictEqual(localFolderResolver.type, 'local-folder');
    assert.strictEqual(localFolderResolver.displayName, 'Local folder');
    assert.strictEqual(localFolderResolver.iconThemeId, 'folder');
    assert.strictEqual(localFolderResolver.resolve, resolveLocalFolder);
    assert.strictEqual(localFolderResolver.resolveArtifactContent, resolveArtifactContent);
  });
});

