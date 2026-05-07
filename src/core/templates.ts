import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { DB } from './db.js';

const TemplateInput = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-_]*$/i, 'name must be alphanumeric (with - or _)'),
  subject: z.string().trim().min(1, 'subject is required'),
  body_md: z.string().min(1, 'body cannot be empty'),
});

export type TemplateInput = z.infer<typeof TemplateInput>;

export interface TemplateRecord extends TemplateInput {
  id: number;
  created_at: number;
}

export class TemplateError extends Error {
  override readonly name = 'TemplateError';
}

export interface AddTemplateOptions {
  name: string;
  subject: string;
  /** Path to a markdown file containing the body. */
  bodyPath: string;
}

export function addTemplate(db: DB, opts: AddTemplateOptions): TemplateRecord {
  let body_md: string;
  try {
    body_md = readFileSync(opts.bodyPath, 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new TemplateError(`could not read body file ${opts.bodyPath}: ${message}`);
  }

  const parsed = TemplateInput.safeParse({
    name: opts.name,
    subject: opts.subject,
    body_md,
  });
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((iss) => `${iss.path.join('.') || '<input>'}: ${iss.message}`)
      .join('; ');
    throw new TemplateError(msg);
  }

  const existing = db.prepare('SELECT id FROM templates WHERE name = ?').get(parsed.data.name) as
    | { id: number }
    | undefined;
  if (existing) {
    throw new TemplateError(`template "${parsed.data.name}" already exists (id=${existing.id})`);
  }

  const now = Date.now();
  const result = db
    .prepare('INSERT INTO templates (name, subject, body_md, created_at) VALUES (?, ?, ?, ?)')
    .run(parsed.data.name, parsed.data.subject, parsed.data.body_md, now);

  return {
    id: Number(result.lastInsertRowid),
    name: parsed.data.name,
    subject: parsed.data.subject,
    body_md: parsed.data.body_md,
    created_at: now,
  };
}

export function listTemplates(db: DB): TemplateRecord[] {
  return db
    .prepare('SELECT id, name, subject, body_md, created_at FROM templates ORDER BY id DESC')
    .all() as unknown as TemplateRecord[];
}

export function getTemplateByName(db: DB, name: string): TemplateRecord | undefined {
  return db
    .prepare('SELECT id, name, subject, body_md, created_at FROM templates WHERE name = ?')
    .get(name) as TemplateRecord | undefined;
}
