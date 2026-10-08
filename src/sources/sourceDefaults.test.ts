import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'path';
import { validateLocation, validateLocalFolder, deriveSourceDefaults } from './sourceDefaults';

describe('sourceDefaults - validateLocation', () => {
  it('rejects empty or whitespace-only locations for all source types', () => {
    const types = ['git-custom', 'git-marketplace', 'git-single-item', 'remote-url', 'local-folder'] as const;
    for (const type of types) {
      assert.strictEqual(typeof validateLocation(type, ''), 'string');
      assert.strictEqual(typeof validateLocation(type, '   '), 'string');
    }
  });

  describe('git types (git-custom, git-marketplace, git-single-item)', () => {
    it('accepts valid HTTPS git URLs', () => {
      assert.strictEqual(validateLocation('git-custom', 'https://github.com/org/Team_Skills.git'), null);
      assert.strictEqual(validateLocation('git-marketplace', 'https://github.com/org/Team_Skills.git/'), null);
      assert.strictEqual(validateLocation('git-single-item', 'https://github.com/org/repo'), null);
    });

    it('accepts valid SSH git URLs in SCP and ssh:// formats', () => {
      assert.strictEqual(validateLocation('git-custom', 'git@github.com:org/repo.git'), null);
      assert.strictEqual(validateLocation('git-custom', 'git@github.com:org/repo.git/'), null);
      assert.strictEqual(validateLocation('git-custom', 'git@github.com:repo.git'), null);
      assert.strictEqual(validateLocation('git-marketplace', 'git@gitlab.com:group/subgroup/repo.git'), null);
      assert.strictEqual(validateLocation('git-single-item', 'ssh://git@github.com/org/repo.git'), null);
      assert.strictEqual(validateLocation('git-custom', 'ssh://git@github.com:22/org/repo.git'), null);
    });

    it('rejects plain HTTP URLs (git requires HTTPS or SSH)', () => {
      assert.strictEqual(typeof validateLocation('git-custom', 'http://github.com/org/repo.git'), 'string');
    });

    it('rejects non-git protocols, local paths, and garbage', () => {
      assert.strictEqual(typeof validateLocation('git-custom', 'ftp://github.com/org/repo.git'), 'string');
      assert.strictEqual(typeof validateLocation('git-custom', 'file:///Users/x/repo'), 'string');
      assert.strictEqual(typeof validateLocation('git-custom', '/Users/x/my folder/'), 'string');
      assert.strictEqual(typeof validateLocation('git-custom', 'garbage-string'), 'string');
    });

    it('rejects URLs missing a repository path', () => {
      assert.strictEqual(typeof validateLocation('git-custom', 'https://github.com'), 'string');
      assert.strictEqual(typeof validateLocation('git-custom', 'https://github.com/'), 'string');
      assert.strictEqual(typeof validateLocation('git-custom', 'ssh://github.com'), 'string');
      assert.strictEqual(typeof validateLocation('git-custom', 'git@github.com:'), 'string');
      assert.strictEqual(typeof validateLocation('git-custom', 'git@github.com:/'), 'string');
    });
  });

  describe('remote-url', () => {
    it('accepts valid HTTP and HTTPS URLs', () => {
      assert.strictEqual(
        validateLocation('remote-url', 'https://gist.githubusercontent.com/user/123/raw/skill.md'),
        null
      );
      assert.strictEqual(validateLocation('remote-url', 'http://example.com/raw/agent.md'), null);
      assert.strictEqual(validateLocation('remote-url', 'https://example.com/tools.json'), null);
    });

    it('rejects non-HTTP(S) URLs, SSH paths, local paths, and garbage', () => {
      assert.strictEqual(typeof validateLocation('remote-url', 'ftp://example.com/skill.md'), 'string');
      assert.strictEqual(typeof validateLocation('remote-url', 'file:///path/to/skill.md'), 'string');
      assert.strictEqual(typeof validateLocation('remote-url', 'git@github.com:org/repo.git'), 'string');
      assert.strictEqual(typeof validateLocation('remote-url', 'ssh://git@github.com/org/repo.git'), 'string');
      assert.strictEqual(typeof validateLocation('remote-url', '/Users/x/skill.md'), 'string');
      assert.strictEqual(typeof validateLocation('remote-url', 'garbage'), 'string');
      assert.strictEqual(typeof validateLocation('remote-url', 'https://'), 'string');
      assert.strictEqual(typeof validateLocation('remote-url', 'http://'), 'string');
    });
  });

  describe('local-folder', () => {
    it('accepts non-empty local folder paths', () => {
      assert.strictEqual(validateLocation('local-folder', '/Users/x/my folder/'), null);
      assert.strictEqual(validateLocation('local-folder', '/Users/x/my folder'), null);
      assert.strictEqual(validateLocation('local-folder', './relative/folder'), null);
      assert.strictEqual(validateLocation('local-folder', 'folder-name'), null);
      assert.strictEqual(validateLocation('local-folder', 'C:\\Users\\x\\my folder\\'), null);
    });

    it('rejects URLs for local-folder', () => {
      assert.strictEqual(typeof validateLocation('local-folder', 'https://github.com/org/repo'), 'string');
      assert.strictEqual(typeof validateLocation('local-folder', 'http://example.com'), 'string');
      assert.strictEqual(typeof validateLocation('local-folder', 'git@github.com:org/repo.git'), 'string');
      assert.strictEqual(typeof validateLocation('local-folder', 'ssh://git@github.com/repo'), 'string');
      assert.strictEqual(typeof validateLocation('local-folder', 'file:///Users/x/folder'), 'string');
      assert.strictEqual(typeof validateLocation('local-folder', 'ftp://example.com/folder'), 'string');
    });
  });

  describe('local-folder with scope and rootDir (validateLocalFolder)', () => {
    it('accepts valid paths inside workspace for project scope', () => {
      const wsRoot = '/workspace/project';
      assert.strictEqual(validateLocalFolder('skills/sub', 'project', wsRoot), null);
      assert.strictEqual(validateLocalFolder(path.join(wsRoot, 'skills'), 'project', wsRoot), null);
      assert.strictEqual(validateLocalFolder('./nested', 'project', wsRoot), null);
    });

    it('rejects paths outside workspace for project scope', () => {
      const wsRoot = '/workspace/project';
      const result = validateLocalFolder('/outside/path', 'project', wsRoot);
      assert.strictEqual(typeof result, 'string');
      assert.ok(result?.includes('lies outside workspace root'));

      const dotDotResult = validateLocalFolder('../../outside', 'project', wsRoot);
      assert.strictEqual(typeof dotDotResult, 'string');
      assert.ok(dotDotResult?.includes('lies outside workspace root'));
    });

    it('accepts valid paths inside home for global scope', () => {
      const homeRoot = '/Users/testuser';
      assert.strictEqual(validateLocalFolder('my-skills', 'global', homeRoot), null);
      assert.strictEqual(validateLocalFolder(path.join(homeRoot, 'skills'), 'global', homeRoot), null);
    });

    it('rejects paths outside home for global scope', () => {
      const homeRoot = '/Users/testuser';
      const result = validateLocalFolder('/var/other', 'global', homeRoot);
      assert.strictEqual(typeof result, 'string');
      assert.ok(result?.includes('lies outside home root'));
    });

    it('rejects URLs and empty locations in validateLocalFolder', () => {
      assert.strictEqual(typeof validateLocalFolder('https://example.com', 'project', '/workspace'), 'string');
      assert.strictEqual(typeof validateLocalFolder('', 'project', '/workspace'), 'string');
    });
  });
});

