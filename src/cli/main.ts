import { Command, CommanderError } from 'commander';
import { emit, fail, CliError } from './output';
import { COMMAND_DEFINITIONS, runDescribe } from './definitions';

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
