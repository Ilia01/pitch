-- Pitch v0.1 initial schema.
-- Lead lifecycle: imported -> enriched -> drafted -> sent -> {opened|replied|bounced} -> done
-- Status transitions live in the per-domain core modules (leads, drafts, generator).

CREATE TABLE IF NOT EXISTS leads (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  company         TEXT,
  role            TEXT,
  hook_url        TEXT,
  hook_text       TEXT,
  hook_extracted  TEXT,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'imported',
  campaign_id     INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leads_status      ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_campaign_id ON leads(campaign_id);

CREATE TABLE IF NOT EXISTS templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  subject     TEXT NOT NULL,
  body_md     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL UNIQUE,
  template_id  INTEGER REFERENCES templates(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS drafts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id      INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  campaign_id  INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  subject      TEXT NOT NULL,
  body         TEXT NOT NULL,
  body_md      TEXT NOT NULL,
  provider     TEXT NOT NULL,
  edited       INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE (lead_id, campaign_id)
);

CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id      INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  campaign_id  INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  provider     TEXT,
  meta_json    TEXT,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_lead_id            ON events(lead_id);
CREATE INDEX IF NOT EXISTS idx_events_campaign_id_type   ON events(campaign_id, type);
