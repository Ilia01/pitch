import type { DB } from './db.js';
import { type TemplateRecord, getTemplateByName } from './templates.js';

export interface CampaignRecord {
  id: number;
  name: string;
  template_id: number | null;
  status: string;
  created_at: number;
}

export class CampaignError extends Error {
  override readonly name = 'CampaignError';
}

export interface CreateCampaignOptions {
  name: string;
  templateName: string;
}

export function createCampaign(db: DB, opts: CreateCampaignOptions): CampaignRecord {
  const tmpl = getTemplateByName(db, opts.templateName);
  if (!tmpl) {
    throw new CampaignError(`template not found: ${opts.templateName}`);
  }
  const existing = db.prepare('SELECT id FROM campaigns WHERE name = ?').get(opts.name) as
    | { id: number }
    | undefined;
  if (existing) {
    throw new CampaignError(`campaign already exists: ${opts.name}`);
  }
  const now = Date.now();
  const result = db
    .prepare('INSERT INTO campaigns (name, template_id, status, created_at) VALUES (?, ?, ?, ?)')
    .run(opts.name, tmpl.id, 'active', now);

  return {
    id: Number(result.lastInsertRowid),
    name: opts.name,
    template_id: tmpl.id,
    status: 'active',
    created_at: now,
  };
}

export function listCampaigns(db: DB): CampaignRecord[] {
  return db
    .prepare('SELECT id, name, template_id, status, created_at FROM campaigns ORDER BY id DESC')
    .all() as unknown as CampaignRecord[];
}

export function getCampaignByName(db: DB, name: string): CampaignRecord | undefined {
  return db
    .prepare('SELECT id, name, template_id, status, created_at FROM campaigns WHERE name = ?')
    .get(name) as unknown as CampaignRecord | undefined;
}

export function getCampaignTemplate(db: DB, campaign: CampaignRecord): TemplateRecord {
  if (campaign.template_id === null) {
    throw new CampaignError(`campaign ${campaign.name} has no template`);
  }
  const tmpl = db
    .prepare('SELECT id, name, subject, body_md, created_at FROM templates WHERE id = ?')
    .get(campaign.template_id) as unknown as TemplateRecord | undefined;
  if (!tmpl) {
    throw new CampaignError(`template id ${campaign.template_id} not found`);
  }
  return tmpl;
}
