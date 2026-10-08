import {
  runSources,
  runCatalog,
  runInstalled,
  runUpdates,
  runItem,
  runPlanInstall,
} from './commands';
import type {
  CliCommandDefinition,
  CliCommandDescription,
} from './types';

export const COMMAND_DEFINITIONS: CliCommandDefinition[] = [
  {
    name: 'sources',
    description: 'List registered sources across Global and Workspace scopes',
    options: [],
    examples: [
      'ai-swissknife sources',
      'ai-swissknife --workspace /path/to/project sources',
    ],
    outputShape: {
      type: 'array',
      description: 'List of registered source definitions',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Source identifier' },
          type: {
            type: 'string',
            description:
              'Source type (local-folder, git-custom, git-marketplace, git-single-item, remote-url)',
          },
          scope: {
            type: 'string',
            enum: ['global', 'project'],
            description: 'Source scope',
          },
          url: { type: 'string', optional: true, description: 'Git repository URL' },
          localPath: {
            type: 'string',
            optional: true,
            description: 'Local filesystem directory path',
          },
          branch: { type: 'string', optional: true, description: 'Git branch pin' },
          tag: { type: 'string', optional: true, description: 'Git tag pin' },
          commit: { type: 'string', optional: true, description: 'Git commit hash pin' },
          name: { type: 'string', optional: true, description: 'Display name' },
        },
      },
    },
    run: async (opts) => runSources(opts),
  },
  {
    name: 'catalog',
    description: 'Resolve registered sources and list available artifacts',
    options: [
      { flags: '--source <id>', description: 'Filter artifacts by source ID' },
      {
        flags: '--kind <kind>',
        description:
          'Filter artifacts by kind (skill, agent, command, mcp-server, hook, rule)',
      },
    ],
    examples: [
      'ai-swissknife catalog',
      'ai-swissknife catalog --source my-skills --kind skill',
    ],
    outputShape: {
      type: 'object',
      description: 'Resolved catalog of artifacts and resolution diagnostics',
      properties: {
        artifacts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sourceId: { type: 'string', description: 'Owning source ID' },
              scope: { type: 'string', enum: ['global', 'project'] },
              packageId: { type: 'string', description: 'Package identifier' },
              artifactId: { type: 'string', description: 'Artifact identifier' },
              kind: {
                type: 'string',
                enum: ['skill', 'agent', 'command', 'mcp-server', 'hook', 'rule'],
              },
              name: { type: 'string', description: 'Artifact name' },
              description: { type: 'string', optional: true },
              version: { type: 'string', optional: true },
            },
          },
        },
        diagnostics: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sourceId: { type: 'string' },
              scope: { type: 'string', enum: ['global', 'project'] },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    run: async (opts) => runCatalog(opts),
  },
  {
    name: 'installed',
    description: 'List installed managed and observed items',
    options: [
      {
        flags: '--scope <scope>',
        description: 'Filter by scope: global or project (Workspace)',
      },
      {
        flags: '--assistant <id>',
        description: 'Filter by assistant ID (e.g. claude-code)',
      },
      {
        flags: '--kind <kind>',
        description:
          'Filter by kind (skill, agent, command, mcp-server, hook, rule)',
      },
    ],
    examples: [
      'ai-swissknife installed',
      'ai-swissknife installed --scope global --assistant claude-code',
      'ai-swissknife installed --kind skill',
    ],
    outputShape: {
      type: 'array',
      description: 'List of installed managed and observed items',
      items: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'Item key (assistant:scope:kind:name)',
          },
          kind: {
            type: 'string',
            enum: ['skill', 'agent', 'command', 'mcp-server', 'hook', 'rule'],
          },
          name: { type: 'string', description: 'Item name' },
          assistant: {
            type: 'string',
            enum: [
              'claude-code',
              'kilo-code',
              'github-copilot',
              'codex-cli',
              'gemini-cli',
            ],
          },
          scope: { type: 'string', enum: ['global', 'project'] },
          membership: { type: 'string', enum: ['managed', 'observed'] },
          path: { type: 'string', description: 'Absolute filesystem path' },
          sourceId: { type: 'string', optional: true },
          match: {
            type: 'string',
            enum: ['identical', 'different'],
            optional: true,
          },
        },
      },
    },
    run: async (opts) => runInstalled(opts),
  },
  {
    name: 'updates',
    description: 'Check drift and upstream updates for managed installations',
    options: [
      {
        flags: '--scope <scope>',
        description: 'Filter by scope: global or project (Workspace)',
      },
      { flags: '--assistant <id>', description: 'Filter by assistant ID' },
      {
        flags: '--kind <kind>',
        description:
          'Filter by kind (skill, agent, command, mcp-server, hook, rule)',
      },
    ],
    examples: [
      'ai-swissknife updates',
      'ai-swissknife updates --assistant kilo-code',
    ],
    outputShape: {
      type: 'array',
      description:
        'List of drift and upstream update statuses for managed installations',
      items: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'Item key (assistant:scope:kind:name)',
          },
          kind: {
            type: 'string',
            enum: ['skill', 'agent', 'command', 'mcp-server', 'hook', 'rule'],
          },
          name: { type: 'string', description: 'Item name' },
          assistant: {
            type: 'string',
            enum: [
              'claude-code',
              'kilo-code',
              'github-copilot',
              'codex-cli',
              'gemini-cli',
            ],
          },
          scope: { type: 'string', enum: ['global', 'project'] },
          status: {
            type: 'string',
            enum: [
              'up-to-date',
              'update-available',
              'modified-locally',
              'modified-and-update-available',
              'unreachable',
              'missing-on-disk',
            ],
          },
          sourceId: { type: 'string', optional: true },
          details: { type: 'string', optional: true },
        },
      },
    },
    run: async (opts) => runUpdates(opts),
  },
  {
    name: 'item',
    description:
      'Inspect item details, origin, installed-in places, and diff availability',
    arguments: [
      {
        name: 'key',
        required: true,
        description: 'Item key (e.g. claude-code:global:skill:my-skill)',
      },
    ],
    options: [
      {
        flags: '--diff',
        description: 'Include size-capped unified diff against upstream original',
      },
    ],
    examples: [
      'ai-swissknife item claude-code:global:skill:my-skill',
      'ai-swissknife item claude-code:global:skill:my-skill --diff',
    ],
    outputShape: {
      type: 'object',
      description:
        'Detailed inspection of an item including origin, cross-installations, and diff',
      properties: {
        key: {
          type: 'string',
          description: 'Item key (assistant:scope:kind:name)',
        },
        kind: {
          type: 'string',
          enum: ['skill', 'agent', 'command', 'mcp-server', 'hook', 'rule'],
        },
        name: { type: 'string', description: 'Item name' },
        assistant: {
          type: 'string',
          enum: [
            'claude-code',
            'kilo-code',
            'github-copilot',
            'codex-cli',
            'gemini-cli',
          ],
        },
        scope: { type: 'string', enum: ['global', 'project'] },
        membership: { type: 'string', enum: ['managed', 'observed'] },
        path: { type: 'string', description: 'Filesystem path' },
        origin: {
          type: 'object',
          optional: true,
          properties: {
            sourceId: { type: 'string', optional: true },
            packageId: { type: 'string', optional: true },
            artifactId: { type: 'string', optional: true },
            sourceRevision: { type: 'string', optional: true },
            status: { type: 'string', optional: true },
            type: { type: 'string', optional: true },
          },
        },
        installedIn: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              assistant: { type: 'string' },
              scope: { type: 'string' },
              membership: { type: 'string' },
              path: { type: 'string' },
            },
          },
        },
        diffAvailable: {
          type: 'boolean',
          description: 'Whether an upstream diff is available',
        },
        diff: {
          type: 'string',
          optional: true,
          description: 'Unified diff against upstream original',
        },
      },
    },
    run: async (opts) => runItem(opts.key, opts),
  },
  {
    name: 'plan-install',
    description:
      'Preview installation matrix without applying changes (never writes)',
    options: [
      { flags: '--source <id>', description: 'Source ID', required: true },
      { flags: '--artifact <id>', description: 'Artifact ID', required: true },
      {
        flags: '--assistants <ids>',
        description:
          'Comma-separated target assistant IDs (e.g. claude-code,kilo-code)',
      },
      {
        flags: '--scopes <scopes>',
        description: 'Comma-separated target scopes: global,project',
        required: true,
      },
      { flags: '--overwrite-check', description: 'Simulate overwrite check' },
    ],
    examples: [
      'ai-swissknife plan-install --source team-repo --artifact dev-tools --assistants claude-code,kilo-code --scopes global,project',
    ],
    outputShape: {
      type: 'object',
      description: 'Preview of installation matrix without applying changes',
      properties: {
        counts: {
          type: 'object',
          properties: {
            total: { type: 'number' },
            new: { type: 'number' },
            update: { type: 'number' },
            conflict: { type: 'number' },
            unsupported: { type: 'number' },
          },
        },
        new: { type: 'array' },
        update: { type: 'array' },
        conflict: { type: 'array' },
        unsupported: { type: 'array' },
      },
    },
    run: async (opts, globalOpts) => {
      const assistants = opts.assistants || globalOpts.assistants;
      return runPlanInstall({ ...opts, assistants } as any);
    },
  },
  {
    name: 'describe',
    description:
      'Machine-readable description of all commands, options, and output shapes',
    options: [],
    examples: ['ai-swissknife describe'],
    outputShape: {
      type: 'array',
      description: 'List of registered command specifications',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Command name' },
          description: { type: 'string', description: 'Command summary' },
          arguments: { type: 'array', optional: true },
          options: { type: 'array' },
          outputShape: {
            type: 'object',
            description: 'JSON output schema specification',
          },
        },
      },
    },
    run: async () => runDescribe(),
  },
];

export function runDescribe(): CliCommandDescription[] {
  return COMMAND_DEFINITIONS.map((def) => ({
    name: def.name,
    description: def.description,
    ...(def.arguments && def.arguments.length > 0
      ? { arguments: def.arguments }
      : {}),
    options: def.options,
    outputShape: def.outputShape,
  }));
}
