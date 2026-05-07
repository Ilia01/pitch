import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { log } from '../lib/log.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATIONS_DIR = resolve(here, '../../migrations');

export type DB = DatabaseSync;

export interface OpenDbOptions {
  path: string;
  /** Override for tests. */
  migrationsDir?: string;
}

export function openDb({ path, migrationsDir = DEFAULT_MIGRATIONS_DIR }: OpenDbOptions): DB {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  applyMigrations(db, migrationsDir);
  return db;
}

function applyMigrations(db: DB, dir: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name        TEXT PRIMARY KEY,
      applied_at  INTEGER NOT NULL
    );
  `);

  const applied = new Set(
    db
      .prepare('SELECT name FROM _migrations')
      .all()
      .map((r) => (r as { name: string }).name),
  );

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const insert = db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)');

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(dir, file), 'utf-8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      insert.run(file, Date.now());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    log.info({ migration: file }, 'applied migration');
  }
}
