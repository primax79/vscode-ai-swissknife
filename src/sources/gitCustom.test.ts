import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Source } from '../domain/types';
import { resolveGitCustom } from './gitCustom';

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

function getFixturePath(skillName: string): string {
  const candidates = [
    path.join('/Users/Alfredo/works/ai-coding-tools/agentic-coding-kit/plugins/common-tools/skills', skillName),
    path.join('/Users/Alfredo/works/ai-coding-tools/agentic-coding-kit/plugins/third-party/skills', skillName),
    path.join(os.homedir(), '.claude/skills', skillName),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'SKILL.md'))) {
      return c;
    }
  }
  throw new Error(`Fixture for skill "${skillName}" not found in candidate paths`);
}

describe('gitCustom — resolveGitCustom with real local git repository', () => {
  let tempBase: string;
  let remoteRepoDir: string;
  let cacheBaseDir: string;
  let initialCommitHash: string;
  let secondCommitHash: string;

  before(() => {
    tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'git-custom-test-'));
    remoteRepoDir = path.join(tempBase, 'remote-repo');
    cacheBaseDir = path.join(tempBase, 'cache');

    fs.mkdirSync(remoteRepoDir, { recursive: true });
    fs.mkdirSync(cacheBaseDir, { recursive: true });

    // Initialize real git repository
    runGitSync(['init', '-b', 'main'], remoteRepoDir);
    runGitSync(['config', 'user.name', 'Test Engineer'], remoteRepoDir);
    runGitSync(['config', 'user.email', 'engineer@test.local'], remoteRepoDir);

    // Commit 1: add gitignore skill
    const gitignoreFixture = getFixturePath('gitignore');
    const destGitignore = path.join(remoteRepoDir, 'skills', 'gitignore');
    fs.cpSync(gitignoreFixture, destGitignore, { recursive: true });

    runGitSync(['add', '.'], remoteRepoDir);
    runGitSync(['commit', '-m', 'Add gitignore skill'], remoteRepoDir);
    initialCommitHash = runGitSync(['rev-parse', 'HEAD'], remoteRepoDir).trim();
    runGitSync(['tag', 'v1.0.0'], remoteRepoDir);

    // Commit 2: add markdown-formatter skill
    const mdFormatterFixture = getFixturePath('markdown-formatter');
    const destMdFormatter = path.join(remoteRepoDir, 'skills', 'markdown-formatter');
    fs.cpSync(mdFormatterFixture, destMdFormatter, { recursive: true });

    runGitSync(['add', '.'], remoteRepoDir);
    runGitSync(['commit', '-m', 'Add markdown-formatter skill'], remoteRepoDir);
    secondCommitHash = runGitSync(['rev-parse', 'HEAD'], remoteRepoDir).trim();
    runGitSync(['tag', 'v2.0.0'], remoteRepoDir);

    // Branch feature-skills: add theme-factory skill
    runGitSync(['checkout', '-b', 'feature-skills'], remoteRepoDir);
    const themeFactoryFixture = getFixturePath('theme-factory');
    const destThemeFactory = path.join(remoteRepoDir, 'skills', 'theme-factory');
    fs.cpSync(themeFactoryFixture, destThemeFactory, { recursive: true });

    runGitSync(['add', '.'], remoteRepoDir);
    runGitSync(['commit', '-m', 'Add theme-factory skill on branch'], remoteRepoDir);

    // Switch back to default branch (main)
    runGitSync(['checkout', 'main'], remoteRepoDir);
  });

  after(() => {
    if (tempBase && fs.existsSync(tempBase)) {
      fs.rmSync(tempBase, { recursive: true, force: true });
    }
  });

  it('resolves default branch to all skills on latest main commit', async () => {
    const source: Source = {
      id: 'src-test-default',
      type: 'git-custom',
      scope: 'project',
      url: remoteRepoDir,
    };

    const packages = await resolveGitCustom(source, { cacheDir: cacheBaseDir });
    assert.strictEqual(packages.length, 2);

    const names = packages.map((p) => p.artifacts[0].name);
    assert.ok(names.includes('gitignore'));
    assert.ok(names.includes('markdown-formatter'));

    for (const pkg of packages) {
      assert.strictEqual(pkg.sourceId, 'src-test-default');
      assert.strictEqual(pkg.nativeFormat, 'claude-skill');
      assert.strictEqual(pkg.artifacts.length, 1);
      assert.strictEqual(pkg.artifacts[0].kind, 'skill');
      assert.strictEqual(pkg.artifacts[0].packageId, pkg.id);
      assert.strictEqual(pkg.artifacts[0].nativeFormat, 'claude-skill');
    }
  });

  it('resolves a specific tag pin (v1.0.0) resolving an earlier state', async () => {
    const source: Source = {
      id: 'src-test-tag-v1',
      type: 'git-custom',
      scope: 'project',
      url: remoteRepoDir,
      tag: 'v1.0.0',
    };

    const packages = await resolveGitCustom(source, { cacheDir: cacheBaseDir });
    assert.strictEqual(packages.length, 1);
    assert.strictEqual(packages[0].artifacts[0].name, 'gitignore');
    assert.strictEqual(packages[0].version, 'v1.0.0');
  });

  it('resolves a specific tag pin (v2.0.0) and commit pin for second commit', async () => {
    const sourceTag: Source = {
      id: 'src-test-tag-v2',
      type: 'git-custom',
      scope: 'project',
      url: remoteRepoDir,
      tag: 'v2.0.0',
    };
    const packagesTag = await resolveGitCustom(sourceTag, { cacheDir: cacheBaseDir });
    assert.strictEqual(packagesTag.length, 2);
    assert.strictEqual(packagesTag[0].version, 'v2.0.0');

    const sourceCommit: Source = {
      id: 'src-test-commit-second',
      type: 'git-custom',
      scope: 'project',
      url: remoteRepoDir,
      commit: secondCommitHash,
    };
    const packagesCommit = await resolveGitCustom(sourceCommit, { cacheDir: cacheBaseDir });
    assert.strictEqual(packagesCommit.length, 2);
    assert.strictEqual(packagesCommit[0].version, secondCommitHash);
  });

  it('resolves a specific commit pin resolving an earlier state', async () => {
    const source: Source = {
      id: 'src-test-commit-initial',
      type: 'git-custom',
      scope: 'project',
      url: remoteRepoDir,
      commit: initialCommitHash,
    };

    const packages = await resolveGitCustom(source, { cacheDir: cacheBaseDir });
    assert.strictEqual(packages.length, 1);
    assert.strictEqual(packages[0].artifacts[0].name, 'gitignore');
    assert.strictEqual(packages[0].version, initialCommitHash);
  });

  it('resolves a specific branch pin (feature-skills)', async () => {
    const source: Source = {
      id: 'src-test-branch-feature',
      type: 'git-custom',
      scope: 'project',
      url: remoteRepoDir,
      branch: 'feature-skills',
    };

    const packages = await resolveGitCustom(source, { cacheDir: cacheBaseDir });
    assert.strictEqual(packages.length, 3);

    const names = packages.map((p) => p.artifacts[0].name);
    assert.ok(names.includes('gitignore'));
    assert.ok(names.includes('markdown-formatter'));
    assert.ok(names.includes('theme-factory'));
  });

  it('re-resolves a second time reusing the cache dir via git fetch', async () => {
    const source: Source = {
      id: 'src-test-cache-reuse',
      type: 'git-custom',
      scope: 'project',
      url: remoteRepoDir,
    };

    // First resolution
    const packagesBefore = await resolveGitCustom(source, { cacheDir: cacheBaseDir });
    assert.strictEqual(packagesBefore.length, 2);

    // Add a new commit to the remote repo on main
    const changelogFixture = getFixturePath('changelog-generator');
    const destChangelog = path.join(remoteRepoDir, 'skills', 'changelog-generator');
    fs.cpSync(changelogFixture, destChangelog, { recursive: true });

    runGitSync(['add', '.'], remoteRepoDir);
    runGitSync(['commit', '-m', 'Add changelog-generator skill on remote main'], remoteRepoDir);

    // Second resolution with the same cache directory: should fetch and find the 3rd skill
    const packagesAfter = await resolveGitCustom(source, { cacheDir: cacheBaseDir });
    assert.strictEqual(packagesAfter.length, 3);

    const namesAfter = packagesAfter.map((p) => p.artifacts[0].name);
    assert.ok(namesAfter.includes('gitignore'));
    assert.ok(namesAfter.includes('markdown-formatter'));
    assert.ok(namesAfter.includes('changelog-generator'));
  });

  it('throws a clear error for a nonexistent git repository path', async () => {
    const nonexistentSource: Source = {
      id: 'src-test-nonexistent',
      type: 'git-custom',
      scope: 'project',
      url: path.join(tempBase, 'does-not-exist-' + Date.now()),
    };

    await assert.rejects(
      async () => {
        await resolveGitCustom(nonexistentSource, { cacheDir: cacheBaseDir });
      },
      (err: Error) => {
        assert.ok(err.message.includes('Git command failed'));
        return true;
      }
    );
  });

  it('throws a clear error when source.url is missing or empty', async () => {
    const sourceNoUrl: Source = {
      id: 'src-test-no-url',
      type: 'git-custom',
      scope: 'project',
    };

    await assert.rejects(
      async () => {
        await resolveGitCustom(sourceNoUrl, { cacheDir: cacheBaseDir });
      },
      /source\.url is required/
    );
  });
});
