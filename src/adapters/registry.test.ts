import * as assert from 'node:assert';
import { describe, it, beforeEach } from 'node:test';

// Setup minimal mock for 'vscode' before importing modules
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockEnabledAssistants: string[] | undefined = undefined;

Module.prototype.require = function (id: string, ...rest: unknown[]) {
  if (id === 'vscode') {
    return {
      workspace: {
        getConfiguration: (section: string) => {
          if (section === 'aiSwissknife') {
            return {
              get: (key: string) => {
                if (key === 'enabledAssistants') return mockEnabledAssistants;
                return undefined;
              }
            };
          }
          return { get: () => undefined };
        }
      }
    };
  }
  return originalRequire.apply(this, [id, ...rest]);
};

import type { AssistantId } from '../domain/types';
import { claudeAdapter } from './claude';
import { codexAdapter } from './codex';
import { copilotAdapter } from './copilot';
import { geminiAdapter } from './gemini';
import { KiloAdapter, kiloAdapter } from './kilo';
import { ALL_ADAPTERS, getAdapter, getAdapterWithHomeRoot, getEnabledAdapters } from './registry';

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

  describe('getEnabledAdapters', () => {
    beforeEach(() => {
      mockEnabledAssistants = undefined;
    });

    it('returns all adapters when setting is undefined (default-all-enabled behavior)', () => {
      mockEnabledAssistants = undefined;
      const enabled = getEnabledAdapters();
      assert.strictEqual(enabled.length, 5);
      assert.deepStrictEqual(enabled.map((a) => a.assistant).sort(), ALL_ADAPTERS.map((a) => a.assistant).sort());
    });

    it('returns all adapters when setting is empty array', () => {
      mockEnabledAssistants = [];
      const enabled = getEnabledAdapters();
      assert.strictEqual(enabled.length, 5);
    });

    it('returns only the subset of adapters specified in the setting', () => {
      mockEnabledAssistants = ['claude-code', 'kilo-code'];
      const enabled = getEnabledAdapters();
      assert.strictEqual(enabled.length, 2);
      assert.ok(enabled.includes(claudeAdapter));
      assert.ok(enabled.includes(kiloAdapter));
      assert.strictEqual(enabled.includes(copilotAdapter), false);
    });

    it('ignores unknown ids in the setting and returns valid matching adapters', () => {
      mockEnabledAssistants = ['claude-code', 'bogus-id'];
      const enabled = getEnabledAdapters();
      assert.strictEqual(enabled.length, 1);
      assert.ok(enabled.includes(claudeAdapter));
    });
  });
});
