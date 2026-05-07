import { resolve } from 'node:path';
import { Command } from 'commander';
import { CampaignError, getCampaignByName } from '../core/campaigns.js';
import { openDb } from '../core/db.js';
import { listDraftsForCampaign } from '../core/drafts.js';

function dbPath(): string {
  return resolve(process.cwd(), 'pitch.db');
}

export const previewCommand = new Command('preview')
  .description('Print drafts in a campaign to stdout')
  .argument('<campaign>', 'campaign name')
  .option('-n, --limit <n>', 'show at most N drafts', (v) => Number.parseInt(v, 10))
  .action((name: string, opts: { limit?: number }) => {
    const db = openDb({ path: dbPath() });
    try {
      const campaign = getCampaignByName(db, name);
      if (!campaign) throw new CampaignError(`campaign not found: ${name}`);

      const drafts = listDraftsForCampaign(db, campaign.id);
      const slice = opts.limit ? drafts.slice(0, Math.max(1, Math.floor(opts.limit))) : drafts;

      if (slice.length === 0) {
        process.stdout.write('no drafts\n');
        return;
      }

      const w = process.stdout;
      const rule = '────────────────────────────────────────────────────────────';
      for (const d of slice) {
        const edited = d.edited === 1 ? ' [edited]' : '';
        w.write(
          `\n${rule}\ndraft #${d.id}  →  ${d.lead_name} <${d.lead_email}>${edited}\nprovider: ${d.provider}\nsubject:  ${d.subject}\n\n${d.body}\n`,
        );
      }
      w.write(`${rule}\n${slice.length} of ${drafts.length} drafts\n`);
    } finally {
      db.close();
    }
  });
