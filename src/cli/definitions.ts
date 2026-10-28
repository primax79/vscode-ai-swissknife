import {
  runSources,
  runCatalog,
  runInstalled,
  runUpdates,
  runItem,
  runPlanInstall,
  runRedistribute,
  runApplyInstall,
  runUninstall,
  runSourceAdd,
  runSourceRemove,
  runUpdate,
  runTrashList,
  runTrashRestore,
  runTrashEmpty,
  runRelink,
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
      {
        flags: '--flags <flag,...>',
        description:
          'Filter by flags: link, copy, broken-link, orphan, duplicate (comma-separated)',
      },
      {
        flags: '--roots <dirs...>',
        description: 'Workspace root directories to scan (overrides --workspace)',
      },
      {
        flags: '--max-depth <n>',
        description: 'Maximum directory search depth (default 4)',
      },
      {
        flags: '--ignore <names...>',
        description: 'Directory names to ignore (replaces defaults)',
      },
      {
        flags: '--extra-ignore <names...>',
        description: 'Additional directory names to ignore',
      },
    ],
    examples: [
      'ai-swissknife installed',
      'ai-swissknife installed --scope global --assistant claude-code',
      'ai-swissknife installed --kind skill',
      'ai-swissknife installed --flags link',
      'ai-swissknife installed --flags orphan,broken-link',
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
          workspace: {
            type: 'string',
            optional: true,
            description: 'Workspace root path (null for Global scope)',
          },
          flags: {
            type: 'array',
            description: 'Item flags (link, copy, broken-link, orphan, duplicate)',
            items: {
              type: 'string',
              enum: ['link', 'copy', 'broken-link', 'orphan', 'duplicate'],
            },
          },
          linkTarget: {
            type: 'string',
            optional: true,
            description: 'Resolved target path for symlinks',
          },
          duplicateOf: {
            type: 'array',
            optional: true,
            description:
              'Other item keys representing the same artifact for the same assistant',
            items: { type: 'string' },
          },
        },
      },
    },
    run: async (opts) => runInstalled(opts),
  },
  {
    name: 'updates',
    aliases: ['status'],
    description: 'Check drift and upstream updates for managed installations',
    arguments: [
      {
        name: 'item',
        required: false,
        description: 'Item key to check (optional, checks all if omitted)',
      },
    ],
    options: [
      {
        flags: '--explain',
        description: 'Explain drift and provenance state for each item',
      },
      {
        flags: '--json',
        description: 'Output machine-readable JSON (with --explain)',
      },
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
      {
        flags: '--roots <dirs...>',
        description: 'Workspace root directories to scan (overrides --workspace)',
      },
      {
        flags: '--max-depth <n>',
        description: 'Maximum directory search depth (default 4)',
      },
      {
        flags: '--ignore <names...>',
        description: 'Directory names to ignore (replaces defaults)',
      },
      {
        flags: '--extra-ignore <names...>',
        description: 'Additional directory names to ignore',
      },
    ],
    examples: [
      'ai-swissknife updates',
      'ai-swissknife updates --assistant kilo-code',
      'ai-swissknife status --explain',
      'ai-swissknife status --explain claude-code:global:skill:conflict-resolver',
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
              'source-unavailable',
              'provenance-unknown',
            ],
          },
          sourceId: { type: 'string', optional: true },
          sourceIdentity: { type: 'string', optional: true },
          installedCommit: { type: 'string', optional: true },
          currentCommit: { type: 'string', optional: true },
          installedContentHash: { type: 'string', optional: true },
          sourceContentHash: { type: 'string', optional: true },
          diskHash: { type: 'string', optional: true },
          rebaselined: { type: 'string', optional: true },
          reason: { type: 'string', optional: true },
          details: { type: 'string', optional: true },
          workspace: {
            type: 'string',
            optional: true,
            description: 'Workspace root path (null for Global scope)',
          },
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
      {
        flags: '--roots <dirs...>',
        description: 'Workspace root directories to scan (overrides --workspace)',
      },
      {
        flags: '--max-depth <n>',
        description: 'Maximum directory search depth (default 4)',
      },
      {
        flags: '--ignore <names...>',
        description: 'Directory names to ignore (replaces defaults)',
      },
      {
        flags: '--extra-ignore <names...>',
        description: 'Additional directory names to ignore',
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
        workspace: {
          type: 'string',
          optional: true,
          description: 'Workspace root path (null for Global scope)',
        },
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
    name: 'redistribute',
    description:
      'Push an edited skill or artifact from a local folder to its installed copies',
    arguments: [
      {
        name: 'target',
        required: true,
        description: 'Folder path or installed item name/key',
      },
    ],
    options: [
      {
        flags: '--item <name...>',
        description: 'Specific artifact name(s) to redistribute',
      },
      {
        flags: '--assistants <ids>',
        description:
          'Comma-separated assistant IDs to target (e.g. claude-code,kilo-code)',
      },
      {
        flags: '--scope <scope>',
        description: 'Target scope: global or project (Workspace)',
      },
      {
        flags: '--force',
        description:
          'Overwrite modified-locally copies (previous version saved to trash first)',
      },
      {
        flags: '--install-missing',
        description:
          'Install into assistant x scope combinations that do not have a copy',
      },
      {
        flags: '--write',
        description:
          'Apply changes to disk (without this flag, only prints the plan)',
      },
      {
        flags: '--allow-code-kinds',
        description:
          'Allow redistributing executable/code kinds (hook, mcp-server)',
      },
    ],
    examples: [
      'ai-swissknife redistribute ./my-skill',
      'ai-swissknife redistribute ./my-skill --write',
      'ai-swissknife redistribute claude-code:global:skill:my-skill --force --write',
      'ai-swissknife redistribute ./skills --item my-skill --assistants claude-code,kilo-code --install-missing --write',
    ],
    outputShape: {
      type: 'object',
      description: 'Redistribution plan or execution result',
      properties: {
        mode: { type: 'string', enum: ['plan', 'applied'] },
        targets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              item: { type: 'string', description: 'Item name' },
              kind: {
                type: 'string',
                enum: ['skill', 'agent', 'command', 'mcp-server', 'hook', 'rule'],
              },
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
              path: { type: 'string', description: 'Filesystem path' },
              classification: {
                type: 'string',
                enum: [
                  'identical',
                  'stale',
                  'modified-locally',
                  'missing-on-disk',
                  'orphan',
                  'missing',
                ],
              },
              action: {
                type: 'string',
                enum: [
                  'update',
                  'install',
                  'skip',
                  'updated',
                  'installed',
                  'skipped',
                  'failed',
                ],
              },
              oldHash: { type: 'string', optional: true },
              newHash: { type: 'string', optional: true },
              changedFiles: {
                type: 'object',
                properties: {
                  added: { type: 'array', items: { type: 'string' } },
                  changed: { type: 'array', items: { type: 'string' } },
                  removed: { type: 'array', items: { type: 'string' } },
                },
              },
              backupPath: { type: 'string', optional: true },
              reason: { type: 'string', optional: true },
            },
          },
        },
      },
    },
    run: async (opts, globalOpts) => {
      const assistants = opts.assistants || globalOpts.assistants;
      return runRedistribute({ ...globalOpts, ...opts, assistants } as any);
    },
  },
  {
    name: 'apply-install',
    description: 'Apply installation matrix (plan-only without --write)',
    options: [
      { flags: '--source <id>', description: 'Source ID', required: true },
      { flags: '--artifact <id>', description: 'Artifact ID', required: true },
      {
        flags: '--assistants <ids>',
        description: 'Comma-separated target assistant IDs (e.g. claude-code,kilo-code)',
      },
      {
        flags: '--scopes <scopes>',
        description: 'Comma-separated target scopes: global,project',
        required: true,
      },
      {
        flags: '--overwrite',
        description: 'Overwrite existing installations (previous version saved to trash)',
      },
      {
        flags: '--write',
        description: 'Apply changes to disk (without this flag, only prints the plan)',
      },
      {
        flags: '--allow-code-kinds',
        description: 'Allow installing executable/code kinds (hook, mcp-server)',
      },
    ],
    examples: [
      'ai-swissknife apply-install --source team-repo --artifact dev-tools --assistants claude-code --scopes global',
      'ai-swissknife apply-install --source team-repo --artifact dev-tools --assistants claude-code --scopes global --write',
    ],
    outputShape: {
      type: 'object',
      description: 'Installation application result or plan',
      properties: {
        mode: { type: 'string', enum: ['plan', 'applied'] },
        targets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              item: { type: 'string' },
              kind: {
                type: 'string',
                enum: ['skill', 'agent', 'command', 'mcp-server', 'hook', 'rule'],
              },
              assistant: { type: 'string' },
              scope: { type: 'string', enum: ['global', 'project'] },
              status: { type: 'string' },
              action: { type: 'string', optional: true },
              changedFiles: { type: 'object', optional: true },
              backupPath: { type: 'string', optional: true },
              reason: { type: 'string', optional: true },
              warnings: { type: 'array', optional: true },
            },
          },
        },
      },
    },
    run: async (opts, globalOpts) => {
      const assistants = opts.assistants || globalOpts.assistants;
      return runApplyInstall({ ...globalOpts, ...opts, assistants } as any);
    },
  },
  {
    name: 'uninstall',
    description:
      'Uninstall a managed installation (soft delete to trash by default, or permanent with --hard)',
    arguments: [
      {
        name: 'key',
        required: true,
        description: 'Item key (e.g. claude-code:global:skill:my-skill) or name',
      },
    ],
    options: [
      {
        flags: '--hard',
        description: 'Permanently delete files instead of moving to trash',
      },
      {
        flags: '--write',
        description: 'Apply changes to disk (without this flag, only prints the plan)',
      },
      {
        flags: '--allow-code-kinds',
        description: 'Allow uninstalling executable/code kinds (hook, mcp-server)',
      },
    ],
    examples: [
      'ai-swissknife uninstall claude-code:global:skill:my-skill',
      'ai-swissknife uninstall claude-code:global:skill:my-skill --write',
      'ai-swissknife uninstall claude-code:global:skill:my-skill --hard --write',
    ],
    outputShape: {
      type: 'object',
      description: 'Uninstallation outcome or plan',
      properties: {
        mode: { type: 'string', enum: ['plan', 'applied'] },
        key: { type: 'string' },
        item: { type: 'string' },
        kind: {
          type: 'string',
          enum: ['skill', 'agent', 'command', 'mcp-server', 'hook', 'rule'],
        },
        assistant: { type: 'string' },
        scope: { type: 'string', enum: ['global', 'project'] },
        path: { type: 'string' },
        hard: { type: 'boolean' },
        changedFiles: { type: 'object', optional: true },
        backupPath: { type: 'string', optional: true },
      },
    },
    run: async (opts, globalOpts) => runUninstall(opts.key, { ...globalOpts, ...opts }),
  },
  {
    name: 'source add',
    description: 'Add or replace a source definition in manifest',
    arguments: [
      {
        name: 'type',
        required: true,
        description:
          'Source type (local-folder, git-custom, git-marketplace, git-single-item, remote-url)',
      },
      {
        name: 'location',
        required: true,
        description: 'Source location (URL or local folder path)',
      },
    ],
    options: [
      {
        flags: '--id <id>',
        description: 'Source ID (derived from location if omitted)',
      },
      {
        flags: '--name <name>',
        description: 'Source display name (derived from location if omitted)',
      },
      {
        flags: '--scope <scope>',
        description: 'Target scope: global or project (Workspace)',
      },
      {
        flags: '--replace',
        description: 'Replace existing source if same ID already exists',
      },
      {
        flags: '--write',
        description: 'Apply changes to disk (without this flag, only prints the plan)',
      },
    ],
    examples: [
      'ai-swissknife source add git-custom https://github.com/org/skills.git',
      'ai-swissknife source add git-custom https://github.com/org/skills.git --write',
      'ai-swissknife source add local-folder ./my-skills --id custom-skills --scope project --write',
    ],
    outputShape: {
      type: 'object',
      description: 'Result of adding a source to manifest',
      properties: {
        mode: { type: 'string', enum: ['plan', 'applied'] },
        action: {
          type: 'string',
          enum: ['add', 'replace', 'added', 'replaced'],
        },
        source: { type: 'object' },
        changedFiles: { type: 'object', optional: true },
      },
    },
    run: async (opts, globalOpts) =>
      runSourceAdd(opts.type, opts.location, { ...globalOpts, ...opts }),
  },
  {
    name: 'source remove',
    description:
      'Remove a source definition and its desired installations from manifest',
    arguments: [
      {
        name: 'id',
        required: true,
        description: 'Source identifier',
      },
    ],
    options: [
      {
        flags: '--scope <scope>',
        description: 'Target scope: global or project (Workspace)',
        required: true,
      },
      {
        flags: '--write',
        description: 'Apply changes to disk (without this flag, only prints the plan)',
      },
    ],
    examples: [
      'ai-swissknife source remove my-skills --scope global',
      'ai-swissknife source remove my-skills --scope global --write',
    ],
    outputShape: {
      type: 'object',
      description: 'Result of removing a source from manifest',
      properties: {
        mode: { type: 'string', enum: ['plan', 'applied'] },
        action: { type: 'string', enum: ['remove', 'removed'] },
        source: { type: 'object' },
        changedFiles: { type: 'object', optional: true },
      },
    },
    run: async (opts, globalOpts) =>
      runSourceRemove(opts.id, { ...globalOpts, ...opts }),
  },
  {
    name: 'update',
    description: 'Update managed installation(s) from upstream source(s)',
    arguments: [
      {
        name: 'key',
        required: false,
        description: 'Item key (optional if --all is passed)',
      },
    ],
    options: [
      {
        flags: '--all',
        description: 'Update all managed installations matching filters',
      },
      {
        flags: '--scope <scope>',
        description: 'Filter by scope: global or project',
      },
      {
        flags: '--assistant <id>',
        description: 'Filter by assistant ID',
      },
      {
        flags: '--source <id>',
        description: 'Filter by source ID',
      },
      {
        flags: '--kind <kind>',
        description: 'Filter by artifact kind',
      },
      {
        flags: '--include-modified',
        description:
          'Update modified-locally items (previous version saved to trash first)',
      },
      {
        flags: '--write',
        description: 'Apply changes to disk (without this flag, only prints the plan)',
      },
      {
        flags: '--allow-code-kinds',
        description:
          'Allow updating executable/code kinds (hook, mcp-server)',
      },
    ],
    examples: [
      'ai-swissknife update --all',
      'ai-swissknife update --all --write',
      'ai-swissknife update claude-code:global:skill:my-skill --write',
      'ai-swissknife update --all --include-modified --write',
    ],
    outputShape: {
      type: 'object',
      description: 'Update results or plan',
      properties: {
        mode: { type: 'string', enum: ['plan', 'applied'] },
        targets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              item: { type: 'string' },
              kind: {
                type: 'string',
                enum: ['skill', 'agent', 'command', 'mcp-server', 'hook', 'rule'],
              },
              assistant: { type: 'string' },
              scope: { type: 'string', enum: ['global', 'project'] },
              status: { type: 'string' },
              action: { type: 'string', optional: true },
              oldRevision: { type: 'string', optional: true },
              newRevision: { type: 'string', optional: true },
              changedFiles: { type: 'object' },
              backupPath: { type: 'string', optional: true },
              reason: { type: 'string', optional: true },
            },
          },
        },
      },
    },
    run: async (opts, globalOpts) => runUpdate(opts.key, { ...globalOpts, ...opts }),
  },
  {
    name: 'trash list',
    description: 'List soft-deleted items in trash (newest first)',
    options: [
      {
        flags: '--scope <scope>',
        description: 'Filter by scope: global or project',
      },
    ],
    examples: [
      'ai-swissknife trash list',
      'ai-swissknife trash list --scope global',
    ],
    outputShape: {
      type: 'array',
      description: 'List of soft-deleted items in trash',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Trash entry ID' },
          kind: {
            type: 'string',
            enum: ['skill', 'agent', 'command', 'mcp-server', 'hook', 'rule'],
          },
          name: { type: 'string' },
          assistant: { type: 'string', optional: true },
          scope: { type: 'string', enum: ['global', 'project'] },
          deletedAt: { type: 'string' },
          originalPath: { type: 'string', optional: true },
          trashPath: { type: 'string' },
        },
      },
    },
    run: async (opts, globalOpts) => runTrashList({ ...globalOpts, ...opts }),
  },
  {
    name: 'trash restore',
    description: 'Restore a soft-deleted item from trash',
    arguments: [
      {
        name: 'id',
        required: true,
        description: 'Trash entry ID or name',
      },
    ],
    options: [
      {
        flags: '--to <path>',
        description: 'Destination path (defaults to recorded original path)',
      },
      {
        flags: '--write',
        description: 'Apply changes to disk (without this flag, only prints the plan)',
      },
    ],
    examples: [
      'ai-swissknife trash restore my-skill-2026-10-09T00-00-00-000Z',
      'ai-swissknife trash restore my-skill-2026-10-09T00-00-00-000Z --write',
      'ai-swissknife trash restore my-skill-2026-10-09T00-00-00-000Z --to /custom/path --write',
    ],
    outputShape: {
      type: 'object',
      description: 'Trash restore result or plan',
      properties: {
        mode: { type: 'string', enum: ['plan', 'applied'] },
        id: { type: 'string' },
        name: { type: 'string' },
        kind: {
          type: 'string',
          enum: ['skill', 'agent', 'command', 'mcp-server', 'hook', 'rule'],
        },
        scope: { type: 'string', enum: ['global', 'project'] },
        targetPath: { type: 'string' },
        changedFiles: { type: 'object', optional: true },
      },
    },
    run: async (opts, globalOpts) =>
      runTrashRestore(opts.id, { ...globalOpts, ...opts }),
  },
  {
    name: 'trash empty',
    description: 'Permanently remove all soft-deleted items from trash',
    options: [
      {
        flags: '--scope <scope>',
        description: 'Scope to empty: global or project (defaults to all)',
      },
      {
        flags: '--write',
        description: 'Apply changes to disk (without this flag, only prints the plan)',
      },
    ],
    examples: [
      'ai-swissknife trash empty',
      'ai-swissknife trash empty --scope global --write',
      'ai-swissknife trash empty --write',
    ],
    outputShape: {
      type: 'object',
      description: 'Result of emptying trash',
      properties: {
        mode: { type: 'string', enum: ['plan', 'applied'] },
        count: { type: 'number' },
        failed: { type: 'array', optional: true },
      },
    },
    run: async (opts, globalOpts) => runTrashEmpty({ ...globalOpts, ...opts }),
  },
  {
    name: 'relink',
    description:
      'Re-link a managed installation to a specific registered source (<scope>:<id>). Plan-only unless --write is passed.',
    arguments: [
      {
        name: 'item',
        required: true,
        description:
          'Installed item key (<assistant>:<scope>:<kind>:<name>) or unambiguous item name',
      },
    ],
    options: [
      {
        flags: '--source <scope:id>',
        description:
          'Target registered source in <scope>:<id> format (e.g. global:my-source or project:my-source)',
        required: true,
      },
      {
        flags: '--write',
        description: 'Apply the relink to state.json (default is plan-only)',
      },
    ],
    outputShape: {
      type: 'object',
      properties: {
        mode: 'plan | applied',
        key: 'string',
        item: 'string',
        assistant: 'string',
        scope: 'global | project',
        kind: 'string',
        path: 'string',
        oldSource: 'object | undefined',
        oldSourceId: 'string | undefined',
        newSource: {
          id: 'string',
          scope: 'global | workspace',
          type: 'string',
          location: 'string',
        },
        packageId: 'string | undefined',
        artifactId: 'string | undefined',
        sourceRevision: 'object | undefined',
        sourceContentHash: 'string | undefined',
      },
    },
    examples: [
      'ai-swissknife relink claude-code:project:skill:legacy-skill --source project:legacy-source',
      'ai-swissknife relink claude-code:project:skill:legacy-skill --source global:legacy-source --write',
    ],
    run: async (args, globalOpts) =>
      runRelink(args.item, {
        ...globalOpts,
        source: args.source,
        write: args.write,
      }),
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
    ...(def.aliases && def.aliases.length > 0 ? { aliases: def.aliases } : {}),
    description: def.description,
    ...(def.arguments && def.arguments.length > 0
      ? { arguments: def.arguments }
      : {}),
    options: def.options,
    outputShape: def.outputShape,
  }));
}
