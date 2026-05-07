import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/core/db.js';
import { exportLeadsToCsv, insertLeads, listLeads, parseLeadsCsv } from '../src/core/leads.js';

const MIGRATIONS_DIR = resolve(__dirname, '../migrations');

describe('parseLeadsCsv', () => {
  it('parses a clean CSV', () => {
    const csv = [
      'name,email,company,role,hook_url,hook_text,notes',
      'Alice,alice@acme.com,Acme,VP Eng,https://acme.com/blog/post,,met at conf',
      'Bob,bob@example.com,Example,CTO,,recent linkedin post text,',
    ].join('\n');
    const { rows, errors } = parseLeadsCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.email).toBe('alice@acme.com');
    expect(rows[0]?.hook_url).toBe('https://acme.com/blog/post');
    expect(rows[1]?.hook_text).toBe('recent linkedin post text');
  });

  it('lowercases email and trims whitespace', () => {
    const csv = ['name,email', 'Alice,  ALICE@ACME.COM  '].join('\n');
    const { rows } = parseLeadsCsv(csv);
    expect(rows[0]?.email).toBe('alice@acme.com');
  });

  it('strips a UTF-8 BOM', () => {
    const csv = '﻿name,email\nAlice,alice@acme.com\n';
    const { rows, errors } = parseLeadsCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
  });

  it('reports per-row errors with line numbers', () => {
    const csv = [
      'name,email',
      'Alice,not-an-email',
      ',bob@example.com',
      'Carol,carol@example.com',
    ].join('\n');
    const { rows, errors } = parseLeadsCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Carol');
    expect(errors).toHaveLength(2);
    expect(errors[0]?.line).toBe(2);
    expect(errors[1]?.line).toBe(3);
  });

  it('rejects invalid hook_url', () => {
    const csv = ['name,email,hook_url', 'Alice,alice@acme.com,not-a-url'].join('\n');
    const { errors } = parseLeadsCsv(csv);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/hook_url/);
  });

  it('treats empty hook_url as undefined', () => {
    const csv = ['name,email,hook_url', 'Alice,alice@acme.com,'].join('\n');
    const { rows, errors } = parseLeadsCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0]?.hook_url).toBeUndefined();
  });
});

describe('insertLeads + listLeads + exportLeadsToCsv', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pitch-leads-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('inserts new leads and dedupes by email', () => {
    const db = openDb({ path: join(dir, 'pitch.db'), migrationsDir: MIGRATIONS_DIR });
    const leads = [
      { name: 'Alice', email: 'alice@acme.com' },
      { name: 'Bob', email: 'bob@example.com' },
    ];
    const r1 = insertLeads(db, leads);
    expect(r1).toEqual({ inserted: 2, duplicates: 0 });

    const r2 = insertLeads(db, [
      { name: 'Alice2', email: 'alice@acme.com' },
      { name: 'Carol', email: 'carol@example.com' },
    ]);
    expect(r2).toEqual({ inserted: 1, duplicates: 1 });

    const all = listLeads(db);
    expect(all).toHaveLength(3);

    db.close();
  });

  it('exports leads as CSV with header row', () => {
    const db = openDb({ path: join(dir, 'pitch.db'), migrationsDir: MIGRATIONS_DIR });
    insertLeads(db, [{ name: 'Alice', email: 'alice@acme.com', company: 'Acme' }]);
    const csv = exportLeadsToCsv(db);
    expect(csv).toMatch(/^name,email,company/);
    expect(csv).toMatch(/Alice,alice@acme\.com,Acme/);
    db.close();
  });

  it('lists by status', () => {
    const db = openDb({ path: join(dir, 'pitch.db'), migrationsDir: MIGRATIONS_DIR });
    insertLeads(db, [
      { name: 'Alice', email: 'alice@acme.com' },
      { name: 'Bob', email: 'bob@example.com' },
    ]);
    expect(listLeads(db, { status: 'imported' })).toHaveLength(2);
    expect(listLeads(db, { status: 'sent' })).toHaveLength(0);
    db.close();
  });
});
