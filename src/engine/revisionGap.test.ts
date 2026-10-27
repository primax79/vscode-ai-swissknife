import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ManagedInstallation, Source } from '../domain/types';
import { resolveAndValidateCacheDir } from '../sources/gitProcess';
import { describeRevisionGap } from './revisionGap';

function runGitSync(args: string[], cwd: string, extraEnv?: Record<string, string>): string {
  return child_process
    .execFileSync('git', args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        ...extraEnv,
      },
    })
    .toString();
}

function initRepo(repoDir: string): void {
  fs.mkdirSync(repoDir, { recursive: true });
  runGitSync(['init', '-b', 'main'], repoDir);
  runGitSync(['config', 'user.name', 'Revision Gap Test'], repoDir);
  runGitSync(['config', 'user.email', 'gap@test.local'], repoDir);
}

function commitWithDate(repoDir: string, fileName: string, content: string, message: string, isoDate: string): string {
  fs.writeFileSync(path.join(repoDir, fileName), content, 'utf-8');
  runGitSync(['add', '.'], repoDir);
  runGitSync(['commit', '-m', message], repoDir, {
    GIT_AUTHOR_DATE: isoDate,
    GIT_COMMITTER_DATE: isoDate,
  });
  return runGitSync(['rev-parse', 'HEAD'], repoDir).trim();
}

function makeInstallation(overrides: Partial<ManagedInstallation> = {}): ManagedInstallation {
  return {
    assistant: 'claude-code',
    scope: 'project',
    kind: 'skill',
    name: 'alpha-skill',
    path: '/tmp/alpha-skill',
    sourceId: 'team-git',
    installedAt: '2026-10-01T00:00:00.000Z',
    contentHash: 'deadbeef',
    ...overrides,
  };
}

