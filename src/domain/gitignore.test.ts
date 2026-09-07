import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensureStateIgnored } from './gitignore';

describe('gitignore hygiene (ensureStateIgnored)', () => {
  let testWorkspaceDir: string;

  beforeEach(async () => {
    testWorkspaceDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'ai-swissknife-gitignore-test-')
    );
  });

  afterEach(async () => {
    if (testWorkspaceDir && fs.existsSync(testWorkspaceDir)) {
      await fs.promises.rm(testWorkspaceDir, { recursive: true, force: true });
    }
  });

  it('no .gitignore present -> file not created', async () => {
    const gitignorePath = path.join(testWorkspaceDir, '.gitignore');
    assert.strictEqual(fs.existsSync(gitignorePath), false);

    await ensureStateIgnored(testWorkspaceDir);

    assert.strictEqual(fs.existsSync(gitignorePath), false);
  });

  it('.gitignore present without the entry -> entry appended, rest of file byte-identical otherwise', async () => {
    const gitignorePath = path.join(testWorkspaceDir, '.gitignore');
    const initialContent = 'node_modules/\n*.log\ndist/\n';
    await fs.promises.writeFile(gitignorePath, initialContent, 'utf-8');

    await ensureStateIgnored(testWorkspaceDir);

    const updatedContent = await fs.promises.readFile(gitignorePath, 'utf-8');
    assert.ok(
      updatedContent.startsWith(initialContent),
      'File content prior to append must remain byte-identical'
    );
    const expectedAppended = '.vscode/ai-swissknife/state.json\n';
    assert.strictEqual(updatedContent, initialContent + expectedAppended);
  });

  it('.gitignore present with the entry already -> file untouched (assert via exact content equality)', async () => {
    const gitignorePath = path.join(testWorkspaceDir, '.gitignore');
    const initialContent = 'node_modules/\n.vscode/ai-swissknife/state.json\n*.log\n';
    await fs.promises.writeFile(gitignorePath, initialContent, 'utf-8');

    await ensureStateIgnored(testWorkspaceDir);

    const afterContent = await fs.promises.readFile(gitignorePath, 'utf-8');
    assert.strictEqual(afterContent, initialContent);
  });

  it('.gitignore present with root-prefixed entry already -> file untouched', async () => {
    const gitignorePath = path.join(testWorkspaceDir, '.gitignore');
    const initialContent = 'node_modules/\n/.vscode/ai-swissknife/state.json\n';
    await fs.promises.writeFile(gitignorePath, initialContent, 'utf-8');

    await ensureStateIgnored(testWorkspaceDir);

    const afterContent = await fs.promises.readFile(gitignorePath, 'utf-8');
    assert.strictEqual(afterContent, initialContent);
  });

  it('pre-existing legacy state.json present -> appended line matches legacy path', async () => {
    const gitignorePath = path.join(testWorkspaceDir, '.gitignore');
    const initialContent = 'build/\n';
    await fs.promises.writeFile(gitignorePath, initialContent, 'utf-8');

    // Simulate pre-existing legacy state.json (not a legacy manifest)
    const legacyStateDir = path.join(testWorkspaceDir, '.ai-swissknife');
    await fs.promises.mkdir(legacyStateDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(legacyStateDir, 'state.json'),
      JSON.stringify({ schemaVersion: 1, installations: [] }),
      'utf-8'
    );

    await ensureStateIgnored(testWorkspaceDir);

    const updatedContent = await fs.promises.readFile(gitignorePath, 'utf-8');
    assert.ok(
      updatedContent.startsWith(initialContent),
      'File content prior to append must remain byte-identical'
    );
    const expectedAppended = '.ai-swissknife/state.json\n';
    assert.strictEqual(updatedContent, initialContent + expectedAppended);
  });

  it('preserves CRLF newline convention when appending', async () => {
    const gitignorePath = path.join(testWorkspaceDir, '.gitignore');
    const initialContent = 'node_modules/\r\n*.log\r\n';
    await fs.promises.writeFile(gitignorePath, initialContent, 'utf-8');

    await ensureStateIgnored(testWorkspaceDir);

    const updatedContent = await fs.promises.readFile(gitignorePath, 'utf-8');
    assert.strictEqual(
      updatedContent,
      initialContent + '.vscode/ai-swissknife/state.json\r\n'
    );
  });

  it('preserves no-trailing-newline convention when appending', async () => {
    const gitignorePath = path.join(testWorkspaceDir, '.gitignore');
    const initialContent = 'node_modules/\n*.log';
    await fs.promises.writeFile(gitignorePath, initialContent, 'utf-8');

    await ensureStateIgnored(testWorkspaceDir);

    const updatedContent = await fs.promises.readFile(gitignorePath, 'utf-8');
    assert.ok(
      updatedContent.startsWith(initialContent),
      'File content prior to append must remain byte-identical'
    );
    assert.strictEqual(
      updatedContent,
      initialContent + '\n.vscode/ai-swissknife/state.json'
    );
  });
});
