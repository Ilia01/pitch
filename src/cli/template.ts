import { resolve } from 'node:path';
import { Command } from 'commander';
import { openDb } from '../core/db.js';
import { addTemplate, listTemplates } from '../core/templates.js';
import { log } from '../lib/log.js';

function dbPath(): string {
  return resolve(process.cwd(), 'pitch.db');
}

export const templateCommand = new Command('template').description('Manage email templates');

templateCommand
  .command('add <name> <file>')
  .description('Register a markdown template (body in <file>)')
  .requiredOption('-s, --subject <subject>', 'email subject line (may contain {{vars}})')
  .action((name: string, file: string, opts: { subject: string }) => {
    const bodyPath = resolve(process.cwd(), file);
    const db = openDb({ path: dbPath() });
    try {
      const tmpl = addTemplate(db, { name, subject: opts.subject, bodyPath });
      log.info({ id: tmpl.id, name: tmpl.name, subject: tmpl.subject }, 'template registered');
    } finally {
      db.close();
    }
  });

templateCommand
  .command('list')
  .description('List registered templates')
  .action(() => {
    const db = openDb({ path: dbPath() });
    try {
      const rows = listTemplates(db);
      if (rows.length === 0) {
        process.stdout.write('no templates\n');
        return;
      }
      const widths = {
        id: Math.max(2, ...rows.map((r) => String(r.id).length)),
        name: Math.max(4, ...rows.map((r) => r.name.length)),
      };
      const header = `${'id'.padEnd(widths.id)}  ${'name'.padEnd(widths.name)}  subject`;
      process.stdout.write(`${header}\n`);
      for (const r of rows) {
        const subject = r.subject.length > 60 ? `${r.subject.slice(0, 57)}...` : r.subject;
        process.stdout.write(
          `${String(r.id).padEnd(widths.id)}  ${r.name.padEnd(widths.name)}  ${subject}\n`,
        );
      }
    } finally {
      db.close();
    }
  });
