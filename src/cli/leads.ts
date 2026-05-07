import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { openDb } from '../core/db.js';
import { exportLeadsToCsv, insertLeads, listLeads, parseLeadsCsv } from '../core/leads.js';
import { log } from '../lib/log.js';

function dbPath(): string {
  return resolve(process.cwd(), 'pitch.db');
}

export const leadsCommand = new Command('leads').description('Manage leads in the workspace');

leadsCommand
  .command('add <file>')
  .description(
    'Import leads from a CSV file (cols: name,email,company,role,hook_url,hook_text,notes)',
  )
  .action((file: string) => {
    const path = resolve(process.cwd(), file);
    const text = readFileSync(path, 'utf-8');
    const { rows, errors } = parseLeadsCsv(text);

    if (errors.length > 0) {
      for (const e of errors) {
        log.warn({ line: e.line, error: e.message }, 'csv row rejected');
      }
    }

    if (rows.length === 0) {
      log.error({ errors: errors.length }, 'no valid rows to import');
      process.exitCode = 1;
      return;
    }

    const db = openDb({ path: dbPath() });
    try {
      const result = insertLeads(db, rows);
      log.info(
        { inserted: result.inserted, duplicates: result.duplicates, rejected: errors.length },
        'leads import complete',
      );
    } finally {
      db.close();
    }
  });

leadsCommand
  .command('list')
  .description('List leads in the workspace')
  .option('-s, --status <status>', 'filter by status (imported, drafted, sent, ...)')
  .option('-n, --limit <n>', 'maximum rows to show', (v) => Number.parseInt(v, 10))
  .action((opts: { status?: string; limit?: number }) => {
    const db = openDb({ path: dbPath() });
    try {
      const rows = listLeads(db, opts);
      if (rows.length === 0) {
        process.stdout.write('no leads\n');
        return;
      }
      const widths = {
        id: Math.max(2, ...rows.map((r) => String(r.id).length)),
        name: Math.max(4, ...rows.map((r) => r.name.length)),
        email: Math.max(5, ...rows.map((r) => r.email.length)),
        company: Math.max(7, ...rows.map((r) => (r.company ?? '').length)),
        status: Math.max(6, ...rows.map((r) => r.status.length)),
      };
      const header =
        `${'id'.padEnd(widths.id)}  ${'name'.padEnd(widths.name)}  ` +
        `${'email'.padEnd(widths.email)}  ${'company'.padEnd(widths.company)}  status`;
      process.stdout.write(`${header}\n`);
      for (const r of rows) {
        process.stdout.write(
          `${String(r.id).padEnd(widths.id)}  ${r.name.padEnd(widths.name)}  ` +
            `${r.email.padEnd(widths.email)}  ${(r.company ?? '').padEnd(widths.company)}  ` +
            `${r.status}\n`,
        );
      }
    } finally {
      db.close();
    }
  });

leadsCommand
  .command('export')
  .description('Export all leads to CSV on stdout')
  .action(() => {
    const db = openDb({ path: dbPath() });
    try {
      process.stdout.write(exportLeadsToCsv(db));
    } finally {
      db.close();
    }
  });