describe('sourceDefaults - deriveSourceDefaults', () => {
  it('derives id and name for HTTPS git repo: https://github.com/org/Team_Skills.git', () => {
    const result = deriveSourceDefaults('git-custom', 'https://github.com/org/Team_Skills.git');
    assert.strictEqual(result.id, 'team-skills');
    assert.strictEqual(result.name, 'Team skills');
  });

  it('derives id and name for SSH git repo: git@github.com:org/repo.git', () => {
    const result = deriveSourceDefaults('git-custom', 'git@github.com:org/repo.git');
    assert.strictEqual(result.id, 'repo');
    assert.strictEqual(result.name, 'Repo');
  });

  it('handles trailing slash on URLs and folders', () => {
    const gitResult = deriveSourceDefaults('git-custom', 'https://github.com/org/Team_Skills.git/');
    assert.strictEqual(gitResult.id, 'team-skills');
    assert.strictEqual(gitResult.name, 'Team skills');

    const sshResult = deriveSourceDefaults('git-custom', 'git@github.com:org/repo.git/');
    assert.strictEqual(sshResult.id, 'repo');
    assert.strictEqual(sshResult.name, 'Repo');

    const folderResult = deriveSourceDefaults('local-folder', '/Users/x/my folder/');
    assert.strictEqual(folderResult.id, 'my-folder');
    assert.strictEqual(folderResult.name, 'My folder');
  });

  it('derives id and name for local folder: /Users/x/my folder/', () => {
    const result = deriveSourceDefaults('local-folder', '/Users/x/my folder/');
    assert.strictEqual(result.id, 'my-folder');
    assert.strictEqual(result.name, 'My folder');
  });

  it('derives id and name for gist raw URL', () => {
    const result = deriveSourceDefaults(
      'remote-url',
      'https://gist.githubusercontent.com/user/1234567890abcdef/raw/team-skills.md'
    );
    assert.strictEqual(result.id, 'team-skills');
    assert.strictEqual(result.name, 'Team skills');
  });

  it('handles gist URL without file extension', () => {
    const result = deriveSourceDefaults('remote-url', 'https://gist.github.com/user/1234567890abcdef');
    assert.strictEqual(result.id, '1234567890abcdef');
    assert.strictEqual(result.name, '1234567890abcdef');
  });

  it('falls back to id "source" and name "Source" for empty or garbage locations', () => {
    assert.deepStrictEqual(deriveSourceDefaults('git-custom', ''), { id: 'source', name: 'Source' });
    assert.deepStrictEqual(deriveSourceDefaults('git-custom', '   '), { id: 'source', name: 'Source' });
    assert.deepStrictEqual(deriveSourceDefaults('local-folder', '///'), { id: 'source', name: 'Source' });
    assert.deepStrictEqual(deriveSourceDefaults('remote-url', '!@#$%^&*()'), { id: 'source', name: 'Source' });
    assert.deepStrictEqual(deriveSourceDefaults('git-custom', 'https://github.com/'), { id: 'source', name: 'Source' });
  });

  it('handles git repo URLs without .git extension and with uppercase .GIT', () => {
    const noExt = deriveSourceDefaults('git-custom', 'https://github.com/org/Team_Skills');
    assert.strictEqual(noExt.id, 'team-skills');
    assert.strictEqual(noExt.name, 'Team skills');

    const upperExt = deriveSourceDefaults('git-custom', 'https://github.com/org/Team_Skills.GIT');
    assert.strictEqual(upperExt.id, 'team-skills');
    assert.strictEqual(upperExt.name, 'Team skills');
  });

  it('handles SCP git URL without org: git@github.com:repo.git', () => {
    const result = deriveSourceDefaults('git-custom', 'git@github.com:repo.git');
    assert.strictEqual(result.id, 'repo');
    assert.strictEqual(result.name, 'Repo');
  });

  it('handles ssh:// git URLs', () => {
    const result = deriveSourceDefaults('git-custom', 'ssh://git@github.com/org/team-skills.git');
    assert.strictEqual(result.id, 'team-skills');
    assert.strictEqual(result.name, 'Team skills');
  });

  it('handles percent-encoded URL locations', () => {
    const result = deriveSourceDefaults('git-custom', 'https://github.com/org/Team%20Skills.git');
    assert.strictEqual(result.id, 'team-skills');
    assert.strictEqual(result.name, 'Team skills');
  });
});
