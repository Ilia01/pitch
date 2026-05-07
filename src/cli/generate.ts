import { resolve } from 'node:path';
import { Command } from 'commander';
import { CampaignError, getCampaignByName } from '../core/campaigns.js';
import { openDb } from '../core/db.js';
import { attachUnassignedLeads, runGeneration } from '../core/generator.js';
import { loadEnv } from '../lib/config.js';
import { log } from '../lib/log.js';
import { buildChain } from '../providers/factory.js';

function dbPath(): string {
  return resolve(process.cwd(), 'pitch.db');
}

export const generateCommand = new Command('generate')
  .description('Generate personalized drafts for a campaign')
  .argument('<campaign>', 'campaign name')
  .option('-n, --limit <n>', 'process at most N leads', (v) => Number.parseInt(v, 10))
  .option('-f, --force', 'regenerate even when a non-edited draft exists', false)
  .option('--no-attach', 'skip attaching unassigned leads to this campaign')
  .action(
    async (
      name: string,
      opts: { limit?: number; force?: boolean; attach?: boolean },
    ): Promise<void> => {
      const env = loadEnv();
      const providers = buildChain({ env });
      log.info({ providers: providers.map((p) => p.name) }, 'provider chain ready');

      const db = openDb({ path: dbPath() });
      try {
        const campaign = getCampaignByName(db, name);
        if (!campaign) {
          throw new CampaignError(`campaign not found: ${name}`);
        }
        if (opts.attach !== false) {
          const attached = attachUnassignedLeads(db, campaign.id);
          if (attached > 0) log.info({ attached }, 'attached unassigned leads to campaign');
        }
        const stats = await runGeneration(db, {
          campaign,
          providers,
          limit: opts.limit,
          force: opts.force,
        });
        log.info(stats, 'generation complete');
      } finally {
        db.close();
      }
    },
  );
