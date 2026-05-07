import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/core/db.js';

const MIGRATIONS_DIR = resolve(__dirname, '../migrations');

describe('openDb', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pitch-db-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates schema and records the migration on first open', () => {
    const db = openDb({ path: join(dir, 'pitch.db'), migrationsDir: MIGRATIONS_DIR });

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);

    expect(tables).toEqual(
      expect.arrayContaining([
        '_migrations',
        'campaigns',
        'drafts',
        'events',
        'leads',
        'templates',
      ]),
    );

    const migrations = db.prepare('SELECT name FROM _migrations').all() as { name: string }[];
    expect(migrations.map((m) => m.name)).toContain('001_init.sql');

    db.close();
  });

  it('is idempotent on re-open', () => {
    const path = join(dir, 'pitch.db');
    openDb({ path, migrationsDir: MIGRATIONS_DIR }).close();
    const db = openDb({ path, migrationsDir: MIGRATIONS_DIR });

    const count = db.prepare('SELECT COUNT(*) AS n FROM _migrations').get() as { n: number };
    expect(count.n).toBe(1);

    db.close();
  });

  it('enforces foreign keys', () => {
    const db = openDb({ path: join(dir, 'pitch.db'), migrationsDir: MIGRATIONS_DIR });
    const row = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number } | undefined;
    expect(row?.foreign_keys).toBe(1);
    db.close();
  });
});
