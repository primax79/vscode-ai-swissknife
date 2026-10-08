export const RAW_LIST_PLUGINS_JSON = JSON.stringify([
  {
    id: 'common-tools@agentic-coding-kit',
    version: '0.3.2',
    scope: 'user',
    enabled: false,
    installPath: '/tmp/cfg/plugins/cache/agentic-coding-kit/common-tools/0.3.2',
    installedAt: '2026-10-08T23:36:10.277Z',
    lastUpdated: '2026-10-08T23:36:10.277Z',
    projectEnabled: false,
    notes: ['Disabled in ~/.claude/settings.json but still loads'],
    noteDetails: [{ type: 'ineffective-disable' }]
  },
  {
    id: 'common-tools@agentic-coding-kit',
    version: '0.3.2',
    scope: 'local',
    enabled: true,
    installPath: '/tmp/cfg/plugins/cache/agentic-coding-kit/common-tools/0.3.2',
    installedAt: '2026-10-08T23:37:59.524Z',
    lastUpdated: '2026-10-08T23:37:59.524Z',
    projectPath: '/home/user/works/ai-coding-tools/ai-swissknife',
    projectEnabled: false
  }
], null, 2);

export const RAW_LIST_AVAILABLE_JSON = JSON.stringify({
  installed: [
    {
      id: 'common-tools@agentic-coding-kit',
      version: '0.3.2',
      scope: 'user',
      enabled: true,
      installPath: '/tmp/cfg/plugins/cache/agentic-coding-kit/common-tools/0.3.2',
      installedAt: '2026-10-08T23:36:10.277Z',
      lastUpdated: '2026-10-08T23:36:10.277Z',
      projectEnabled: false
    }
  ],
  available: [
    {
      pluginId: 'common-tools@agentic-coding-kit',
      name: 'common-tools',
      description: 'Common Utilities Suite - Cross-platform development tools for Claude & Kilo (gitignore, markdown-formatter, macroplan-authoring, agents-md-generator, merge-resolver)',
      marketplaceName: 'agentic-coding-kit',
      version: '0.3.2',
      source: {
        source: 'directory',
        path: '/home/user/works/ai-coding-tools/agentic-coding-kit'
      }
    },
    {
      pluginId: 'agentic-meta@agentic-coding-kit',
      name: 'agentic-meta',
      description: 'Meta tools for authoring skills and agents',
      marketplaceName: 'agentic-coding-kit',
      version: '0.1.0',
      source: {
        source: 'directory',
        path: '/home/user/works/ai-coding-tools/agentic-coding-kit'
      }
    },
    {
      pluginId: 'github-tools@anthropic-plugin-directory',
      name: 'github-tools',
      description: 'GitHub integration tools for pull requests and issues',
      marketplaceName: 'anthropic-plugin-directory',
      version: '1.0.0',
      source: {
        source: 'url',
        url: 'https://github.com/example/github-tools.git',
        sha: 'abcdef123456'
      }
    }
  ]
}, null, 2);

export const RAW_LIST_MARKETPLACES_JSON = JSON.stringify([
  {
    name: 'agentic-coding-kit',
    source: 'directory',
    path: '/home/user/works/ai-coding-tools/agentic-coding-kit',
    installLocation: '/home/user/works/ai-coding-tools/agentic-coding-kit'
  }
], null, 2);

export const RAW_PLUGIN_DETAILS_TXT = `common-tools 0.3.2
  Description: Common Utilities Suite - Cross-platform development tools for Claude & Kilo (gitignore, markdown-formatter, macroplan-authoring, agents-md-generator, merge-resolver)
  Source: common-tools@agentic-coding-kit

Component inventory
  Skills (4)  agents-md-generator, gitignore, macroplan-authoring, markdown-formatter
  Agents (1)  merge-resolver
  Hooks (0)
  MCP servers (0)
  LSP servers (0)

Projected token cost
  Always-on:   ~520 tok   added to every session

Per-component (rounded)
  component            always-on  on-invoke
  markdown-formatter         ~80       ~920
  macroplan-authoring       ~250      ~5.4k
  agents-md-generator       ~120       ~900
  gitignore                  ~60      ~1.1k
  merge-resolver            < 20      ~6.6k

  On-invoke cost is paid each time a skill or agent fires.
  Token counts are estimates and may differ from actual usage.`;

export const RAW_PLUGIN_DETAILS_WITH_COMMANDS_TXT = `dev-suite 1.0.0
  Description: Developer suite with commands
  Source: dev-suite@tools

Component inventory
  Skills (2)  build-helper, test-runner
  Agents (1)  reviewer
  Commands (2)  deploy, benchmark
  Hooks (1)  pre-commit
  MCP servers (1)  db-server
  LSP servers (1)  py-lsp

Projected token cost
  Always-on:   ~1,250 tok   added to every session

Per-component (rounded)
  component            always-on  on-invoke
  build-helper              ~500      ~1.0k
  test-runner               ~400      ~2.0k
  reviewer                  ~350      ~3.0k`;
