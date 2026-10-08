import { Command, CommanderError } from 'commander';
import { emit, fail, CliError } from './output';
import {
  runSources,
  runCatalog,
  runInstalled,
  runUpdates,
  runItem,
  runPlanInstall,
} from './commands';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('ai-swissknife')
    .description('Cross-assistant AI artifact manager CLI')
    .version('0.4.0')
    .option('--workspace <path>', 'Workspace root folder path (used for Workspace scope)')
    .option('--home <path>', 'User home directory path (used for Global scope)')
    .option(
      '--assistants <ids>',
      'Comma-separated active assistant ids (e.g. claude-code,kilo-code)'
    )
    .exitOverride();

  program
    .command('sources')
    .description('List registered sources across Global and Workspace scopes')
    .addHelpText(
      'after',
      '\nExample:\n  $ ai-swissknife sources\n  $ ai-swissknife --workspace /path/to/project sources'
    )
    .action(async () => {
      try {
        const opts = program.opts();
        const result = await runSources(opts);
        emit(result);
      } catch (err: unknown) {
        handleActionError(err);
      }
    });

  program
    .command('catalog')
    .description('Resolve registered sources and list available artifacts')
    .option('--source <id>', 'Filter artifacts by source ID')
    .option(
      '--kind <kind>',
      'Filter artifacts by kind (skill, agent, command, mcp-server, hook, rule)'
    )
    .addHelpText(
      'after',
      '\nExample:\n  $ ai-swissknife catalog\n  $ ai-swissknife catalog --source my-skills --kind skill'
    )
    .action(async (cmdOpts) => {
      try {
        const globalOpts = program.opts();
        const result = await runCatalog({ ...globalOpts, ...cmdOpts });
        emit(result);
      } catch (err: unknown) {
        handleActionError(err);
      }
    });

  program
    .command('installed')
    .description('List installed managed and observed items')
    .option('--scope <scope>', 'Filter by scope: global or project (Workspace)')
    .option('--assistant <id>', 'Filter by assistant ID (e.g. claude-code)')
    .option(
      '--kind <kind>',
      'Filter by kind (skill, agent, command, mcp-server, hook, rule)'
    )
    .addHelpText(
      'after',
      '\nExample:\n  $ ai-swissknife installed\n  $ ai-swissknife installed --scope global --assistant claude-code\n  $ ai-swissknife installed --kind skill'
    )
    .action(async (cmdOpts) => {
      try {
        const globalOpts = program.opts();
        const result = await runInstalled({ ...globalOpts, ...cmdOpts });
        emit(result);
      } catch (err: unknown) {
        handleActionError(err);
      }
    });

  program
    .command('updates')
    .description('Check drift and upstream updates for managed installations')
    .option('--scope <scope>', 'Filter by scope: global or project (Workspace)')
    .option('--assistant <id>', 'Filter by assistant ID')
    .option(
      '--kind <kind>',
      'Filter by kind (skill, agent, command, mcp-server, hook, rule)'
    )
    .addHelpText(
      'after',
      '\nExample:\n  $ ai-swissknife updates\n  $ ai-swissknife updates --assistant kilo-code'
    )
    .action(async (cmdOpts) => {
      try {
        const globalOpts = program.opts();
        const result = await runUpdates({ ...globalOpts, ...cmdOpts });
        emit(result);
      } catch (err: unknown) {
        handleActionError(err);
      }
    });

  program
    .command('item <key>')
    .description(
      'Inspect item details, origin, installed-in places, and diff availability'
    )
    .option('--diff', 'Include size-capped unified diff against upstream original')
    .addHelpText(
      'after',
      '\nExample:\n  $ ai-swissknife item claude-code:global:skill:my-skill\n  $ ai-swissknife item claude-code:global:skill:my-skill --diff'
    )
    .action(async (key: string, cmdOpts) => {
      try {
        const globalOpts = program.opts();
        const result = await runItem(key, { ...globalOpts, ...cmdOpts });
        emit(result);
      } catch (err: unknown) {
        handleActionError(err);
      }
    });

  program
    .command('plan-install')
    .description(
      'Preview installation matrix without applying changes (never writes)'
    )
    .requiredOption('--source <id>', 'Source ID')
    .requiredOption('--artifact <id>', 'Artifact ID')
    .option(
      '--assistants <ids>',
      'Comma-separated target assistant IDs (e.g. claude-code,kilo-code)'
    )
    .requiredOption(
      '--scopes <scopes>',
      'Comma-separated target scopes: global,project'
    )
    .option('--overwrite-check', 'Simulate overwrite check')
    .addHelpText(
      'after',
      '\nExample:\n  $ ai-swissknife plan-install --source team-repo --artifact dev-tools --assistants claude-code,kilo-code --scopes global,project'
    )
    .action(async (cmdOpts) => {
      try {
        const globalOpts = program.opts();
        const assistants = cmdOpts.assistants || globalOpts.assistants;
        const result = await runPlanInstall({ ...globalOpts, ...cmdOpts, assistants });
        emit(result);
      } catch (err: unknown) {
        handleActionError(err);
      }
    });

  return program;
}

function handleActionError(err: unknown): never {
  if (err instanceof CliError) {
    fail(err.code, err.message);
  }
  const msg = err instanceof Error ? err.message : String(err);
  fail('INTERNAL', msg);
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = createProgram();
  try {
    await program.parseAsync(argv);
  } catch (err: unknown) {
    if (err instanceof CommanderError) {
      if (
        err.code === 'commander.helpDisplayed' ||
        err.code === 'commander.version'
      ) {
        process.exit(0);
      }
      fail('INVALID_ARGUMENT', err.message);
    }
    handleActionError(err);
  }
}

if (require.main === module) {
  main().catch((err) => {
    handleActionError(err);
  });
}
