import { log } from '../lib/log.js';
import { type ChainOptions, runChain } from '../providers/llm.js';
import type { LLMProvider } from '../providers/types.js';
import { type CampaignRecord, getCampaignTemplate } from './campaigns.js';
import type { DB } from './db.js';
import { upsertDraft } from './drafts.js';
import type { LeadRecord } from './leads.js';
import {
  PERSONALIZATION_SYSTEM,
  type PromptContext,
  buildUserPrompt,
  clipHook,
} from './prompts.js';
import { fetchAndExtract } from './readability.js';
import { renderTemplate } from './render.js';
import type { TemplateRecord } from './templates.js';

export interface GenerateOptions {
  campaign: CampaignRecord;
  providers: LLMProvider[];
  /** Override fetch for tests. */
  fetchImpl?: typeof fetch;
  /** Re-generate even if a non-edited draft exists. Default false. */
  force?: boolean;
  /** Hard cap on number of leads processed in this run. */
  limit?: number;
  chainOptions?: ChainOptions;
}

export interface GenerationStats {
  considered: number;
  enriched: number;
  generated: number;
  skippedEdited: number;
  failed: number;
  errors: Array<{ leadId: number; error: string }>;
}

export async function runGeneration(db: DB, opts: GenerateOptions): Promise<GenerationStats> {
  const template = getCampaignTemplate(db, opts.campaign);
  const leads = pickLeads(db, opts.campaign.id, opts.limit);

  const stats: GenerationStats = {
    considered: leads.length,
    enriched: 0,
    generated: 0,
    skippedEdited: 0,
    failed: 0,
    errors: [],
  };

  for (const lead of leads) {
    try {
      const hook = await ensureHook(db, lead, opts.fetchImpl);
      if (hook?.justFetched) stats.enriched += 1;

      const opener = await generateOpener(opts.providers, lead, hook?.text, opts.chainOptions);

      const renderedBody = renderBody(template, lead, opener.text);
      const renderedSubject = renderTemplate(template.subject, leadVars(lead, opener.text));

      // Upsert + status promotion + event log in one txn so a crash mid-step
      // can't leave the DB in a state where the draft exists but the lead
      // wasn't promoted (or vice versa).
      let outcome: ReturnType<typeof upsertDraft>;
      db.exec('BEGIN');
      try {
        outcome = upsertDraft(db, {
          lead_id: lead.id,
          campaign_id: opts.campaign.id,
          subject: renderedSubject,
          body: renderedBody,
          body_md: renderedBody,
          provider: opener.provider,
          force: opts.force,
        });
        if (outcome !== 'skipped-edited') {
          promoteLead(db, lead.id, 'drafted');
        }
        logEvent(db, lead.id, opts.campaign.id, 'generated', opener.provider);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      if (outcome === 'skipped-edited') {
        stats.skippedEdited += 1;
      } else {
        stats.generated += 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      stats.failed += 1;
      stats.errors.push({ leadId: lead.id, error: message });
      logEvent(db, lead.id, opts.campaign.id, 'generate_failed', undefined, { error: message });
      log.warn({ leadId: lead.id, error: message }, 'generation failed for lead');
    }
  }

  return stats;
}

function pickLeads(db: DB, campaignId: number, limit?: number): LeadRecord[] {
  const cap = limit && limit > 0 ? `LIMIT ${Math.floor(limit)}` : '';
  // Leads attached to this campaign already, OR unattached leads in imported/enriched state.
  const rows = db
    .prepare(
      `SELECT * FROM leads
       WHERE campaign_id = ?
          OR (campaign_id IS NULL AND status IN ('imported', 'enriched'))
       ORDER BY id ASC ${cap}`,
    )
    .all(campaignId);
  return rows as unknown as LeadRecord[];
}

async function ensureHook(
  db: DB,
  lead: LeadRecord,
  fetchImpl?: typeof fetch,
): Promise<{ text: string; justFetched: boolean } | undefined> {
  // Manual hook_text wins over URL fetching.
  if (lead.hook_text && lead.hook_text.trim().length > 0) {
    return { text: clipHook(lead.hook_text), justFetched: false };
  }
  if (lead.hook_extracted && lead.hook_extracted.trim().length > 0) {
    return { text: clipHook(lead.hook_extracted), justFetched: false };
  }
  if (!lead.hook_url) return undefined;

  const result = await fetchAndExtract(lead.hook_url, { fetchImpl });
  if (!result.ok) {
    log.warn({ leadId: lead.id, url: lead.hook_url, reason: result.reason }, 'hook fetch failed');
    return undefined;
  }
  db.prepare('UPDATE leads SET hook_extracted = ?, status = ?, updated_at = ? WHERE id = ?').run(
    result.text,
    'enriched',
    Date.now(),
    lead.id,
  );
  return { text: clipHook(result.text), justFetched: true };
}

async function generateOpener(
  providers: LLMProvider[],
  lead: LeadRecord,
  hook: string | undefined,
  chainOptions: ChainOptions | undefined,
): Promise<{ text: string; provider: string }> {
  const ctx: PromptContext = {
    name: firstName(lead.name),
    email: lead.email,
    company: lead.company ?? undefined,
    role: lead.role ?? undefined,
    hook,
  };
  const out = await runChain(
    providers,
    {
      system: PERSONALIZATION_SYSTEM,
      user: buildUserPrompt(ctx),
      maxTokens: 400,
      temperature: 0.7,
    },
    chainOptions ?? {},
  );
  return { text: out.text, provider: out.provider };
}

function leadVars(lead: LeadRecord, hook: string): Record<string, string> {
  return {
    name: lead.name,
    first_name: firstName(lead.name),
    email: lead.email,
    company: lead.company ?? '',
    role: lead.role ?? '',
    hook,
  };
}

function renderBody(template: TemplateRecord, lead: LeadRecord, opener: string): string {
  return renderTemplate(template.body_md, leadVars(lead, opener));
}

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}

function promoteLead(db: DB, leadId: number, status: string): void {
  db.prepare('UPDATE leads SET status = ?, updated_at = ? WHERE id = ?').run(
    status,
    Date.now(),
    leadId,
  );
}

function logEvent(
  db: DB,
  leadId: number,
  campaignId: number,
  type: string,
  provider?: string,
  meta?: Record<string, unknown>,
): void {
  db.prepare(
    `INSERT INTO events (lead_id, campaign_id, type, provider, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(leadId, campaignId, type, provider ?? null, meta ? JSON.stringify(meta) : null, Date.now());
}

/**
 * Attach unattached leads (no campaign_id) to this campaign. Used when a
 * `pitch generate` is run and we want all imported leads tied to the run.
 */
export function attachUnassignedLeads(db: DB, campaignId: number): number {
  const result = db
    .prepare(
      `UPDATE leads SET campaign_id = ?, updated_at = ?
       WHERE campaign_id IS NULL AND status IN ('imported', 'enriched')`,
    )
    .run(campaignId, Date.now());
  return Number(result.changes);
}
