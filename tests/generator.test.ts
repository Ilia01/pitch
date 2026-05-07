import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCampaign, getCampaignByName } from '../src/core/campaigns.js';
import { openDb } from '../src/core/db.js';
import { listDraftsForCampaign, upsertDraft } from '../src/core/drafts.js';
import { runGeneration } from '../src/core/generator.js';
import { insertLeads } from '../src/core/leads.js';
import { addTemplate } from '../src/core/templates.js';
import type { GenerationInput, GenerationOutput, LLMProvider } from '../src/providers/types.js';

const MIGRATIONS_DIR = resolve(__dirname, '../migrations');

function fakeProvider(text = 'Saw your post on connection pooling — sharp take.'): LLMProvider {
  return {
    name: 'fake',
    async generate(_input: GenerationInput): Promise<GenerationOutput> {
      return { text, provider: 'fake', latencyMs: 1 };
    },
  };
}

describe('runGeneration', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pitch-gen-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function setup() {
    const db = openDb({ path: join(dir, 'pitch.db'), migrationsDir: MIGRATIONS_DIR });
    const bodyPath = join(dir, 'body.md');
    writeFileSync(bodyPath, 'Hi {{first_name}},\n\n{{hook}}\n\n— Ilia');
    addTemplate(db, { name: 'intro', subject: 'Hi {{first_name}}', bodyPath });
    const campaign = createCampaign(db, { name: 'jobs', templateName: 'intro' });
    insertLeads(db, [
      {
        name: 'Alice Cooper',
        email: 'alice@acme.com',
        company: 'Acme',
        role: 'VP Eng',
        hook_text: 'recent post',
      },
      {
        name: 'Bob Dylan',
        email: 'bob@example.com',
        company: 'Example',
        role: 'CTO',
        hook_text: 'another post',
      },
    ]);
    db.prepare('UPDATE leads SET campaign_id = ? WHERE campaign_id IS NULL').run(campaign.id);
    return { db, campaign };
  }

  it('generates one draft per lead in the campaign', async () => {
    const { db, campaign } = setup();
    const stats = await runGeneration(db, { campaign, providers: [fakeProvider()] });
    expect(stats.considered).toBe(2);
    expect(stats.generated).toBe(2);
    expect(stats.failed).toBe(0);

    const drafts = listDraftsForCampaign(db, campaign.id);
    expect(drafts).toHaveLength(2);
    expect(drafts[0]?.subject).toMatch(/Hi (Alice|Bob)/);
    expect(drafts[0]?.body).toContain('connection pooling');
    db.close();
  });

  it('skips drafts that have been edited (without --force)', async () => {
    const { db, campaign } = setup();
    await runGeneration(db, { campaign, providers: [fakeProvider('first version')] });
    // Mark one draft as edited
    const drafts = listDraftsForCampaign(db, campaign.id);
    const targetId = drafts[0]?.id ?? 0;
    db.prepare('UPDATE drafts SET edited = 1 WHERE id = ?').run(targetId);

    const stats = await runGeneration(db, {
      campaign,
      providers: [fakeProvider('second version')],
    });
    expect(stats.skippedEdited).toBeGreaterThanOrEqual(1);

    const after = listDraftsForCampaign(db, campaign.id);
    const edited = after.find((d) => d.id === targetId);
    expect(edited?.body).toContain('first version');
    db.close();
  });

  it('overwrites edited drafts when --force is set', async () => {
    const { db, campaign } = setup();
    await runGeneration(db, { campaign, providers: [fakeProvider('first version')] });
    const drafts = listDraftsForCampaign(db, campaign.id);
    const targetId = drafts[0]?.id ?? 0;
    db.prepare('UPDATE drafts SET edited = 1 WHERE id = ?').run(targetId);

    const stats = await runGeneration(db, {
      campaign,
      providers: [fakeProvider('forced version')],
      force: true,
    });
    expect(stats.skippedEdited).toBe(0);
    expect(stats.generated).toBe(2);

    const after = listDraftsForCampaign(db, campaign.id);
    const overwritten = after.find((d) => d.id === targetId);
    expect(overwritten?.body).toContain('forced version');
    expect(overwritten?.edited).toBe(0);
    db.close();
  });

  it('records a generated event per lead', async () => {
    const { db, campaign } = setup();
    await runGeneration(db, { campaign, providers: [fakeProvider()] });
    const events = db
      .prepare('SELECT type, provider FROM events WHERE campaign_id = ? AND type = ?')
      .all(campaign.id, 'generated');
    expect(events).toHaveLength(2);
    db.close();
  });

  it('promotes leads to drafted status', async () => {
    const { db, campaign } = setup();
    await runGeneration(db, { campaign, providers: [fakeProvider()] });
    const statuses = db
      .prepare('SELECT status FROM leads WHERE campaign_id = ?')
      .all(campaign.id) as { status: string }[];
    expect(statuses.every((s) => s.status === 'drafted')).toBe(true);
    db.close();
  });

  it('honors --limit', async () => {
    const { db, campaign } = setup();
    const stats = await runGeneration(db, {
      campaign,
      providers: [fakeProvider()],
      limit: 1,
    });
    expect(stats.considered).toBe(1);
    expect(stats.generated).toBe(1);
    db.close();
  });

  it('captures errors per lead without aborting the run', async () => {
    const { db, campaign } = setup();
    const flaky: LLMProvider = {
      name: 'flaky',
      async generate(): Promise<GenerationOutput> {
        throw new Error('simulated failure');
      },
    };
    const stats = await runGeneration(db, { campaign, providers: [flaky] });
    expect(stats.considered).toBe(2);
    expect(stats.failed).toBe(2);
    expect(stats.generated).toBe(0);
    expect(stats.errors).toHaveLength(2);
    db.close();
  });
});

describe('verify campaign + drafts upsert directly', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pitch-gen2-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('upsertDraft inserts then updates the same lead+campaign pair', () => {
    const db = openDb({ path: join(dir, 'pitch.db'), migrationsDir: MIGRATIONS_DIR });
    const bodyPath = join(dir, 'body.md');
    writeFileSync(bodyPath, 'body');
    addTemplate(db, { name: 'intro', subject: 'Hi', bodyPath });
    const campaign = createCampaign(db, { name: 'jobs', templateName: 'intro' });
    insertLeads(db, [{ name: 'Alice', email: 'alice@acme.com' }]);
    const lead = db.prepare('SELECT id FROM leads WHERE email = ?').get('alice@acme.com') as {
      id: number;
    };

    const r1 = upsertDraft(db, {
      lead_id: lead.id,
      campaign_id: campaign.id,
      subject: 'Hi',
      body: 'first',
      body_md: 'first',
      provider: 'p',
    });
    expect(r1).toBe('inserted');

    const r2 = upsertDraft(db, {
      lead_id: lead.id,
      campaign_id: campaign.id,
      subject: 'Hi',
      body: 'second',
      body_md: 'second',
      provider: 'p',
    });
    expect(r2).toBe('updated');

    const c = getCampaignByName(db, 'jobs');
    expect(c?.id).toBe(campaign.id);
    db.close();
  });
});
