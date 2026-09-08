import * as assert from 'node:assert';
import { describe, it } from 'node:test';
import type { AssistantId } from '../domain/types';
import { claudeAdapter } from './claude';
import { codexAdapter } from './codex';
import { copilotAdapter } from './copilot';
import { geminiAdapter } from './gemini';
import { KiloAdapter, kiloAdapter } from './kilo';
import { ALL_ADAPTERS, getAdapter, getAdapterWithHomeRoot } from './registry';

describe('Adapter Registry', () => {
  it('ALL_ADAPTERS contains exactly 5 adapters with expected ids and no duplicates', () => {
    assert.strictEqual(ALL_ADAPTERS.length, 5);
    const ids = ALL_ADAPTERS.map((a) => a.assistant);
    const expectedIds: AssistantId[] = [
      'claude-code',
      'kilo-code',
      'github-copilot',
      'codex-cli',
      'gemini-cli',
    ];
    assert.deepStrictEqual([...ids].sort(), [...expectedIds].sort());
    assert.strictEqual(new Set(ids).size, 5);
  });

  it('getAdapter returns singleton identity for all adapters', () => {
    assert.strictEqual(getAdapter('claude-code'), claudeAdapter);
    assert.strictEqual(getAdapter('kilo-code'), kiloAdapter);
    assert.strictEqual(getAdapter('github-copilot'), copilotAdapter);
    assert.strictEqual(getAdapter('codex-cli'), codexAdapter);
    assert.strictEqual(getAdapter('gemini-cli'), geminiAdapter);
  });

  it('getAdapter throws for unsupported assistant id', () => {
    assert.throws(
      () => getAdapter('bogus' as AssistantId),
      /Unsupported assistant: bogus/
    );
  });

  it('getAdapterWithHomeRoot returns a fresh instance rather than the singleton', () => {
    const fakeHome = '/some/fake/home';
    const adapter = getAdapterWithHomeRoot('kilo-code', fakeHome);
    assert.strictEqual(adapter.assistant, 'kilo-code');
    assert.notStrictEqual(adapter, kiloAdapter);
    assert.ok(adapter instanceof KiloAdapter);
  });

  it('getAdapterWithHomeRoot throws for unsupported assistant id', () => {
    assert.throws(
      () => getAdapterWithHomeRoot('bogus' as AssistantId, '/some/fake/home'),
      /Unsupported assistant: bogus/
    );
  });
});
