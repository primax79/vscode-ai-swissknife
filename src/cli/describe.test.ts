import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { COMMAND_DEFINITIONS, runDescribe } from './definitions';

const repoRoot = path.resolve(__dirname, '../..');

describe('CLI self-description and agent docs (46.2)', () => {
  it('describe covers every command definition and itself', () => {
    const described = runDescribe().map((c) => c.name);
    for (const def of COMMAND_DEFINITIONS) {
      assert.ok(described.includes(def.name), `describe must list "${def.name}"`);
    }
    assert.ok(described.includes('describe'), 'describe must list itself');
  });

  it('every described command has a description, options array, examples and an output shape', () => {
    for (const c of runDescribe()) {
      assert.ok(c.description && c.description.length > 0, `${c.name}: description`);
      assert.ok(Array.isArray(c.options), `${c.name}: options`);
      assert.ok(c.outputShape && typeof c.outputShape === 'object', `${c.name}: outputShape`);
    }
  });

  it('AGENTS.md documents exactly the registered commands in its command table', () => {
    const doc = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');
    const tableNames = Array.from(doc.matchAll(/^\|\s*`([a-z-]+)`\s*\|/gm)).map((m) => m[1]);
    const registered = runDescribe().map((c) => c.name).sort();
    assert.deepStrictEqual([...tableNames].sort(), registered);
  });

  it('README links to AGENTS.md', () => {
    const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
    assert.ok(readme.includes('AGENTS.md'));
  });
});
