#!/usr/bin/env node
import { Command } from 'commander';
import { runInit } from './cli/init.js';
import { leadsCommand } from './cli/leads.js';
import { templateCommand } from './cli/template.js';
import { TemplateError } from './core/templates.js';
import { ConfigError } from './lib/config.js';
import { log } from './lib/log.js';

const program = new Command();

program
  .name('pitch')
  .description('CLI for sending small-batch, personalized cold emails')
  .version('0.1.0-alpha.0');

program
  .command('init')
  .description('Scaffold a pitch workspace in the current directory')
  .action(() => {
    runInit();
  });

program.addCommand(leadsCommand);
program.addCommand(templateCommand);

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof ConfigError) {
      log.error(err.message);
      process.exit(2);
    }
    if (err instanceof TemplateError) {
      log.error(err.message);
      process.exit(3);
    }
    log.error({ err }, 'unhandled error');
    process.exit(1);
  }
}

void main();
