import { Command, CommanderError } from 'commander';
import { emit, fail, CliError } from './output';
import { COMMAND_DEFINITIONS, runDescribe } from './definitions';

const KNOWN_COMMANDS = new Set(COMMAND_DEFINITIONS.map((d) => d.name));

export function normalizeArgv(argv: string[]): string[] {
  const flags = ['--roots', '--ignore', '--extra-ignore'];
  for (const flag of flags) {
    const idx = argv.indexOf(flag);
    if (idx !== -1) {
      for (let i = idx + 1; i < argv.length; i++) {
        if (KNOWN_COMMANDS.has(argv[i])) {
          const cmd = argv[i];
          const newArgv = [...argv];
          newArgv.splice(i, 1);
          newArgv.splice(idx, 0, cmd);
          return normalizeArgv(newArgv);
        }
      }
    }
  }
  return argv;
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('ai-swissknife')
    .description('Cross-assistant AI artifact manager CLI')
    .version('0.4.0')
    .option(
      '--workspace <path>',
      'Workspace root folder path (used for Workspace scope; ignored when --roots is used)'
    )
    .option('--home <path>', 'User home directory path (used for Global scope)')
    .option(
      '--assistants <ids>',
      'Comma-separated active assistant ids (e.g. claude-code,kilo-code)'
    )
    .option(
      '--roots <dirs...>',
      'Workspace root directories to scan (repeatable; overrides --workspace)'
    )
    .option(
      '--max-depth <n>',
      'Maximum directory search depth for workspaces (default: 4)'
    )
    .option(
      '--ignore <names...>',
      'Directory names to ignore (replaces defaults)'
    )
    .option(
      '--extra-ignore <names...>',
      'Additional directory names to ignore (adds to defaults)'
    )
    .exitOverride();

  for (const def of COMMAND_DEFINITIONS) {
    const cmd = program.command(def.name);
    cmd.description(def.description);

    if (def.arguments) {
      for (const arg of def.arguments) {
        cmd.argument(
          arg.required ? `<${arg.name}>` : `[${arg.name}]`,
          arg.description || ''
        );
      }
    }

    if (def.options) {
      for (const opt of def.options) {
        if (opt.required) {
          cmd.requiredOption(opt.flags, opt.description);
        } else {
          cmd.option(opt.flags, opt.description);
        }
      }
    }

    if (def.examples && def.examples.length > 0) {
      cmd.addHelpText(
        'after',
        '\nExample:\n' + def.examples.map((e) => `  $ ${e}`).join('\n')
      );
    }

    cmd.action(async (...actionArgs: any[]) => {
      try {
        const globalOpts = program.opts();
        const cmdArgs: Record<string, any> = {};
        let cmdOpts: Record<string, any> = {};
        if (def.arguments && def.arguments.length > 0) {
          for (let i = 0; i < def.arguments.length; i++) {
            cmdArgs[def.arguments[i].name] = actionArgs[i];
          }
          cmdOpts = actionArgs[def.arguments.length] || {};
        } else {
          cmdOpts = actionArgs[0] || {};
        }
        const result = await def.run(
          { ...globalOpts, ...cmdOpts, ...cmdArgs },
          globalOpts
        );
        emit(result);
      } catch (err: unknown) {
        handleActionError(err);
      }
    });
  }

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
  if (
    argv.includes('--json') &&
    (argv.includes('--help') || argv.includes('-h'))
  ) {
    emit(runDescribe());
    return;
  }
  const program = createProgram();
  const normalizedArgv = normalizeArgv(argv);
  try {
    await program.parseAsync(normalizedArgv);
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
