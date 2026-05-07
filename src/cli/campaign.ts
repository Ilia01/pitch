import { resolve } from 'node:path';
import { Command } from 'commander';
import { CampaignError, createCampaign, listCampaigns } from '../core/campaigns.js';
import { openDb } from '../core/db.js';
import { log } from '../lib/log.js';

function dbPath(): string {
  return resolve(process.cwd(), 'pitch.db');
}

export const campaignCommand = new Command('campaign').description('Manage campaigns');

campaignCommand
  .command('create <name>')
  .description('Create a new campaign bound to a template')
  .requiredOption('-t, --template <name>', 'template name to use for this campaign')
  .action((name: string, opts: { template: string }) => {
    const db = openDb({ path: dbPath() });
    try {
      const c = createCampaign(db, { name, templateName: opts.template });
      log.info({ id: c.id, name: c.name, template_id: c.template_id }, 'campaign created');
    } finally {
      db.close();
    }
  });

campaignCommand
  .command('list')
  .description('List campaigns')
  .action(() => {
    const db = openDb({ path: dbPath() });
    try {
      const rows = listCampaigns(db);
      if (rows.length === 0) {
        process.stdout.write('no campaigns\n');
        return;
      }
      const widths = {
        id: Math.max(2, ...rows.map((r) => String(r.id).length)),
        name: Math.max(4, ...rows.map((r) => r.name.length)),
        status: Math.max(6, ...rows.map((r) => r.status.length)),
      };
      process.stdout.write(
        `${'id'.padEnd(widths.id)}  ${'name'.padEnd(widths.name)}  ${'status'.padEnd(widths.status)}  template_id\n`,
      );
      for (const r of rows) {
        process.stdout.write(
          `${String(r.id).padEnd(widths.id)}  ${r.name.padEnd(widths.name)}  ${r.status.padEnd(widths.status)}  ${r.template_id ?? '-'}\n`,
        );
      }
    } finally {
      db.close();
    }
  });

export { CampaignError };
