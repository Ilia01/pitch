#!/usr/bin/env node
import { Command } from 'commander';
import { campaignCommand } from './cli/campaign.js';
import { editCommand } from './cli/edit.js';
import { generateCommand } from './cli/generate.js';
import { runInit } from './cli/init.js';
import { leadsCommand } from './cli/leads.js';
import { previewCommand } from './cli/preview.js';
import { templateCommand } from './cli/template.js';
import { CampaignError } from './core/campaigns.js';
import { TemplateError } from './core/templates.js';
import { ConfigError } from './lib/config.js';
import { log } from './lib/log.js';
import { AllProvidersFailedError } from './providers/types.js';

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
program.addCommand(campaignCommand);
program.addCommand(generateCommand);
program.addCommand(previewCommand);
program.addCommand(editCommand);

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
    if (err instanceof CampaignError) {
      log.error(err.message);
      process.exit(4);
    }
    if (err instanceof AllProvidersFailedError) {
      log.error(
        { providers: err.errors.map((e) => ({ provider: e.provider, error: e.message })) },
        err.message,
      );
      process.exit(5);
    }
    // Sanitize: log only message + class, never the full error object —
    // SDK errors can carry response headers / cause chains we don't want
    // serialized via pino's default behavior.
    const message = err instanceof Error ? err.message : String(err);
    const errName = err instanceof Error ? err.name : 'unknown';
    log.error({ err: { name: errName, message } }, 'unhandled error');
    process.exit(1);
  }
}

void main();
