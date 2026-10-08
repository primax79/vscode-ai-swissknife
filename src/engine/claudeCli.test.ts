import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ClaudeCli,
  ClaudeCliError,
  ClaudeCliNotFound,
  ClaudeCliVersionError,
  ClaudeCliTimeoutError,
  ClaudeCliParseError,
  ClaudeCliExecutionError,
  CLAUDE_CLI_MINIMUM_VERSION,
  compareSemver,
  parseClaudeCliVersion,
  resolveClaudeBinary,
  clearBinaryCache,
  listPlugins,
  listAvailablePlugins,
  pluginDetails,
  listMarketplaces,
  type ClaudeCliExecutor,
  type ClaudeCliRunResult,
} from './claudeCli';
import {
  RAW_LIST_PLUGINS_JSON,
  RAW_LIST_AVAILABLE_JSON,
  RAW_LIST_MARKETPLACES_JSON,
  RAW_PLUGIN_DETAILS_TXT,
  RAW_PLUGIN_DETAILS_WITH_COMMANDS_TXT,
} from './__fixtures__/claudeCliFixtures';

describe('claudeCli — binary resolution, version gate, and typed errors', () => {
  beforeEach(() => {
    clearBinaryCache();
  });

  it('compareSemver accurately compares semver strings', () => {
    assert.strictEqual(compareSemver('2.1.0', '2.1.0'), 0);
    assert.strictEqual(compareSemver('2.1.287', '2.1.0'), 1);
    assert.strictEqual(compareSemver('2.0.99', '2.1.0'), -1);
    assert.strictEqual(compareSemver('1.9.0', '2.1.0'), -1);
    assert.strictEqual(compareSemver('3.0.0', '2.1.0'), 1);
  });

  it('parseClaudeCliVersion extracts semver from claude --version output', () => {
    assert.strictEqual(parseClaudeCliVersion('2.1.287 (Claude Code)'), '2.1.287');
    assert.strictEqual(parseClaudeCliVersion('claude version 2.1.0'), '2.1.0');
    assert.throws(
      () => parseClaudeCliVersion('No version here'),
      (err: unknown) => err instanceof ClaudeCliParseError
    );
  });

  it('resolveClaudeBinary finds executable on PATH and caches the result', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-bin-test-'));
    try {
      const fakeBinary = path.join(tempDir, process.platform === 'win32' ? 'claude.exe' : 'claude');
      fs.writeFileSync(fakeBinary, '#!/bin/sh\necho ok\n', { mode: 0o755 });

      const resolved = resolveClaudeBinary({
        env: { PATH: tempDir },
        fallbacks: [],
        forceRefresh: true,
      });

      assert.strictEqual(resolved, fakeBinary);

      // Verify cached value is returned without checking again
      const cached = resolveClaudeBinary({
        env: { PATH: '/empty/dir' },
        fallbacks: [],
      });
      assert.strictEqual(cached, fakeBinary);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('resolveClaudeBinary checks fallbacks if PATH does not contain binary', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-fallback-test-'));
    try {
      const fakeFallback = path.join(tempDir, 'claude');
      fs.writeFileSync(fakeFallback, '#!/bin/sh\necho ok\n', { mode: 0o755 });

      const resolved = resolveClaudeBinary({
        env: { PATH: '/nonexistent/path' },
        fallbacks: [fakeFallback],
        forceRefresh: true,
      });

      assert.strictEqual(resolved, fakeFallback);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('resolveClaudeBinary throws ClaudeCliNotFound listing all searched locations', () => {
    const searchedDir = '/searched/bin/path';
    const fallbackPath = '/searched/fallback/claude';

    assert.throws(
      () =>
        resolveClaudeBinary({
          env: { PATH: searchedDir },
          fallbacks: [fallbackPath],
          forceRefresh: true,
        }),
      (err: unknown) => {
        assert.ok(err instanceof ClaudeCliNotFound);
        assert.ok(err instanceof ClaudeCliError);
        const searched = err.searchedLocations;
        assert.ok(searched.some(loc => loc.includes(searchedDir)));
        assert.ok(searched.some(loc => loc.includes(fallbackPath)));
        assert.ok(err.message.includes('Claude CLI not found'));
        assert.ok(err.message.includes(searchedDir));
        assert.ok(err.message.includes(fallbackPath));
        return true;
      }
    );
  });

  it('version gate throws ClaudeCliVersionError when CLI version is below minimum', async () => {
    const mockExecutor: ClaudeCliExecutor = async (args) => {
      if (args[0] === '--version') {
        return { stdout: '1.9.4 (Claude Code)\n', stderr: '', code: 0 };
      }
      return { stdout: '[]', stderr: '', code: 0 };
    };

    const cli = new ClaudeCli({ executor: mockExecutor });

    await assert.rejects(
      () => cli.listPlugins(),
      (err: unknown) => {
        assert.ok(err instanceof ClaudeCliVersionError);
        assert.ok(err instanceof ClaudeCliError);
        assert.strictEqual(err.foundVersion, '1.9.4');
        assert.strictEqual(err.minimumVersion, CLAUDE_CLI_MINIMUM_VERSION);
        assert.ok(err.message.includes('1.9.4'));
        assert.ok(err.message.includes(CLAUDE_CLI_MINIMUM_VERSION));
        return true;
      }
    );
  });

  it('throws ClaudeCliTimeoutError on execution timeout', async () => {
    const mockExecutor: ClaudeCliExecutor = async (args) => {
      if (args[0] === '--version') {
        return { stdout: '2.1.287 (Claude Code)', stderr: '', code: 0 };
      }
      throw new ClaudeCliTimeoutError(args.join(' '), 30000);
    };

    const cli = new ClaudeCli({ executor: mockExecutor });

    await assert.rejects(
      () => cli.listPlugins(),
      (err: unknown) => {
        assert.ok(err instanceof ClaudeCliTimeoutError);
        assert.ok(err instanceof ClaudeCliError);
        assert.strictEqual(err.timeoutMs, 30000);
        assert.ok(err.command.includes('plugin list'));
        return true;
      }
    );
  });

  it('throws ClaudeCliExecutionError when exit code is non-zero', async () => {
    const mockExecutor: ClaudeCliExecutor = async (args) => {
      if (args[0] === '--version') {
        return { stdout: '2.1.287 (Claude Code)', stderr: '', code: 0 };
      }
      return { stdout: '', stderr: 'Command failed: unexpected error', code: 1 };
    };

    const cli = new ClaudeCli({ executor: mockExecutor });

    await assert.rejects(
      () => cli.listPlugins(),
      (err: unknown) => {
        assert.ok(err instanceof ClaudeCliExecutionError);
        assert.ok(err instanceof ClaudeCliError);
        assert.strictEqual(err.code, 1);
        assert.ok(err.stderr.includes('Command failed'));
        return true;
      }
    );
  });
});

describe('claudeCli — read model with recorded fixtures', () => {
  function createFixtureExecutor(commandResponses: Record<string, ClaudeCliRunResult>): ClaudeCliExecutor {
    return async (args: string[]): Promise<ClaudeCliRunResult> => {
      const key = args.join(' ');
      if (args[0] === '--version') {
        return { stdout: '2.1.287 (Claude Code)\n', stderr: '', code: 0 };
      }
      if (key in commandResponses) {
        return commandResponses[key];
      }
      throw new Error(`Unexpected mock CLI call: [${key}]`);
    };
  }

  it('listPlugins parses recorded fixture exactly (two scopes, one disabled, projectPath, notes ignored)', async () => {
    const cli = new ClaudeCli({
      executor: createFixtureExecutor({
        'plugin list --json': { stdout: RAW_LIST_PLUGINS_JSON, stderr: '', code: 0 },
      }),
    });

    const plugins = await cli.listPlugins();

    assert.strictEqual(plugins.length, 2);

    // Plugin installed at user scope (disabled, with notes in raw JSON)
    const p1 = plugins[0];
    assert.strictEqual(p1.id, 'common-tools@agentic-coding-kit');
    assert.strictEqual(p1.name, 'common-tools');
    assert.strictEqual(p1.marketplace, 'agentic-coding-kit');
    assert.strictEqual(p1.version, '0.3.2');
    assert.strictEqual(p1.scope, 'user');
    assert.strictEqual(p1.enabled, false);
    assert.strictEqual(p1.installPath, '/tmp/cfg/plugins/cache/agentic-coding-kit/common-tools/0.3.2');
    assert.strictEqual(p1.installedAt, '2026-10-08T23:36:10.277Z');
    assert.strictEqual(p1.lastUpdated, '2026-10-08T23:36:10.277Z');
    assert.strictEqual(p1.projectEnabled, false);
    assert.strictEqual(p1.projectPath, undefined);
    // Verify extra unknown fields (notes, noteDetails) are ignored
    assert.strictEqual((p1 as any).notes, undefined);
    assert.strictEqual((p1 as any).noteDetails, undefined);

    // Plugin installed at local scope (enabled, with projectPath)
    const p2 = plugins[1];
    assert.strictEqual(p2.id, 'common-tools@agentic-coding-kit');
    assert.strictEqual(p2.name, 'common-tools');
    assert.strictEqual(p2.marketplace, 'agentic-coding-kit');
    assert.strictEqual(p2.version, '0.3.2');
    assert.strictEqual(p2.scope, 'local');
    assert.strictEqual(p2.enabled, true);
    assert.strictEqual(p2.installPath, '/tmp/cfg/plugins/cache/agentic-coding-kit/common-tools/0.3.2');
    assert.strictEqual(p2.projectPath, '/home/user/works/ai-coding-tools/ai-swissknife');
    assert.strictEqual(p2.projectEnabled, false);
  });

  it('listAvailablePlugins parses recorded fixture into installed and available lists', async () => {
    const cli = new ClaudeCli({
      executor: createFixtureExecutor({
        'plugin list --available --json': { stdout: RAW_LIST_AVAILABLE_JSON, stderr: '', code: 0 },
      }),
    });

    const result = await cli.listAvailablePlugins();

    assert.strictEqual(result.installed.length, 1);
    assert.strictEqual(result.installed[0].id, 'common-tools@agentic-coding-kit');
    assert.strictEqual(result.installed[0].scope, 'user');
    assert.strictEqual(result.installed[0].enabled, true);

    assert.strictEqual(result.available.length, 3);

    const a1 = result.available[0];
    assert.strictEqual(a1.pluginId, 'common-tools@agentic-coding-kit');
    assert.strictEqual(a1.name, 'common-tools');
    assert.strictEqual(a1.marketplaceName, 'agentic-coding-kit');
    assert.strictEqual(a1.version, '0.3.2');
    assert.ok(a1.description?.includes('Common Utilities Suite'));
    assert.deepStrictEqual(a1.source, {
      source: 'directory',
      path: '/home/user/works/ai-coding-tools/agentic-coding-kit',
    });

    const a2 = result.available[1];
    assert.strictEqual(a2.pluginId, 'agentic-meta@agentic-coding-kit');
    assert.strictEqual(a2.name, 'agentic-meta');
    assert.strictEqual(a2.marketplaceName, 'agentic-coding-kit');
    assert.strictEqual(a2.version, '0.1.0');

    const a3 = result.available[2];
    assert.strictEqual(a3.pluginId, 'github-tools@anthropic-plugin-directory');
    assert.strictEqual(a3.name, 'github-tools');
    assert.strictEqual(a3.marketplaceName, 'anthropic-plugin-directory');
  });

  it('listMarketplaces parses recorded fixture into marketplace list', async () => {
    const cli = new ClaudeCli({
      executor: createFixtureExecutor({
        'plugin marketplace list --json': { stdout: RAW_LIST_MARKETPLACES_JSON, stderr: '', code: 0 },
      }),
    });

    const marketplaces = await cli.listMarketplaces();

    assert.strictEqual(marketplaces.length, 1);
    assert.strictEqual(marketplaces[0].name, 'agentic-coding-kit');
    assert.strictEqual(marketplaces[0].source, 'directory');
    assert.strictEqual(marketplaces[0].path, '/home/user/works/ai-coding-tools/agentic-coding-kit');
    assert.strictEqual(marketplaces[0].installLocation, '/home/user/works/ai-coding-tools/agentic-coding-kit');
  });

  it('pluginDetails parses text inventory and projected token cost from real CLI output', async () => {
    const cli = new ClaudeCli({
      executor: createFixtureExecutor({
        'plugin details common-tools@agentic-coding-kit': { stdout: RAW_PLUGIN_DETAILS_TXT, stderr: '', code: 0 },
      }),
    });

    const details = await cli.pluginDetails('common-tools@agentic-coding-kit');

    assert.deepStrictEqual(details.components.skills, [
      'agents-md-generator',
      'gitignore',
      'macroplan-authoring',
      'markdown-formatter',
    ]);
    assert.deepStrictEqual(details.components.agents, ['merge-resolver']);
    assert.deepStrictEqual(details.components.hooks, []);
    assert.deepStrictEqual(details.components.mcpServers, []);
    assert.deepStrictEqual(details.components.lspServers, []);
    assert.strictEqual(details.alwaysOnTokens, 520);
  });

  it('pluginDetails parses commands, hooks, MCP, and LSP servers when present in text inventory', async () => {
    const cli = new ClaudeCli({
      executor: createFixtureExecutor({
        'plugin details dev-suite@tools': { stdout: RAW_PLUGIN_DETAILS_WITH_COMMANDS_TXT, stderr: '', code: 0 },
      }),
    });

    const details = await cli.pluginDetails('dev-suite@tools');

    assert.deepStrictEqual(details.components.skills, ['build-helper', 'test-runner']);
    assert.deepStrictEqual(details.components.agents, ['reviewer']);
    assert.deepStrictEqual(details.components.commands, ['deploy', 'benchmark']);
    assert.deepStrictEqual(details.components.hooks, ['pre-commit']);
    assert.deepStrictEqual(details.components.mcpServers, ['db-server']);
    assert.deepStrictEqual(details.components.lspServers, ['py-lsp']);
    assert.strictEqual(details.alwaysOnTokens, 1250);
  });

  it('pluginDetails supports JSON output mode when returned by CLI', async () => {
    const jsonOutput = JSON.stringify({
      components: {
        skills: ['skill-a', 'skill-b'],
        agents: ['agent-x'],
        commands: ['cmd-1'],
        hooks: [],
        mcpServers: ['mcp-srv'],
        lspServers: [],
      },
      alwaysOnTokens: 980,
    });

    const cli = new ClaudeCli({
      executor: createFixtureExecutor({
        'plugin details json-plugin@market': { stdout: jsonOutput, stderr: '', code: 0 },
      }),
    });

    const details = await cli.pluginDetails('json-plugin@market');

    assert.deepStrictEqual(details.components.skills, ['skill-a', 'skill-b']);
    assert.deepStrictEqual(details.components.agents, ['agent-x']);
    assert.deepStrictEqual(details.components.commands, ['cmd-1']);
    assert.deepStrictEqual(details.components.mcpServers, ['mcp-srv']);
    assert.strictEqual(details.alwaysOnTokens, 980);
  });

  it('throws ClaudeCliParseError with attached rawOutput on truncated or malformed JSON', async () => {
    const truncated = '[{"id": "incomplete"';
    const cli = new ClaudeCli({
      executor: createFixtureExecutor({
        'plugin list --json': { stdout: truncated, stderr: '', code: 0 },
        'plugin list --available --json': { stdout: '{"installed": [', stderr: '', code: 0 },
        'plugin marketplace list --json': { stdout: 'not-json', stderr: '', code: 0 },
        'plugin details bad-details': { stdout: 'Some random text without component inventory', stderr: '', code: 0 },
      }),
    });

    await assert.rejects(
      () => cli.listPlugins(),
      (err: unknown) => {
        assert.ok(err instanceof ClaudeCliParseError);
        assert.strictEqual(err.rawOutput, truncated);
        return true;
      }
    );

    await assert.rejects(
      () => cli.listAvailablePlugins(),
      (err: unknown) => {
        assert.ok(err instanceof ClaudeCliParseError);
        assert.strictEqual(err.rawOutput, '{"installed": [');
        return true;
      }
    );

    await assert.rejects(
      () => cli.listMarketplaces(),
      (err: unknown) => {
        assert.ok(err instanceof ClaudeCliParseError);
        assert.strictEqual(err.rawOutput, 'not-json');
        return true;
      }
    );

    await assert.rejects(
      () => cli.pluginDetails('bad-details'),
      (err: unknown) => {
        assert.ok(err instanceof ClaudeCliParseError);
        assert.ok(err.rawOutput.includes('Some random text'));
        return true;
      }
    );
  });

  it('write functions throw not implemented error for 45.4/45.5', async () => {
    const cli = new ClaudeCli({ skipVersionCheck: true });

    await assert.rejects(() => cli.installPlugin('foo'), /not implemented/);
    await assert.rejects(() => cli.uninstallPlugin('foo'), /not implemented/);
    await assert.rejects(() => cli.enablePlugin('foo'), /not implemented/);
    await assert.rejects(() => cli.disablePlugin('foo'), /not implemented/);
    await assert.rejects(() => cli.updatePlugin('foo'), /not implemented/);
    await assert.rejects(() => cli.addMarketplace('/path'), /not implemented/);
    await assert.rejects(() => cli.removeMarketplace('foo'), /not implemented/);
  });

  it('top-level standalone helper functions delegate to ClaudeCli instance', async () => {
    const executor = createFixtureExecutor({
      'plugin list --json': { stdout: RAW_LIST_PLUGINS_JSON, stderr: '', code: 0 },
      'plugin list --available --json': { stdout: RAW_LIST_AVAILABLE_JSON, stderr: '', code: 0 },
      'plugin marketplace list --json': { stdout: RAW_LIST_MARKETPLACES_JSON, stderr: '', code: 0 },
      'plugin details common-tools@agentic-coding-kit': { stdout: RAW_PLUGIN_DETAILS_TXT, stderr: '', code: 0 },
    });

    const plugins = await listPlugins({ executor });
    assert.strictEqual(plugins.length, 2);

    const available = await listAvailablePlugins({ executor });
    assert.strictEqual(available.available.length, 3);

    const marketplaces = await listMarketplaces({ executor });
    assert.strictEqual(marketplaces.length, 1);

    const details = await pluginDetails('common-tools@agentic-coding-kit', { executor });
    assert.strictEqual(details.alwaysOnTokens, 520);
  });

  it('reads physical fixture files from disk and verifies they match raw fixtures', () => {
    function getFixturesDir(): string {
      const candidateOut = path.join(__dirname, '__fixtures__', 'claudeCli');
      if (fs.existsSync(candidateOut)) return candidateOut;
      return path.resolve(__dirname, '../../src/engine/__fixtures__/claudeCli');
    }

    const fixturesDir = getFixturesDir();
    assert.ok(fs.existsSync(fixturesDir), 'Fixtures directory must exist on disk');

    const pluginsRaw = fs.readFileSync(path.join(fixturesDir, 'listPlugins.json'), 'utf-8');
    assert.deepStrictEqual(JSON.parse(pluginsRaw), JSON.parse(RAW_LIST_PLUGINS_JSON));

    const availableRaw = fs.readFileSync(path.join(fixturesDir, 'listAvailable.json'), 'utf-8');
    assert.deepStrictEqual(JSON.parse(availableRaw), JSON.parse(RAW_LIST_AVAILABLE_JSON));

    const marketplacesRaw = fs.readFileSync(path.join(fixturesDir, 'listMarketplaces.json'), 'utf-8');
    assert.deepStrictEqual(JSON.parse(marketplacesRaw), JSON.parse(RAW_LIST_MARKETPLACES_JSON));

    const detailsRaw = fs.readFileSync(path.join(fixturesDir, 'pluginDetails.txt'), 'utf-8');
    assert.strictEqual(detailsRaw.trim(), RAW_PLUGIN_DETAILS_TXT.trim());

    const detailsCmdsRaw = fs.readFileSync(path.join(fixturesDir, 'pluginDetailsWithCommands.txt'), 'utf-8');
    assert.strictEqual(detailsCmdsRaw.trim(), RAW_PLUGIN_DETAILS_WITH_COMMANDS_TXT.trim());
  });
});

describe('claudeCli — opt-in real CLI smoke test (AISK_REAL_CLAUDE=1)', () => {
  it('runs against real claude binary with isolated CLAUDE_CONFIG_DIR when enabled', async () => {
    if (process.env.AISK_REAL_CLAUDE !== '1') {
      // Opt-in only: skipped unless AISK_REAL_CLAUDE=1
      return;
    }

    const isolatedConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aisk-smoke-claude-'));
    try {
      const cli = new ClaudeCli();
      const plugins = await cli.listPlugins({
        env: {
          CLAUDE_CONFIG_DIR: isolatedConfigDir,
        },
      });

      // An isolated empty config directory should return an empty plugin list
      assert.ok(Array.isArray(plugins));
      assert.strictEqual(plugins.length, 0);
    } finally {
      fs.rmSync(isolatedConfigDir, { recursive: true, force: true });
    }
  });
});
