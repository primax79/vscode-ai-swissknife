import { describe, it, mock } from 'node:test';
import * as assert from 'node:assert';

// Mock vscode
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id: string, ...rest: unknown[]) {
  if (id === 'vscode') {
    return {
      window: {
        showWarningMessage: async () => undefined,
        showErrorMessage: async () => undefined,
        showInformationMessage: async () => undefined,
      },
      ProgressLocation: { Notification: 1 }
    };
  }
  return originalRequire.apply(this, [id, ...rest]);
};

import { installResolvedArtifacts, resolveRecommendedSources } from './recommendations';
import * as planModule from '../engine/plan';
import * as applyModule from '../engine/apply';
import * as localFolderModule from '../sources/localFolder';
import * as gitCustomModule from '../sources/gitCustom';
import type { Artifact, Package, Source } from '../domain/types';
import type { DesiredSource } from '../domain/registry';

describe('resolveRecommendedSources', () => {
  it('resolves sources and handles failures without interrupting the loop', async () => {
    const mockGit = mock.method(gitCustomModule.gitCustomResolver, 'resolve', async () => {
      return { packages: [{ id: 'p1', sourceId: 's1', nativeFormat: 'raw', artifacts: [] }] };
    });
    const mockLocal = mock.method(localFolderModule.localFolderResolver, 'resolve', async () => {
      throw new Error('Local folder not found');
    });

    const desiredSources: DesiredSource[] = [
      { id: 's1', type: 'git-custom', scope: 'project', url: 'https://github.com/foo/bar' },
      { id: 's2', type: 'local-folder', scope: 'project', localPath: './foo' }
    ];

    const resolutionAttempts = await resolveRecommendedSources(['s1', 's2'], desiredSources, '/test/root');

    assert.strictEqual(resolutionAttempts.size, 2);
    
    const s1Attempt = resolutionAttempts.get('s1')!;
    assert.strictEqual(s1Attempt.status, 'resolved');
    if (s1Attempt.status === 'resolved') {
      assert.strictEqual(s1Attempt.packages.length, 1);
    }

    const s2Attempt = resolutionAttempts.get('s2')!;
    assert.strictEqual(s2Attempt.status, 'failed');
    if (s2Attempt.status === 'failed') {
      assert.strictEqual(s2Attempt.error, 'Local folder not found');
    }

    mockGit.mock.restore();
    mockLocal.mock.restore();
  });
});

describe('installResolvedArtifacts', () => {
  it('invokes planInstall/applyInstall with each item\'s own targetAssistant and targetScope', async () => {
    const planMock = mock.method(planModule, 'planInstall', async (params: any) => {
      return {
        supported: true,
        plan: { targetDir: '/tmp', proposedFiles: [] },
        kind: params.artifact.kind,
        content: params.artifact,
        adapter: params.targetAdapter,
        scope: params.targetScope
      };
    });

    const applyMock = mock.method(applyModule, 'applyInstall', async () => {
      return { status: 'applied' };
    });

    const source: Source = { id: 's1', type: 'git-custom', scope: 'project' };
    const pkg: Package = { id: 'p1', sourceId: 's1', nativeFormat: 'raw', artifacts: [] };
    const artifact1: Artifact = { id: 'a1', packageId: 'p1', kind: 'skill', name: 's1', nativeFormat: 'md' };
    const artifact2: Artifact = { id: 'a2', packageId: 'p1', kind: 'agent', name: 'a2', nativeFormat: 'md' };

    await installResolvedArtifacts([
      { artifact: artifact1, pkg, source, targetAssistant: 'claude-code', targetScope: 'project' },
      { artifact: artifact2, pkg, source, targetAssistant: 'kilo-code', targetScope: 'project' }
    ], '/test/root');

    assert.strictEqual(planMock.mock.calls.length, 2);
    
    // First call
    const call1Params = planMock.mock.calls[0].arguments[0] as any;
    assert.strictEqual(call1Params.artifact.id, 'a1');
    assert.strictEqual(call1Params.targetAdapter.assistant, 'claude-code');
    assert.strictEqual(call1Params.targetScope, 'project');

    // Second call
    const call2Params = planMock.mock.calls[1].arguments[0] as any;
    assert.strictEqual(call2Params.artifact.id, 'a2');
    assert.strictEqual(call2Params.targetAdapter.assistant, 'kilo-code');
    assert.strictEqual(call2Params.targetScope, 'project');

    assert.strictEqual(applyMock.mock.calls.length, 2);

    planMock.mock.restore();
    applyMock.mock.restore();
  });
});
