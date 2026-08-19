import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Source, ResolvedArtifact } from '../domain/types';
import type { CanonicalSkill } from '../adapters/types';
import { resolveLocalFolder, resolveArtifactContent } from './localFolder';

describe('localFolder — resolveLocalFolder with real fixtures', () => {
  const fixture1Path = '/Users/Alfredo/works/ai-coding-tools/agentic-coding-kit/plugins/common-tools/skills/gitignore';
  const fixture2Path = fs.existsSync(path.resolve(process.cwd(), 'references/cc-swiss-knife/plugins/core/skills/documentation-standards'))
    ? path.resolve(process.cwd(), 'references/cc-swiss-knife/plugins/core/skills/documentation-standards')
    : '/Users/Alfredo/works/ai-coding-tools/ai-swissknife/references/cc-swiss-knife/plugins/core/skills/documentation-standards';
  const fixture3Path = path.join(os.homedir(), '.claude/skills');

  it('resolves fixture 1 to 1 package with 1 skill artifact', async () => {
    const source: Source = {
      id: 'src-ack-gitignore',
      type: 'local-folder',
      scope: 'project',
      localPath: fixture1Path,
    };

    const packages = await resolveLocalFolder(source);
    assert.strictEqual(packages.length, 1);

    const pkg = packages[0];
    assert.strictEqual(pkg.sourceId, 'src-ack-gitignore');
    assert.strictEqual(pkg.nativeFormat, 'claude-skill');
    assert.strictEqual(pkg.artifacts.length, 1);

    const artifact = pkg.artifacts[0];
    assert.strictEqual(artifact.kind, 'skill');
    assert.strictEqual(artifact.name, 'gitignore');
    assert.strictEqual(artifact.packageId, pkg.id);
    assert.strictEqual(artifact.nativeFormat, 'claude-skill');
  });

  it('resolves fixture 2 to 1 package with 1 skill artifact', async () => {
    const source: Source = {
      id: 'src-cc-swissknife',
      type: 'local-folder',
      scope: 'project',
      localPath: fixture2Path,
    };

    const packages = await resolveLocalFolder(source);
    assert.strictEqual(packages.length, 1);

    const pkg = packages[0];
    assert.strictEqual(pkg.sourceId, 'src-cc-swissknife');
    assert.strictEqual(pkg.artifacts.length, 1);

    const artifact = pkg.artifacts[0];
    assert.strictEqual(artifact.kind, 'skill');
    assert.strictEqual(artifact.name, 'documentation-standards');
  });

  it('resolves fixture 3 (~/.claude/skills) to 25 packages with deterministic IDs', async () => {
    const source: Source = {
      id: 'src-claude-skills',
      type: 'local-folder',
      scope: 'global',
      localPath: fixture3Path,
    };

    const packagesRun1 = await resolveLocalFolder(source);
    const packagesRun2 = await resolveLocalFolder(source);

    assert.strictEqual(packagesRun1.length, 25);
    assert.strictEqual(packagesRun2.length, 25);

    // Verify determinism of package and artifact IDs across resolutions
    for (let i = 0; i < packagesRun1.length; i++) {
      assert.strictEqual(packagesRun1[i].id, packagesRun2[i].id);
      assert.strictEqual(packagesRun1[i].artifacts[0].id, packagesRun2[i].artifacts[0].id);
      assert.strictEqual(packagesRun1[i].artifacts[0].kind, 'skill');
    }

    const artifactNames = packagesRun1.map((p) => p.artifacts[0].name);
    assert.ok(artifactNames.includes('gitignore'));
    assert.ok(artifactNames.includes('terraform'));
    assert.ok(artifactNames.includes('mcp-orchestrator'));
  });

  it('returns empty array when source has no localPath or path does not exist', async () => {
    const emptySource: Source = {
      id: 'src-empty',
      type: 'local-folder',
      scope: 'global',
    };
    const resEmpty = await resolveLocalFolder(emptySource);
    assert.deepStrictEqual(resEmpty, []);

    const nonExistentSource: Source = {
      id: 'src-nonexistent',
      type: 'local-folder',
      scope: 'global',
      localPath: '/tmp/non-existent-source-' + Date.now(),
    };
    const resNonExistent = await resolveLocalFolder(nonExistentSource);
    assert.deepStrictEqual(resNonExistent, []);
  });

  it('resolveArtifactContent resolves CanonicalSkill correctly without casts', async () => {
    const source: Source = {
      id: 'src-ack-gitignore',
      type: 'local-folder',
      scope: 'project',
      localPath: fixture1Path,
    };

    const packages = await resolveLocalFolder(source);
    const pkg = packages[0];
    const artifact = pkg.artifacts[0];

    const resolved: ResolvedArtifact<CanonicalSkill> = await resolveArtifactContent(source, pkg, artifact);
    assert.strictEqual(resolved.artifact.id, artifact.id);
    assert.strictEqual(resolved.content.name, 'gitignore');
    assert.ok(resolved.content.description.length > 0);
    assert.ok(Array.isArray(resolved.content.files));
  });
});