describe('describeRevisionGap — commit distance & revision gap engine', () => {
  let tempDir: string;

  before(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-swissknife-revgap-'));
  });

  after(async () => {
    if (tempDir && fs.existsSync(tempDir)) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('computes commitsBehind and behindDays for a git source using the 49.2 cache key (id + location hash) without fetching or cloning', async () => {
    const cacheDir = path.join(tempDir, 'cache-1');
    const sourceUrl = 'https://example.com/org/team-git.git';
    const source: Source = {
      id: 'team-git',
      type: 'git-custom',
      scope: 'project',
      url: sourceUrl,
    };

    const { targetDir } = resolveAndValidateCacheDir(cacheDir, source.id, source.url);
    initRepo(targetDir);

    const c1 = commitWithDate(targetDir, 'f.txt', 'v1', 'c1', '2026-10-01T10:00:00Z');
    commitWithDate(targetDir, 'f.txt', 'v2', 'c2', '2026-10-03T10:00:00Z');
    commitWithDate(targetDir, 'f.txt', 'v3', 'c3', '2026-10-06T10:00:00Z');
    const c4 = commitWithDate(targetDir, 'f.txt', 'v4', 'c4', '2026-10-11T10:00:00Z');

    const inst = makeInstallation({
      sourceRevision: { commit: c1 },
    });

    const gap = await describeRevisionGap(inst, source, { cacheDir });
    assert.strictEqual(gap.installedRevision, c1);
    assert.strictEqual(gap.latestRevision, c4);
    assert.strictEqual(gap.commitsBehind, 3);
    assert.strictEqual(gap.behindDays, 10);
    assert.strictEqual(gap.reason, undefined);

    // Same commit -> 0 commits behind, 0 days
    const instCurrent = makeInstallation({
      sourceRevision: { commit: c4 },
    });
    const gapCurrent = await describeRevisionGap(instCurrent, source, { cacheDir });
    assert.strictEqual(gapCurrent.installedRevision, c4);
    assert.strictEqual(gapCurrent.latestRevision, c4);
    assert.strictEqual(gapCurrent.commitsBehind, 0);
    assert.strictEqual(gapCurrent.behindDays, 0);
  });

  it('supports git local-folder sources directly on localPath', async () => {
    const localGitDir = path.join(tempDir, 'local-git-repo');
    initRepo(localGitDir);

    const c1 = commitWithDate(localGitDir, 'skill.md', 'v1', 'c1', '2026-10-10T00:00:00Z');
    commitWithDate(localGitDir, 'skill.md', 'v2', 'c2', '2026-10-12T00:00:00Z');
    const c3 = commitWithDate(localGitDir, 'skill.md', 'v3', 'c3', '2026-10-15T00:00:00Z');

    const localGitSource: Source = {
      id: 'local-git',
      type: 'local-folder',
      scope: 'project',
      localPath: localGitDir,
    };

    const inst = makeInstallation({
      sourceId: 'local-git',
      sourceRevision: { commit: c1 },
    });

    const gap = await describeRevisionGap(inst, localGitSource);
    assert.strictEqual(gap.installedRevision, c1);
    assert.strictEqual(gap.latestRevision, c3);
    assert.strictEqual(gap.commitsBehind, 2);
    assert.strictEqual(gap.behindDays, 5);
    assert.strictEqual(gap.reason, undefined);
  });

  it('returns null fields with reason "not-git" for non-git local-folder and remote-url sources', async () => {
    const plainFolder = path.join(tempDir, 'plain-non-git-folder');
    fs.mkdirSync(plainFolder, { recursive: true });
    fs.writeFileSync(path.join(plainFolder, 'README.md'), 'not a git repo', 'utf-8');

    const nonGitLocalSource: Source = {
      id: 'plain-local',
      type: 'local-folder',
      scope: 'project',
      localPath: plainFolder,
    };
    const inst = makeInstallation({ sourceId: 'plain-local' });
    const gapLocal = await describeRevisionGap(inst, nonGitLocalSource);
    assert.strictEqual(gapLocal.commitsBehind, null);
    assert.strictEqual(gapLocal.installedRevision, null);
    assert.strictEqual(gapLocal.latestRevision, null);
    assert.strictEqual(gapLocal.reason, 'not-git');

    const remoteUrlSource: Source = {
      id: 'remote-http',
      type: 'remote-url',
      scope: 'project',
      url: 'https://example.com/skill.md',
    };
    const gapRemote = await describeRevisionGap(inst, remoteUrlSource);
    assert.strictEqual(gapRemote.commitsBehind, null);
    assert.strictEqual(gapRemote.reason, 'not-git');
  });

  it('returns reason "no-recorded-commit" when installation has no sourceRevision.commit', async () => {
    const source: Source = {
      id: 'team-git',
      type: 'git-custom',
      scope: 'project',
      url: 'https://example.com/org/team-git.git',
    };
    const inst = makeInstallation({ sourceRevision: undefined });
    const gap = await describeRevisionGap(inst, source, { cacheDir: path.join(tempDir, 'cache-1') });
    assert.strictEqual(gap.installedRevision, null);
    assert.strictEqual(gap.latestRevision, null);
    assert.strictEqual(gap.commitsBehind, null);
    assert.strictEqual(gap.reason, 'no-recorded-commit');
  });

  it('returns reason "clone-not-found" without cloning when cache directory is absent', async () => {
    const emptyCache = path.join(tempDir, 'empty-cache');
    const source: Source = {
      id: 'uncloned-git',
      type: 'git-custom',
      scope: 'project',
      url: 'https://example.com/org/uncloned.git',
    };
    const inst = makeInstallation({
      sourceId: 'uncloned-git',
      sourceRevision: { commit: '0123456789abcdef0123456789abcdef01234567' },
    });

    const gap = await describeRevisionGap(inst, source, { cacheDir: emptyCache });
    assert.strictEqual(gap.installedRevision, '0123456789abcdef0123456789abcdef01234567');
    assert.strictEqual(gap.latestRevision, null);
    assert.strictEqual(gap.commitsBehind, null);
    assert.strictEqual(gap.reason, 'clone-not-found');
    assert.strictEqual(fs.existsSync(emptyCache), false, 'Must never create or clone into cacheDir');
  });

  it('returns reason "installed-commit-not-found" when recorded commit is unknown to the clone', async () => {
    const cacheDir = path.join(tempDir, 'cache-1');
    const source: Source = {
      id: 'team-git',
      type: 'git-custom',
      scope: 'project',
      url: 'https://example.com/org/team-git.git',
    };
    const unknownCommit = 'ffffffffffffffffffffffffffffffffffffffff';
    const inst = makeInstallation({
      sourceRevision: { commit: unknownCommit },
    });

    const gap = await describeRevisionGap(inst, source, { cacheDir });
    assert.strictEqual(gap.installedRevision, unknownCommit);
    assert.ok(gap.latestRevision);
    assert.strictEqual(gap.commitsBehind, null);
    assert.strictEqual(gap.reason, 'installed-commit-not-found');
  });

  it('rejects malicious recorded commit values before executing git', async () => {
    const source: Source = {
      id: 'team-git',
      type: 'git-custom',
      scope: 'project',
      url: 'https://example.com/org/team-git.git',
    };
    let gitCalled = false;
    const fakeRunGit = async () => {
      gitCalled = true;
      return { stdout: '', stderr: '' };
    };

    for (const badCommit of ['--upload-pack=pwn', 'abc..def', 'abc def', 'not-hex-sha']) {
      const inst = makeInstallation({
        sourceRevision: { commit: badCommit },
      });
      await assert.rejects(
        () => describeRevisionGap(inst, source, { runGit: fakeRunGit }),
        /Git commit ref/
      );
      assert.strictEqual(gitCalled, false, `runGit must not be called for invalid commit "${badCommit}"`);
    }
  });
});
