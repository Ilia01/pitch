import type { DB } from './db.js';

export interface DraftRecord {
  id: number;
  lead_id: number;
  campaign_id: number;
  subject: string;
  body: string;
  body_md: string;
  provider: string;
  edited: number;
  created_at: number;
  updated_at: number;
}

export interface UpsertDraftInput {
  lead_id: number;
  campaign_id: number;
  subject: string;
  body: string;
  body_md: string;
  provider: string;
  /** When true, overwrite even if the existing draft was edited. */
  force?: boolean;
}

export type UpsertOutcome = 'inserted' | 'updated' | 'skipped-edited';

/**
 * Create a draft if none exists for (lead, campaign). If one exists:
 *   - and NOT edited → overwrite, return 'updated'
 *   - and edited, force=false → leave alone, return 'skipped-edited'
 *   - and edited, force=true → overwrite (resets edited to 0), return 'updated'
 */
export function upsertDraft(db: DB, input: UpsertDraftInput): UpsertOutcome {
  const existing = db
    .prepare('SELECT id, edited FROM drafts WHERE lead_id = ? AND campaign_id = ?')
    .get(input.lead_id, input.campaign_id) as { id: number; edited: number } | undefined;

  const now = Date.now();
  if (!existing) {
    db.prepare(
      `INSERT INTO drafts
         (lead_id, campaign_id, subject, body, body_md, provider, edited, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).run(
      input.lead_id,
      input.campaign_id,
      input.subject,
      input.body,
      input.body_md,
      input.provider,
      now,
      now,
    );
    return 'inserted';
  }

  if (existing.edited === 1 && !input.force) return 'skipped-edited';

  db.prepare(
    `UPDATE drafts
       SET subject = ?, body = ?, body_md = ?, provider = ?, edited = 0, updated_at = ?
       WHERE id = ?`,
  ).run(input.subject, input.body, input.body_md, input.provider, now, existing.id);
  return 'updated';
}

export interface DraftWithLead extends DraftRecord {
  lead_name: string;
  lead_email: string;
}

export function listDraftsForCampaign(db: DB, campaignId: number): DraftWithLead[] {
  return db
    .prepare(
      `SELECT d.*, l.name AS lead_name, l.email AS lead_email
       FROM drafts d
       JOIN leads l ON l.id = d.lead_id
       WHERE d.campaign_id = ?
       ORDER BY d.id DESC`,
    )
    .all(campaignId) as unknown as DraftWithLead[];
}

export function getDraftById(db: DB, id: number): DraftWithLead | undefined {
  return db
    .prepare(
      `SELECT d.*, l.name AS lead_name, l.email AS lead_email
       FROM drafts d
       JOIN leads l ON l.id = d.lead_id
       WHERE d.id = ?`,
    )
    .get(id) as unknown as DraftWithLead | undefined;
}

export function updateDraftBody(db: DB, id: number, body_md: string, body: string): void {
  db.prepare(
    'UPDATE drafts SET body_md = ?, body = ?, edited = 1, updated_at = ? WHERE id = ?',
  ).run(body_md, body, Date.now(), id);
}
