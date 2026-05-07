import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { z } from 'zod';
import type { DB } from './db.js';

export const LEAD_COLUMNS = [
  'name',
  'email',
  'company',
  'role',
  'hook_url',
  'hook_text',
  'notes',
] as const;

const LeadRow = z.object({
  name: z.string().trim().min(1, 'name is required'),
  email: z.string().trim().toLowerCase().email('invalid email'),
  company: z.string().trim().optional(),
  role: z.string().trim().optional(),
  hook_url: z
    .string()
    .trim()
    .url('invalid hook_url')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  hook_text: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export type Lead = z.infer<typeof LeadRow>;

export interface LeadRecord extends Lead {
  id: number;
  status: string;
  campaign_id: number | null;
  hook_extracted: string | null;
  created_at: number;
  updated_at: number;
}

export interface ParseResult {
  rows: Lead[];
  errors: Array<{ line: number; message: string }>;
}

/**
 * Parse a CSV string into validated lead rows. Errors are collected per-row
 * with the source line number so the user can fix and retry.
 */
export function parseLeadsCsv(input: string): ParseResult {
  const text = input.codePointAt(0) === 0xfeff ? input.slice(1) : input;

  let raw: Record<string, string>[];
  try {
    raw = parse(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    }) as Record<string, string>[];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      rows: [],
      errors: [{ line: 0, message: `CSV parse failed: ${message}` }],
    };
  }

  const rows: Lead[] = [];
  const errors: Array<{ line: number; message: string }> = [];

  for (let i = 0; i < raw.length; i++) {
    const line = i + 2;
    const r = raw[i];
    if (!r) continue;

    const cleaned: Record<string, string | undefined> = {};
    for (const k of LEAD_COLUMNS) {
      const v = r[k];
      cleaned[k] = v === undefined || v === '' ? undefined : v;
    }

    const parsed = LeadRow.safeParse(cleaned);
    if (parsed.success) {
      rows.push(parsed.data);
    } else {
      const msg = parsed.error.issues
        .map((iss) => `${iss.path.join('.') || '<row>'}: ${iss.message}`)
        .join('; ');
      errors.push({ line, message: msg });
    }
  }

  return { rows, errors };
}

export interface InsertResult {
  inserted: number;
  duplicates: number;
}

/**
 * Insert leads, deduping by email (existing rows untouched).
 * Returns counts so the CLI can report what happened.
 */
export function insertLeads(db: DB, leads: Lead[]): InsertResult {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO leads
      (email, name, company, role, hook_url, hook_text, notes, status, created_at, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, 'imported', ?, ?)
  `);

  let inserted = 0;
  const now = Date.now();
  db.exec('BEGIN');
  try {
    for (const lead of leads) {
      const result = stmt.run(
        lead.email,
        lead.name,
        lead.company ?? null,
        lead.role ?? null,
        lead.hook_url ?? null,
        lead.hook_text ?? null,
        lead.notes ?? null,
        now,
        now,
      );
      if (result.changes > 0) inserted += 1;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { inserted, duplicates: leads.length - inserted };
}

export interface ListLeadsOptions {
  status?: string;
  limit?: number;
}

export function listLeads(db: DB, opts: ListLeadsOptions = {}): LeadRecord[] {
  const where = opts.status ? 'WHERE status = ?' : '';
  const limit = opts.limit ? `LIMIT ${Math.max(1, Math.floor(opts.limit))}` : '';
  const sql = `SELECT * FROM leads ${where} ORDER BY id DESC ${limit}`;
  const stmt = db.prepare(sql);
  const rows = (opts.status ? stmt.all(opts.status) : stmt.all()) as unknown as LeadRecord[];
  return rows;
}

export function exportLeadsToCsv(db: DB): string {
  const rows = listLeads(db);
  const records = rows.map((r) => ({
    name: r.name,
    email: r.email,
    company: r.company ?? '',
    role: r.role ?? '',
    hook_url: r.hook_url ?? '',
    hook_text: r.hook_text ?? '',
    notes: r.notes ?? '',
    status: r.status,
  }));
  return stringify(records, { header: true });
}
