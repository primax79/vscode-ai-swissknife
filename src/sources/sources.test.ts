import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Source, ResolvedArtifact } from '../domain/types';
import type { CanonicalSkill } from '../adapters/types';
import { resolveGitSingleItem, resolveArtifactContent as resolveSingleItemContent } from './gitSingleItem';
import { resolveRemoteUrl } from './remoteUrl';

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

describe('git-single-item & remote-url resolvers', () => {
  let tempBase: string;
  let singleRepoDir: string;
  let cacheBaseDir: string;

  before(async () => {
    tempBase = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'minor-src-test-'));
    singleRepoDir = path.join(tempBase, 'single-repo');
    cacheBaseDir = path.join(tempBase, 'cache');

    await fs.promises.mkdir(singleRepoDir, { recursive: true });
    await fs.promises.mkdir(cacheBaseDir, { recursive: true });

    runGitSync(['init', '-b', 'main'], singleRepoDir);
    runGitSync(['config', 'user.name', 'Tester'], singleRepoDir);
    runGitSync(['config', 'user.email', 'test@example.com'], singleRepoDir);

    // Write root SKILL.md
    await fs.promises.writeFile(
      path.join(singleRepoDir, 'SKILL.md'),
      '---\nname: standalone-skill\ndescription: Standalone single skill\n---\n# Standalone Skill\n',
      'utf-8'
    );

    runGitSync(['add', '.'], singleRepoDir);
    runGitSync(['commit', '-m', 'Add standalone skill'], singleRepoDir);
  });

  after(async () => {
    if (tempBase && fs.existsSync(tempBase)) {
      await fs.promises.rm(tempBase, { recursive: true, force: true });
    }
  });

  it('resolves git-single-item source to 1 package with root skill artifact', async () => {
    const source: Source = {
      id: 'src-single',
      type: 'git-single-item',
      scope: 'project',
      url: singleRepoDir,
    };

    const resolution = await resolveGitSingleItem(source, { cacheDir: cacheBaseDir });
    assert.strictEqual(resolution.packages.length, 1);
    const pkg = resolution.packages[0];
    assert.strictEqual(pkg.artifacts.length, 1);
    assert.strictEqual(pkg.artifacts[0].name, 'standalone-skill');
    assert.strictEqual(pkg.artifacts[0].kind, 'skill');

    const resolved = (await resolveSingleItemContent(source, pkg, pkg.artifacts[0], {
      cacheDir: cacheBaseDir,
    })) as ResolvedArtifact<CanonicalSkill>;
    assert.strictEqual(resolved.content.name, 'standalone-skill');
  });

  it('resolves remote-url from local file URL mock', async () => {
    // Write local mock file
    const mockFile = path.join(tempBase, 'remote-agent.md');
    await fs.promises.writeFile(
      mockFile,
      '---\nname: remote-agent\ndescription: Agent from remote\ntools: ["read"]\n---\n# Remote Agent\n',
      'utf-8'
    );

    const source: Source = {
      id: 'src-remote',
      type: 'remote-url',
      scope: 'project',
      url: `file://${mockFile}`,
    };

    const resolution = await resolveRemoteUrl(source, { cacheDir: cacheBaseDir });
    assert.strictEqual(resolution.packages.length, 1);
    const pkg = resolution.packages[0];
    assert.strictEqual(pkg.artifacts[0].name, 'remote-agent');
    assert.strictEqual(pkg.artifacts[0].kind, 'agent');
  });
});
